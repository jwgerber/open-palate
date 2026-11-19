"""`flask create-admin <email>`."""
import click
from flask import Flask

from extensions import db
from identity.accounts import default_display_name, ensure_admin, issue_signin_link, normalize_email


@click.command("create-admin")
@click.argument("email")
@click.option("--name", "display_name", default=None, help="Display name (default: from email).")
def create_admin(email: str, display_name: str | None) -> None:
    """Make EMAIL an admin of this install and print a sign-in link."""
    normalized = normalize_email(email)
    if normalized is None:
        raise click.BadParameter("not an email address", param_hint="EMAIL")
    user = ensure_admin(normalized, display_name or default_display_name(normalized))
    link, _ = issue_signin_link(user)
    db.session.commit()
    click.echo(f"Admin ready: {user.email}")
    click.echo(f"Sign in within 15 minutes (works once): {link}")


def init_app(app: Flask) -> None:
    app.cli.add_command(create_admin)
