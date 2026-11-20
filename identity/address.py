"""The app's own address: the owner-set ``public_url``, else ``BASE_URL``."""
from flask import current_app
from sqlalchemy.exc import IntegrityError

from extensions import db
from identity.models import InstallSettings


def install_settings() -> InstallSettings:
    """The install's settings row (id 1), created if missing. Tests wipe every
    table and an operator could delete the row, so nothing may assume it exists.
    The new row is flushed, not committed: the caller owns the transaction."""
    row = db.session.get(InstallSettings, 1)
    if row is None:
        try:
            with db.session.begin_nested():
                row = InstallSettings(id=1, public_url=None)
                db.session.add(row)
        except IntegrityError:  # another request created it first
            row = db.session.get(InstallSettings, 1)
    return row


def app_address() -> str:
    """Where people reach this app, no trailing slash. Read on every call so an
    owner's change applies without a restart."""
    url = install_settings().public_url or current_app.config["BASE_URL"]
    return url.rstrip("/")
