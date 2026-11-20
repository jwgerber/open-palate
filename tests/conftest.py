import os
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

import identity.models  # noqa: F401  (registers tables for the cleanup)
import tasting.models  # noqa: F401  (ditto: the row wipe only covers imported tables)
from app import create_app
from extensions import db

ROOT = Path(__file__).resolve().parent.parent


def alembic_config(url: str) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "migrations"))
    config.set_main_option("sqlalchemy.url", url)
    return config


@pytest.fixture(scope="session")
def database_url(tmp_path_factory):
    """Migrate the test database once per session with `alembic upgrade head`.

    Postgres when TEST_DATABASE_URL is set; otherwise a temp-file SQLite DB
    (in-memory SQLite gives every connection its own empty database, so Alembic's
    separate connection could never share it with the app).
    """
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        url = f"sqlite:///{tmp_path_factory.mktemp('db') / 'test.db'}"
    command.upgrade(alembic_config(url), "head")
    return url


@pytest.fixture
def app(database_url):
    app = create_app({
        "TESTING": True,
        "SECRET_KEY": "test-secret",
        "BASE_URL": "http://localhost",
        "IN_CONTAINER": True,  # open setup must be opted into
        "SQLALCHEMY_DATABASE_URI": database_url,
    })
    yield app
    # Isolation: the schema is migrated once, so wipe rows after every test.
    with app.app_context():
        db.session.remove()
        with db.engine.begin() as conn:
            for table in reversed(db.metadata.sorted_tables):
                conn.execute(table.delete())
            # The migration seeds this singleton; the wipe above removed it.
            conn.execute(db.text("INSERT INTO install_settings (id) VALUES (1)"))
        db.engine.dispose()


@pytest.fixture
def db_session(app):
    with app.app_context():
        yield db.session
        db.session.remove()


@pytest.fixture
def client(app):
    return app.test_client()
