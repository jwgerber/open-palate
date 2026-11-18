"""`flask backup [dir]`: a consistent copy of the SQLite database."""
import sqlite3
from datetime import date
from pathlib import Path

import click
from flask import Flask, current_app
from flask.cli import with_appcontext
from sqlalchemy.engine import make_url

KEEP = 14
DEFAULT_BACKUP_DIR = "/data/backups"


@click.command("backup")
@click.argument("directory", default=DEFAULT_BACKUP_DIR, type=click.Path(file_okay=False))
@with_appcontext
def backup(directory: str) -> None:
    """Copy the SQLite database to DIRECTORY/tasting-YYYY-MM-DD.db, keeping the newest 14."""
    url = make_url(current_app.config["SQLALCHEMY_DATABASE_URI"])
    if url.get_backend_name() != "sqlite":
        click.echo("use your database host's backups", err=True)
        raise SystemExit(2)
    target_dir = Path(directory)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"tasting-{date.today().isoformat()}.db"
    # SQLite's online backup API: safe while the app is writing.
    source = sqlite3.connect(url.database)
    destination = sqlite3.connect(target)
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()
    for old in sorted(target_dir.glob("tasting-*.db"), reverse=True)[KEEP:]:
        old.unlink()
    click.echo(str(target))


def init_app(app: Flask) -> None:
    app.cli.add_command(backup)
