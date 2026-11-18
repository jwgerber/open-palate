"""`flask backup [dir]`: a consistent copy of the SQLite database."""
import os
import sqlite3
import tempfile
from datetime import date
from pathlib import Path
from urllib.parse import quote

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
    source_path = Path(url.database or "")
    if not source_path.is_file():
        raise click.ClickException(f"database file not found: {source_path}")
    target_dir = Path(directory)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"tasting-{date.today().isoformat()}.db"
    # Write a temp file, then rename: a crash never damages the day's copy.
    handle, temp_name = tempfile.mkstemp(prefix=".backup-", suffix=".tmp", dir=target_dir)
    os.close(handle)
    try:
        # Read-only, so a wrong path can never create an empty database.
        # SQLite's online backup API is safe while the app is writing.
        source = sqlite3.connect(f"file:{quote(str(source_path.resolve()))}?mode=ro", uri=True)
        destination = sqlite3.connect(temp_name)
        try:
            source.backup(destination)
        finally:
            destination.close()
            source.close()
        os.replace(temp_name, target)
    finally:
        Path(temp_name).unlink(missing_ok=True)
    for old in sorted(target_dir.glob("tasting-*.db"), reverse=True)[KEEP:]:
        old.unlink()
    click.echo(str(target))


def init_app(app: Flask) -> None:
    app.cli.add_command(backup)
