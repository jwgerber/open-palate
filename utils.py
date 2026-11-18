"""Shared helpers."""
import logging
from datetime import datetime, timezone
from functools import wraps

from flask import jsonify, request
from werkzeug.exceptions import HTTPException

from extensions import db


def utc_now() -> datetime:
    """Current UTC time as a naive datetime (the storage convention)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


# Postgres `integer` is 32-bit; JSON and Flask's <int:> accept any width.
PG_INT_MAX = 2 ** 31 - 1


def is_pg_int(value) -> bool:
    """True for a positive int (never a bool) that fits a Postgres integer."""
    return isinstance(value, int) and not isinstance(value, bool) and 0 < value <= PG_INT_MAX


def get_json_object(*, optional=False):
    """Parse the request body as a JSON object.

    Returns ``(data, error_response)``; exactly one is non-None. With
    ``optional`` a missing body reads as ``{}``, but a body that is sent must
    still be a JSON object.
    """
    data = request.get_json(silent=True)
    if data is None and optional and not request.get_data(cache=True):
        return {}, None
    if not isinstance(data, dict):
        return None, (jsonify({"error": "Request body must be a JSON object",
                               "field": "body"}), 400)
    return data, None


def handle_db_errors(message, log_label=None):
    """Roll back, log and return ``{'error': message}, 500`` for any unhandled
    exception in a route. HTTP exceptions pass through untouched. Must be the
    innermost decorator."""
    def decorator(fn):
        route_logger = logging.getLogger(fn.__module__)
        label = log_label or message

        @wraps(fn)
        def wrapper(*args, **kwargs):
            try:
                return fn(*args, **kwargs)
            except HTTPException:
                raise
            except Exception:
                db.session.rollback()
                route_logger.exception(label)
                return jsonify({"error": message}), 500
        return wrapper
    return decorator


# Cells starting with these are evaluated as formulas by spreadsheet apps.
_CSV_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def csv_safe(value) -> str:
    """Neutralize formula injection in a user-controlled CSV cell by
    prefixing a single quote when it starts with a formula trigger."""
    if value is None:
        return ""
    text = str(value)
    if text and text[0] in _CSV_FORMULA_PREFIXES:
        return "'" + text
    return text
