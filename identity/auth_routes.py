"""/api/auth: email sign-in links, first-admin setup, logout, who-am-I."""
import logging

from flask import Blueprint, current_app, jsonify, redirect, request
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from extensions import db, limiter
from identity import mail
from identity.accounts import (active_member_for_email, default_display_name,
                               ensure_admin, find_user, issue_signin_link, link_roster_members,
                               lock_first_admin_setup, more_than_one_owner, normalize_email,
                               setup_needed, setup_token_valid, user_has_active_member)
from identity.models import Group, LoginToken, Member, User
from identity.sessions import current_session, end_session, start_user_session
from identity.setup_access import setup_is_open, setup_password_ok
from identity.tokens import hash_token
from utils import get_json_object, handle_db_errors, utc_now

logger = logging.getLogger(__name__)

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


def _email_error():
    return jsonify({"error": "Enter a valid email address", "field": "email"}), 400


def _create_user_or_refind(email: str, display_name: str) -> User:
    """Insert the user in a savepoint; if a concurrent request won the race on
    users.email, use its row instead of failing (a 500 would leak the email)."""
    try:
        with db.session.begin_nested():
            user = User(email=email, display_name=display_name)
            db.session.add(user)
    except IntegrityError:
        user = find_user(email)
        if user is None:
            raise
    return user


def _revoke_current_session() -> None:
    """Signing in again replaces the browser's session rather than orphaning it."""
    old = current_session()
    if old is not None:
        old.revoked_at = utc_now()


@auth_bp.post("/request-link")
@limiter.limit("5/minute")
@handle_db_errors("Could not send a sign-in link")
def request_link():
    data, error = get_json_object()
    if error:
        return error
    email = normalize_email(data.get("email"))
    if email is None:
        return _email_error()

    # Same reply whether or not the address is known: no account enumeration.
    user = find_user(email)
    if user is not None and not (current_app.config.get("ALLOW_SIGNUP")
                                 or user_has_active_member(user)
                                 or active_member_for_email(email) is not None):
        user = None   # a known user nobody has an active place for gets no link
    elif user is None:
        member = active_member_for_email(email)
        if member is not None or current_app.config.get("ALLOW_SIGNUP"):
            user = _create_user_or_refind(email, member.display_name if member is not None
                                          else default_display_name(email))
    if user is not None:
        link, _ = issue_signin_link(user)
        db.session.commit()
        try:
            mail.send_signin_email(user.email, link)
        except Exception:
            # Logged, not raised: a 500 here would reveal the address is known.
            logger.exception("Sign-in email to user %s failed", user.id)
    return jsonify({"status": "sent"})


@auth_bp.get("/consume")
@handle_db_errors("Could not sign in")
def consume():
    raw = request.args.get("token", "")
    current_session()  # resolve (and maybe bump) before this request stages writes
    now = utc_now()
    token = db.session.execute(
        db.select(LoginToken).where(LoginToken.token_hash == hash_token(raw),
                                    LoginToken.purpose == "signin")
    ).scalar_one_or_none() if raw else None
    # Conditional UPDATE so two concurrent opens can't both redeem the link.
    claimed = token is not None and db.session.execute(
        update(LoginToken)
        .where(LoginToken.id == token.id, LoginToken.used_at.is_(None),
               LoginToken.expires_at > now)
        .values(used_at=now)
    ).rowcount == 1
    if not claimed:
        db.session.rollback()
        return redirect("/signin?error=expired")

    user = db.session.get(User, token.user_id)
    _revoke_current_session()
    user.last_login_at = now
    link_roster_members(user)
    set_cookie = start_user_session(user)
    db.session.commit()
    return set_cookie(redirect("/"))


@auth_bp.post("/setup")
@limiter.limit("5/minute")
@handle_db_errors("Could not finish setup")
def setup():
    data, error = get_json_object()
    if error:
        return error
    if not setup_needed():
        return jsonify({"error": "setup_done"}), 409
    if not (setup_token_valid(data.get("token"))
            or setup_password_ok(data.get("setup_password"))
            or setup_is_open()):
        return jsonify({"error": "invalid_token"}), 400
    email = normalize_email(data.get("email"))
    if email is None:
        return _email_error()
    display_name = data.get("display_name")
    display_name = display_name.strip() if isinstance(display_name, str) else ""
    if not display_name or len(display_name) > 120:
        return jsonify({"error": "Enter a name (up to 120 characters)",
                        "field": "display_name"}), 400

    lock_first_admin_setup()
    if not setup_needed():  # another setup finished while this one waited for the lock
        db.session.rollback()
        return jsonify({"error": "setup_done"}), 409
    _revoke_current_session()
    user = ensure_admin(email, display_name)
    db.session.flush()
    if more_than_one_owner():  # SQLite has no lock above: a racing setup got there first
        db.session.rollback()
        return jsonify({"error": "setup_done"}), 409
    user.last_login_at = utc_now()
    link_roster_members(user)
    set_cookie = start_user_session(user)
    db.session.commit()
    return set_cookie(jsonify({"status": "ok"}))


@auth_bp.get("/setup-status")
@limiter.limit("30/minute")
@handle_db_errors("Could not check setup")
def setup_status():
    """Public. Says whether first-admin setup is needed and how this visitor may do it."""
    if not setup_needed():
        return jsonify({"needed": False})
    return jsonify({"needed": True, "open": setup_is_open(),
                    "password": bool(current_app.config.get("SETUP_PASSWORD"))})


@auth_bp.post("/logout")
@handle_db_errors("Could not sign out")
def logout():
    return end_session(jsonify({"status": "signed_out"}))


def _group_dict(group: Group, role: str | None) -> dict:
    return {"id": group.id, "name": group.name, "role": role, "timezone": group.timezone,
            "is_personal": group.is_personal}


@auth_bp.get("/me")
@handle_db_errors("Could not load the session")
def me():
    session = current_session()
    if session is None:
        return jsonify({"error": "unauthorized"}), 401
    if session.kind == "device":
        group = db.session.get(Group, session.device_group_id)
        return jsonify({"user": None, "groups": [_group_dict(group, None)], "kind": "device"})

    user = db.session.get(User, session.user_id)
    rows = db.session.execute(
        db.select(Group, Member.role).join(Member, Member.group_id == Group.id)
        .where(Member.user_id == user.id, Member.active.is_(True)).order_by(Group.id)
    ).all()
    return jsonify({
        "user": {"id": user.id, "email": user.email, "display_name": user.display_name,
                 "is_owner": user.is_owner},
        "groups": [_group_dict(group, role) for group, role in rows],
        "kind": "user",
    })
