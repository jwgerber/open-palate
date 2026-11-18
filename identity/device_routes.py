"""/api/device: a shared tablet enters a code, then picks who is tasting."""
from flask import Blueprint, jsonify
from sqlalchemy import func, update

from extensions import db, limiter
from identity.accounts import normalize_device_code
from identity.models import DeviceCode, Member
from identity.sessions import current_session, start_device_session
from identity.tokens import hash_token
from utils import get_json_object, handle_db_errors, utc_now

device_bp = Blueprint("device", __name__, url_prefix="/api/device")


def _revoke_current_session() -> None:
    old = current_session()
    if old is not None:
        old.revoked_at = utc_now()


@device_bp.post("/enter")
@limiter.limit("10/minute")
@handle_db_errors("Could not enter the code")
def enter():
    data, error = get_json_object()
    if error:
        return error
    code = normalize_device_code(data.get("code"))
    current_session()  # resolve (and maybe bump) before this request stages writes
    row = db.session.execute(
        db.select(DeviceCode).where(DeviceCode.code_hash == hash_token(code))
    ).scalar_one_or_none() if code else None
    now = utc_now()
    # Conditional UPDATE: two tablets typing the same code cannot both win.
    claimed = row is not None and db.session.execute(
        update(DeviceCode)
        .where(DeviceCode.id == row.id, DeviceCode.used_at.is_(None),
               DeviceCode.revoked_at.is_(None), DeviceCode.expires_at > now)
        .values(used_at=now)
    ).rowcount == 1
    if not claimed:
        db.session.rollback()
        return jsonify({"error": "invalid_code"}), 400
    _revoke_current_session()
    set_cookie = start_device_session(row.group_id, row.id)
    db.session.commit()
    return set_cookie(jsonify({"status": "ok"}))


def _session_group_id() -> int | None:
    """Group of the live session: a device's group, or a signed-in person's single
    active group (Phase 1: one group per install)."""
    session = current_session()
    if session is None:
        return None
    if session.kind == "device":
        return session.device_group_id
    return db.session.execute(
        db.select(Member.group_id).where(Member.user_id == session.user_id,
                                         Member.active.is_(True))
        .order_by(Member.id).limit(1)).scalar_one_or_none()


@device_bp.get("/members")
@handle_db_errors("Could not load members")
def members():
    group_id = _session_group_id()
    if group_id is None:
        return jsonify({"error": "unauthorized"}), 401
    rows = db.session.execute(
        db.select(Member.id, Member.display_name)
        .where(Member.group_id == group_id, Member.active.is_(True))
        .order_by(func.lower(Member.display_name), Member.id)
    ).all()
    return jsonify([{"id": mid, "display_name": name} for mid, name in rows])
