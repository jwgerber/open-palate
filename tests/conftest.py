import os

import pytest

from app import create_app
from extensions import db

TEST_CONFIG = {
    "TESTING": True,
    "SECRET_KEY": "test-secret",
    "BASE_URL": "http://localhost",
    "SQLALCHEMY_DATABASE_URI": os.environ.get("TEST_DATABASE_URL", "sqlite://"),
}


@pytest.fixture
def app():
    app = create_app(dict(TEST_CONFIG))
    yield app


@pytest.fixture
def db_session(app):
    # Schema is built by `alembic upgrade head` from Task 2 on; no create_all.
    with app.app_context():
        yield db.session
        db.session.remove()


@pytest.fixture
def client(app):
    return app.test_client()
