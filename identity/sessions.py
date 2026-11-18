"""Cookie sessions (user and device) and the double-submit CSRF check.

The session cookie carries a random token; the ``sessions`` row stores only its
sha256. A session is valid while not revoked and ``now < expires_at``. Kinds
listed in ``ROLLING_TTL`` slide forward on use, at most once an hour; other
kinds keep the expiry written on their row.
"""
import hmac
import secrets
from datetime import timedelta
from typing import Callable

from flask import Flask, Response, current_app, jsonify, request
from sqlalchemy import update
from sqlalchemy.orm.attributes import set_committed_value

from extensions import db
from identity.models import Session, User
from identity.tokens import hash_token, new_token
from utils import utc_now

SESSION_COOKIE = "tasting_session"
CSRF_COOKIE = "tasting_csrf"
CSRF_HEADER = "X-CSRF-Token"
ROLLING_TTL = {"user": timedelta(days=30)}
BUMP_INTERVAL = timedelta(hours=1)
CSRF_COOKIE_MAX_AGE = int(timedelta(days=365).total_seconds())
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

_NO_SESSION = object()


def _request_state() -> dict:
    """Per-request scratch space. Not ``flask.g``: g is bound to the app
    context, and an outer app context (tests, CLI) would carry a cached
    session from one request into the next."""
    return request.environ.setdefault("tasting.auth", {})


def secure_cookies() -> bool:
    """``Secure`` follows BASE_URL's scheme, so http://localhost dev works."""
    return current_app.config["BASE_URL"].lower().startswith("https://")


def _set_session_cookie(response: Response, raw: str, max_age: timedelta) -> None:
    response.set_cookie(SESSION_COOKIE, raw, max_age=int(max_age.total_seconds()),
                        httponly=True, secure=secure_cookies(), samesite="Lax", path="/")


def start_user_session(user: User) -> Callable[[Response], Response]:
    """Add a user session row (the caller commits) and return a function that
    puts its cookie on the response."""
    raw, digest = new_token()
    now = utc_now()
    ttl = ROLLING_TTL["user"]
    db.session.add(Session(user_id=user.id, kind="user", token_hash=digest,
                           created_at=now, last_seen_at=now, expires_at=now + ttl))

    def set_cookie(response: Response) -> Response:
        _set_session_cookie(response, raw, ttl)
        return response
    return set_cookie


def current_session() -> Session | None:
    """The live session named by the cookie, or None. Cached per request.

    Contract: this never flushes or commits the caller's ``db.session``. The
    rolling bump is a standalone UPDATE on its own connection, committed at
    once; the loaded row is updated in place without being marked dirty.
    Call it before staging writes (access checks do, at request start): on
    SQLite a separate connection cannot write while this request's
    connection holds a write lock.
    """
    state = _request_state()
    cached = state.get("session", _NO_SESSION)
    if cached is not _NO_SESSION:
        return cached
    state["session"] = None
    raw = request.cookies.get(SESSION_COOKIE)
    if not raw:
        return None
    now = utc_now()
    with db.session.no_autoflush:
        row = db.session.execute(
            db.select(Session).where(Session.token_hash == hash_token(raw),
                                     Session.revoked_at.is_(None),
                                     Session.expires_at > now)
        ).scalar_one_or_none()
    if row is None:
        return None
    ttl = ROLLING_TTL.get(row.kind)
    if ttl is not None and now - row.last_seen_at >= BUMP_INTERVAL:
        with db.engine.begin() as conn:
            conn.execute(update(Session).where(Session.id == row.id)
                         .values(last_seen_at=now, expires_at=now + ttl))
        set_committed_value(row, "last_seen_at", now)
        set_committed_value(row, "expires_at", now + ttl)
        state["refresh"] = (raw, ttl)
    state["session"] = row
    return row


def end_session(response: Response) -> Response:
    """Revoke the current session (if any) and clear its cookie."""
    row = current_session()
    if row is not None:
        row.revoked_at = utc_now()
        db.session.commit()
    state = _request_state()
    state["session"] = None
    state.pop("refresh", None)
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True,
                           secure=secure_cookies(), samesite="Lax")
    return response


def _check_csrf():
    if request.method in SAFE_METHODS or not request.path.startswith("/api/"):
        return None
    cookie = request.cookies.get(CSRF_COOKIE, "")
    header = request.headers.get(CSRF_HEADER, "")
    if not cookie or not header or not hmac.compare_digest(
            cookie.encode("utf-8"), header.encode("utf-8")):
        return jsonify({"error": "csrf"}), 403
    return None


def _set_cookies(response: Response) -> Response:
    refresh = _request_state().pop("refresh", None)
    if refresh is not None:
        _set_session_cookie(response, *refresh)
    if not request.cookies.get(CSRF_COOKIE):
        response.set_cookie(CSRF_COOKIE, secrets.token_urlsafe(32), max_age=CSRF_COOKIE_MAX_AGE,
                            httponly=False, secure=secure_cookies(), samesite="Lax", path="/")
    return response


def init_app(app: Flask) -> None:
    app.before_request(_check_csrf)
    app.after_request(_set_cookies)
