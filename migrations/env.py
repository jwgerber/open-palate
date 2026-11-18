"""Alembic environment.

The database URL is, in order: the ``sqlalchemy.url`` option when a caller set
it (tests do), else the app's ``SQLALCHEMY_DATABASE_URI`` from ``create_app()``.
"""
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine

import identity.models  # noqa: F401  (registers tables on db.metadata)
from config import normalize_database_url
from extensions import db

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = db.metadata


def database_url() -> str:
    url = config.get_main_option("sqlalchemy.url")
    if url:
        return normalize_database_url(url)
    import os

    from app import create_app

    os.environ["LOG_SETUP_LINK"] = "0"  # the server logs it, after migrating
    return create_app().config["SQLALCHEMY_DATABASE_URI"]


def run_migrations_offline() -> None:
    context.configure(
        url=database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(database_url())
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
