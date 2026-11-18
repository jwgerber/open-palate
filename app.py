"""Flask application factory."""
import logging

from flask import Flask
from werkzeug.middleware.proxy_fix import ProxyFix

from config import load_config, normalize_database_url
from extensions import db, limiter
from identity import accounts, cli, log_redact, sessions
from identity.admin_routes import admin_bp
from identity.auth_routes import auth_bp
from identity.device_routes import device_bp
from tasting import content
from tasting.routes import tasting_bp


def create_app(config: dict | None = None) -> Flask:
    app = Flask(__name__)
    settings = dict(config) if config is not None else load_config()
    settings.setdefault("SQLALCHEMY_TRACK_MODIFICATIONS", False)
    if config is not None:
        for name in ("SECRET_KEY", "BASE_URL"):
            if not settings.get(name):
                raise RuntimeError(f"{name} must be set")
        settings.setdefault("SQLALCHEMY_DATABASE_URI", "sqlite:////data/tasting.db")
        settings.setdefault("PROXY_HOPS", 1)
        settings["BASE_URL"] = settings["BASE_URL"].rstrip("/")
    settings["SQLALCHEMY_DATABASE_URI"] = normalize_database_url(
        settings["SQLALCHEMY_DATABASE_URI"])
    app.config.update(settings)

    hops = app.config["PROXY_HOPS"]
    if hops > 0:
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=hops, x_proto=hops)

    if not app.config.get("TESTING"):
        # INFO reaches the log: the no-SMTP sign-in link is delivered there.
        logging.basicConfig(level=logging.INFO)
    log_redact.install("werkzeug")

    db.init_app(app)
    limiter.init_app(app)
    sessions.init_app(app)
    app.register_blueprint(auth_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(device_bp)
    app.register_blueprint(tasting_bp)
    content.load()  # read the content files once, and fail at startup if they are missing
    cli.init_app(app)

    if app.config.get("LOG_SETUP_LINK", not app.config.get("TESTING")):
        accounts.log_setup_link_if_needed(app)
    return app
