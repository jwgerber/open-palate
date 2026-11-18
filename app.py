"""Flask application factory."""
from flask import Flask
from werkzeug.middleware.proxy_fix import ProxyFix

from config import load_config
from extensions import db


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
    app.config.update(settings)

    hops = app.config["PROXY_HOPS"]
    if hops > 0:
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=hops, x_proto=hops)

    db.init_app(app)
    return app
