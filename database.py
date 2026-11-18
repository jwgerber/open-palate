"""SQLite settings applied to every new connection."""
from flask import Flask
from sqlalchemy import event
from sqlalchemy.engine import make_url

from extensions import db

BUSY_TIMEOUT_MS = 15000


def _set_pragmas(dbapi_connection, _record) -> None:
    cursor = dbapi_connection.cursor()
    # WAL lets readers and one writer overlap; the timeout makes a second
    # writer wait instead of failing with "database is locked".
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
    cursor.close()


def init_app(app: Flask) -> None:
    if make_url(app.config["SQLALCHEMY_DATABASE_URI"]).get_backend_name() != "sqlite":
        return
    with app.app_context():
        event.listen(db.engine, "connect", _set_pragmas)
