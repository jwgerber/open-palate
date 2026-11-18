"""Health check and the built frontend (single-page app) served by Flask."""
from pathlib import Path

from flask import Flask, abort, current_app, jsonify, request, send_from_directory
from sqlalchemy import text
from werkzeug.exceptions import NotFound

from extensions import db

DEFAULT_STATIC_DIR = Path(__file__).resolve().parent / "frontend" / "dist"
ONE_YEAR = 31536000


def _static_dir() -> Path:
    return Path(current_app.config.get("STATIC_DIR") or DEFAULT_STATIC_DIR)


def healthz():
    """200 when the database answers; no auth and no data, so a host can poll it."""
    try:
        db.session.execute(text("SELECT 1"))
    except Exception:  # any database failure means "not healthy"
        current_app.logger.exception("healthz: database check failed")
        return jsonify({"ok": False}), 503
    return jsonify({"ok": True})


def spa(path: str = ""):
    """Serve a built file, or index.html for any client-side route."""
    if path == "api" or path.startswith("api/"):
        abort(404)
    root = _static_dir()
    candidate = (root / path).resolve()
    if path and candidate.is_file() and candidate.is_relative_to(root.resolve()):
        response = send_from_directory(root, path)
        # Vite fingerprints everything under assets/, so it can be cached forever.
        if path.startswith("assets/"):
            response.headers["Cache-Control"] = f"public, max-age={ONE_YEAR}, immutable"
        return response
    if path.startswith("assets/") or not (root / "index.html").is_file():
        abort(404)
    response = send_from_directory(root, "index.html")
    response.headers["Cache-Control"] = "no-cache"
    return response


def not_found(error):
    # Only a plain unknown-route 404; subclasses (e.g. "Coffee not found") build their own body.
    if type(error) is NotFound and request.path.startswith("/api"):
        return jsonify({"error": "not_found"}), 404
    return error


def init_app(app: Flask) -> None:
    app.add_url_rule("/healthz", "healthz", healthz)
    app.add_url_rule("/", "spa_index", spa, defaults={"path": ""})
    app.add_url_rule("/<path:path>", "spa", spa)
    app.register_error_handler(404, not_found)
