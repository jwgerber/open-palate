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


def test_0006_clears_tasting_tags(fresh_url):
    """The 2020 wheel replaced every key, so 0006 deletes saved notes and nothing else."""
    config = alembic_config(fresh_url)
    command.upgrade(config, "0005")
    engine = sa.create_engine(normalize_database_url(fresh_url))
    try:
        with engine.begin() as conn:
            conn.execute(sa.text(
                "INSERT INTO groups (id, name, timezone, is_personal, created_at) "
                "VALUES (1, 'G', 'UTC', false, '2026-01-01')"))
            conn.execute(sa.text(
                "INSERT INTO tasting_coffees (id, group_id, name, kind, created_at, updated_at) "
                "VALUES (1, 1, 'C', 'house', '2026-01-01', '2026-01-01')"))
            conn.execute(sa.text(
                "INSERT INTO tasting_flights (id, group_id, prep, opened_at, closes_at, created_at) "
                "VALUES (1, 1, 'drip', '2026-01-01', '2026-01-01', '2026-01-01')"))
            conn.execute(sa.text(
                "INSERT INTO tastings (id, flight_id, coffee_id, taster_key, overall, created_at) "
                "VALUES (1, 1, 1, 'k', 4, '2026-01-01')"))
            conn.execute(sa.text(
                "INSERT INTO tasting_tags (tasting_id, term, strength) VALUES "
                "(1, 'Fruity>Berry>blueberry', 2), (1, 'Floral>Floral>jasmine', 3)"))
        command.upgrade(config, "0006")
        with engine.connect() as conn:
            assert conn.execute(sa.text("SELECT COUNT(*) FROM tasting_tags")).scalar() == 0
            assert conn.execute(sa.text("SELECT COUNT(*) FROM tastings")).scalar() == 1
            assert conn.execute(sa.text("SELECT COUNT(*) FROM tasting_coffees")).scalar() == 1
    finally:
        engine.dispose()


def _engine_at(url, revision):
    command.upgrade(alembic_config(url), revision)
    return sa.create_engine(normalize_database_url(url))


def _seed_group_with_members(conn, members):
    """members: (id, user_id or None, role, created_at, active). One user per user_id."""
    conn.execute(sa.text(
        "INSERT INTO groups (id, name, timezone, is_personal, created_at) "
        "VALUES (1, 'G', 'UTC', false, '2026-01-01')"))
    for member_id, user_id, role, created_at, active in members:
        if user_id is not None:
            conn.execute(sa.text(
                "INSERT INTO users (id, email, display_name, created_at) "
                f"VALUES ({user_id}, 'u{user_id}@x.co', 'U{user_id}', '2026-01-01')"))
        conn.execute(sa.text(
            "INSERT INTO members (id, group_id, display_name, user_id, role, active, created_at) "
            f"VALUES ({member_id}, 1, 'M{member_id}', {user_id if user_id is not None else 'NULL'}, "
            f"'{role}', {'true' if active else 'false'}, '{created_at}')"))


def _owner_ids(engine):
    with engine.connect() as conn:
        return {row[0] for row in conn.execute(sa.text("SELECT id FROM users WHERE is_owner"))}


def test_upgrade_backfills_owner(fresh_url):
    engine = _engine_at(fresh_url, "0006")
    try:
        with engine.begin() as conn:
            _seed_group_with_members(conn, [
                (1, 11, "admin", "2026-01-02", True),   # admin A, older
                (2, 12, "admin", "2026-01-05", True),   # admin B
                (3, 13, "member", "2026-01-01", True),  # member C
            ])
        command.upgrade(alembic_config(fresh_url), "0007")
        assert _owner_ids(engine) == {11}
    finally:
        engine.dispose()


def test_owner_backfill_skips_admin_without_user(fresh_url):
    engine = _engine_at(fresh_url, "0006")
    try:
        with engine.begin() as conn:
            _seed_group_with_members(conn, [
                (1, None, "admin", "2026-01-01", True),  # earliest, but no user
                (2, 12, "admin", "2026-01-05", True),
                (3, 13, "admin", "2026-01-06", True),
            ])
        command.upgrade(alembic_config(fresh_url), "0007")
        assert _owner_ids(engine) == {12}
    finally:
        engine.dispose()


def test_owner_backfill_none_when_no_admin_user(fresh_url):
    engine = _engine_at(fresh_url, "0006")
    try:
        with engine.begin() as conn:
            _seed_group_with_members(conn, [
                (1, None, "admin", "2026-01-01", True),
                (2, 12, "member", "2026-01-02", True),
                (3, 13, "admin", "2026-01-03", False),  # inactive admin does not count
            ])
        command.upgrade(alembic_config(fresh_url), "0007")
        assert _owner_ids(engine) == set()
    finally:
        engine.dispose()


def test_owner_backfill_tie_breaks_on_lowest_member_id(fresh_url):
    engine = _engine_at(fresh_url, "0006")
    try:
        with engine.begin() as conn:
            _seed_group_with_members(conn, [
                (5, 15, "admin", "2026-01-01", True),
                (4, 14, "admin", "2026-01-01", True),
            ])
        command.upgrade(alembic_config(fresh_url), "0007")
        assert _owner_ids(engine) == {14}
    finally:
        engine.dispose()


def test_install_settings_row_exists(fresh_url):
    command.upgrade(alembic_config(fresh_url), "head")
    engine = sa.create_engine(normalize_database_url(fresh_url))
    try:
        with engine.connect() as conn:
            rows = conn.execute(sa.text("SELECT id, public_url FROM install_settings")).all()
        assert [tuple(r) for r in rows] == [(1, None)]
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(sa.text("INSERT INTO install_settings (id) VALUES (2)"))
    finally:
        engine.dispose()


def _group_index_names(engine):
    catalog = ("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'groups'"
               if engine.dialect.name == "sqlite"
               else "SELECT indexname FROM pg_indexes WHERE tablename = 'groups'")
    with engine.connect() as conn:
        return {row[0] for row in conn.execute(sa.text(catalog))}


def test_personal_user_unique(fresh_url):
    command.upgrade(alembic_config(fresh_url), "head")
    engine = sa.create_engine(normalize_database_url(fresh_url))
    insert = ("INSERT INTO groups (name, timezone, is_personal, personal_user_id, created_at) "
              "VALUES ('P', 'UTC', {personal}, {user}, '2026-01-01')")
    try:
        with engine.begin() as conn:
            conn.execute(sa.text(
                "INSERT INTO users (id, email, display_name, created_at) "
                "VALUES (1, 'a@b.c', 'A', '2026-01-01')"))
            conn.execute(sa.text(insert.format(personal="true", user=1)))
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(sa.text(insert.format(personal="true", user=1)))
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(sa.text(insert.format(personal="false", user=1)))
        with pytest.raises(IntegrityError):  # personal without an owner user
            with engine.begin() as conn:
                conn.execute(sa.text(insert.format(personal="true", user="NULL")))
        assert "uq_groups_personal_user" in _group_index_names(engine)
    finally:
        engine.dispose()


def test_0007_downgrade_roundtrip(fresh_url):
    config = alembic_config(fresh_url)
    command.upgrade(config, "head")
    command.downgrade(config, "0006")
    engine = sa.create_engine(normalize_database_url(fresh_url))
    try:
        inspector = sa.inspect(engine)
        assert "install_settings" not in inspector.get_table_names()
        assert "is_owner" not in {c["name"] for c in inspector.get_columns("users")}
        assert "personal_user_id" not in {c["name"] for c in inspector.get_columns("groups")}
        assert "uq_groups_personal_user" not in _group_index_names(engine)
        command.upgrade(config, "head")
        assert "uq_groups_personal_user" in _group_index_names(engine)
        assert "uq_members_group_lower_email" in {
            row[0] for row in engine.connect().execute(sa.text(
                "SELECT name FROM sqlite_master WHERE type = 'index'" if engine.dialect.name == "sqlite"
                else "SELECT indexname FROM pg_indexes WHERE tablename = 'members'"))}
    finally:
        engine.dispose()


def test_upgraded_admin_still_works(fresh_url):
    from app import create_app
    from extensions import db
    from identity.models import User
    from tests.identity.helpers import sign_in

    engine = _engine_at(fresh_url, "0006")
    try:
        with engine.begin() as conn:
            _seed_group_with_members(conn, [(1, 11, "admin", "2026-01-01", True)])
            conn.execute(sa.text(
                "INSERT INTO tasting_coffees (id, group_id, name, kind, created_at, updated_at) "
                "VALUES (1, 1, 'Ethiopia', 'house', '2026-01-01', '2026-01-01')"))
    finally:
        engine.dispose()
    command.upgrade(alembic_config(fresh_url), "head")
    app = create_app({"TESTING": True, "SECRET_KEY": "s", "BASE_URL": "http://localhost",
                      "IN_CONTAINER": True, "SQLALCHEMY_DATABASE_URI": fresh_url})
    try:
        with app.app_context():
            client = app.test_client()
            sign_in(client, db.session.get(User, 11))
            response = client.get("/api/tasting/coffees")
            assert response.status_code == 200
            assert "Ethiopia" in response.get_data(as_text=True)
    finally:
        with app.app_context():
            db.session.remove()
            db.engine.dispose()


def _seed_group_admins(conn, group_id, admins):
    """admins: (member_id, user_id, created_at); every member is an active admin with a user."""
    conn.execute(sa.text(
        "INSERT INTO groups (id, name, timezone, is_personal, created_at) "
        f"VALUES ({group_id}, 'G{group_id}', 'UTC', false, '2026-01-01')"))
    for member_id, user_id, created_at in admins:
        conn.execute(sa.text(
            "INSERT INTO users (id, email, display_name, created_at) "
            f"VALUES ({user_id}, 'u{user_id}@x.co', 'U{user_id}', '2026-01-01')"))
        conn.execute(sa.text(
            "INSERT INTO members (id, group_id, display_name, user_id, role, active, created_at) "
            f"VALUES ({member_id}, {group_id}, 'M{member_id}', {user_id}, 'admin', true, '{created_at}')"))


def test_owner_backfill_falls_back_to_earliest_admin_elsewhere(fresh_url):
    engine = _engine_at(fresh_url, "0006")
    try:
        with engine.begin() as conn:
            _seed_group_admins(conn, 1, [])   # lowest group: no admin with a user
            conn.execute(sa.text(
                "INSERT INTO members (id, group_id, display_name, user_id, role, active, created_at) "
                "VALUES (1, 1, 'M1', NULL, 'admin', true, '2026-01-01')"))
            _seed_group_admins(conn, 2, [(2, 22, "2026-01-09")])
            _seed_group_admins(conn, 3, [(3, 23, "2026-01-05")])
        command.upgrade(alembic_config(fresh_url), "0007")
        assert _owner_ids(engine) == {23}
    finally:
        engine.dispose()


def test_owner_backfill_prefers_lowest_group_over_older_admin_elsewhere(fresh_url):
    engine = _engine_at(fresh_url, "0006")
    try:
        with engine.begin() as conn:
            _seed_group_admins(conn, 1, [(1, 21, "2026-02-01")])
            _seed_group_admins(conn, 2, [(2, 22, "2026-01-01")])   # older, later group
        command.upgrade(alembic_config(fresh_url), "0007")
        assert _owner_ids(engine) == {21}
    finally:
        engine.dispose()
