import os
import runpy

import pytest

from extensions import db


def test_sqlite_connections_use_wal_and_busy_timeout(tmp_path):
    from app import create_app
    app = create_app({"TESTING": True, "SECRET_KEY": "x", "BASE_URL": "http://localhost",
                      "SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path / 'w.db'}"})
    with app.app_context():
        with db.engine.connect() as conn:
            raw = conn.connection.dbapi_connection
            assert raw.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
            assert raw.execute("PRAGMA busy_timeout").fetchone()[0] == 15000
        db.engine.dispose()


def gunicorn_settings(monkeypatch, **env):
    for name in ("DATABASE_URL", "WEB_CONCURRENCY", "GUNICORN_THREADS"):
        monkeypatch.delenv(name, raising=False)
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    return runpy.run_path(os.path.join(os.path.dirname(__file__), "..", "gunicorn.conf.py"))


@pytest.mark.parametrize("env,expected", [
    ({}, (1, 8)),
    ({"DATABASE_URL": "sqlite:////data/x.db"}, (1, 8)),
    ({"DATABASE_URL": "postgresql://u@h/d"}, (2, 4)),
    ({"DATABASE_URL": "postgres://u@h/d"}, (2, 4)),
    ({"WEB_CONCURRENCY": "3", "GUNICORN_THREADS": "2"}, (3, 2)),
])
def test_gunicorn_workers_and_threads(monkeypatch, env, expected):
    settings = gunicorn_settings(monkeypatch, **env)
    assert (settings["workers"], settings["threads"]) == expected
