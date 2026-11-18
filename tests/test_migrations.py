"""Migration chain tests: each builds its own database from empty."""
import os
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from sqlalchemy.exc import IntegrityError

ROOT = Path(__file__).resolve().parent.parent
TABLES = {"users", "groups", "members", "login_tokens", "sessions", "device_codes"}


def alembic_config(url: str) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "migrations"))
    config.set_main_option("sqlalchemy.url", url)
    return config


def _urls(tmp_path):
    yield "sqlite", f"sqlite:///{tmp_path / 'fresh.db'}"
    if os.environ.get("TEST_DATABASE_URL", "").startswith("postgresql"):
        yield "postgres", os.environ["TEST_DATABASE_URL"]


@pytest.fixture(params=["sqlite", "postgres"])
def fresh_url(request, tmp_path):
    urls = dict(_urls(tmp_path))
    if request.param not in urls:
        pytest.skip("TEST_DATABASE_URL (postgresql) not set")
    url = urls[request.param]
    yield url
    if request.param == "postgres":
        command.downgrade(alembic_config(url), "base")


def table_names(url: str) -> set[str]:
    engine = sa.create_engine(url)
    try:
        return set(sa.inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_upgrade_head_from_empty(fresh_url):
    command.upgrade(alembic_config(fresh_url), "head")
    assert TABLES <= table_names(fresh_url)
    assert "flight_links" not in table_names(fresh_url)


def test_downgrade_base_then_upgrade(fresh_url):
    config = alembic_config(fresh_url)
    command.upgrade(config, "head")
    command.downgrade(config, "base")
    assert not (TABLES & table_names(fresh_url))
    command.upgrade(config, "head")
    assert TABLES <= table_names(fresh_url)


def test_session_kind_shape_check(fresh_url):
    command.upgrade(alembic_config(fresh_url), "head")
    engine = sa.create_engine(fresh_url)
    try:
        with engine.begin() as conn:
            conn.execute(sa.text(
                "INSERT INTO users (id, email, display_name, created_at) "
                "VALUES (1, 'a@b.c', 'A', '2026-01-01')"))
            conn.execute(sa.text(
                "INSERT INTO groups (id, name, timezone, is_personal, created_at) "
                "VALUES (1, 'G', 'UTC', false, '2026-01-01')"))
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(sa.text(
                    "INSERT INTO sessions (user_id, device_group_id, token_hash, kind, "
                    "created_at, last_seen_at, expires_at) VALUES "
                    "(1, 1, 'h', 'device', '2026-01-01', '2026-01-01', '2026-02-01')"))
    finally:
        engine.dispose()
