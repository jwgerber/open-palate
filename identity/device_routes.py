"""/api/device: a shared tablet enters a code, then picks who is tasting."""
from flask import Blueprint, jsonify
from sqlalchemy import func, update

from extensions import db, limiter
from identity.access import current_actor, require
from identity.accounts import normalize_device_code
from identity.models import DeviceCode, Group, Member
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
    if row is not None and db.session.get(Group, row.group_id).is_personal:
        db.session.rollback()   # a personal space has no devices; none can exist
        return jsonify({"error": "not_found"}), 404
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


@device_bp.get("/members")
@require("member")
@handle_db_errors("Could not load members")
def members():
    group_id = current_actor().group_id
    rows = db.session.execute(
        db.select(Member.id, Member.display_name)
        .where(Member.group_id == group_id, Member.active.is_(True),
               Member.is_sample.is_(False))
        .order_by(func.lower(Member.display_name), Member.id)
    ).all()
    return jsonify([{"id": mid, "display_name": name} for mid, name in rows])
