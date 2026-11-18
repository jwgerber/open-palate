"""Migration chain tests: each builds its own database from empty."""
import os
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from sqlalchemy.exc import IntegrityError

from config import normalize_database_url

ROOT = Path(__file__).resolve().parent.parent
TABLES = {"users", "groups", "members", "login_tokens", "sessions", "device_codes"}


def alembic_config(url: str) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "migrations"))
    config.set_main_option("sqlalchemy.url", url)
    return config


@pytest.fixture(params=["sqlite", "postgres"])
def fresh_url(request, tmp_path):
    """An empty database private to one test; the shared test DB is never touched."""
    if request.param == "sqlite":
        yield f"sqlite:///{tmp_path / 'fresh.db'}"
        return
    base = os.environ.get("TEST_DATABASE_URL", "")
    if not base.startswith("postgres"):
        pytest.skip("TEST_DATABASE_URL (postgresql) not set")
    base_url = sa.engine.make_url(normalize_database_url(base))
    name = f"migtest_{uuid.uuid4().hex[:12]}"
    admin = sa.create_engine(base_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(sa.text(f'CREATE DATABASE "{name}"'))
    try:
        yield base_url.set(database=name).render_as_string(hide_password=False)
    finally:
        with admin.connect() as conn:
            conn.execute(sa.text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


def table_names(url: str) -> set[str]:
    engine = sa.create_engine(normalize_database_url(url))
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
    engine = sa.create_engine(normalize_database_url(fresh_url))
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


SAMPLE_TABLES = ("members", "tasting_coffees", "tasting_flights")


def test_sample_flag_defaults_false_on_existing_rows(fresh_url):
    config = alembic_config(fresh_url)
    command.upgrade(config, "0004")
    engine = sa.create_engine(normalize_database_url(fresh_url))
    try:
        with engine.begin() as conn:
            conn.execute(sa.text(
                "INSERT INTO groups (id, name, timezone, is_personal, created_at) "
                "VALUES (1, 'G', 'UTC', false, '2026-01-01')"))
            conn.execute(sa.text(
                "INSERT INTO members (id, group_id, display_name, role, active, created_at) "
                "VALUES (1, 1, 'M', 'member', true, '2026-01-01')"))
            conn.execute(sa.text(
                "INSERT INTO tasting_coffees (id, group_id, name, kind, created_at, updated_at) "
                "VALUES (1, 1, 'C', 'house', '2026-01-01', '2026-01-01')"))
            conn.execute(sa.text(
                "INSERT INTO tasting_flights (id, group_id, prep, opened_at, closes_at, created_at) "
                "VALUES (1, 1, 'drip', '2026-01-01', '2026-01-01', '2026-01-01')"))
        command.upgrade(config, "0005")
        with engine.connect() as conn:
            for table in SAMPLE_TABLES:
                assert conn.execute(sa.text(f"SELECT is_sample FROM {table}")).scalar() in (False, 0)
        for table in SAMPLE_TABLES:
            col = next(c for c in sa.inspect(engine).get_columns(table) if c["name"] == "is_sample")
            assert not col["nullable"], table
        # batch_alter_table rebuilds SQLite tables; the functional unique index must survive.
        # Queried from the catalog: reflection skips expression-based indexes.
        catalog = ("SELECT name FROM sqlite_master WHERE type = 'index'" if engine.dialect.name == "sqlite"
                   else "SELECT indexname FROM pg_indexes WHERE tablename = 'members'")
        with engine.connect() as conn:
            assert "uq_members_group_lower_email" in {row[0] for row in conn.execute(sa.text(catalog))}
        command.downgrade(config, "0004")
        for table in SAMPLE_TABLES:
            assert "is_sample" not in {c["name"] for c in sa.inspect(engine).get_columns(table)}
    finally:
        engine.dispose()
