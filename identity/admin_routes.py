"""/api/group: group settings, roster and device codes. Group admins only."""
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from flask import Blueprint, abort, jsonify, make_response
from sqlalchemy import func, update
from sqlalchemy.exc import IntegrityError

from extensions import db
from identity.accounts import (DEVICE_CODE_TTL, new_device_code, normalize_email)
from identity.models import DeviceCode, Group, Member, Session, User
from identity.sessions import current_session
from identity.tokens import hash_token
from utils import get_json_object, handle_db_errors, utc_now

admin_bp = Blueprint("admin", __name__, url_prefix="/api/group")

ROLES = ("admin", "editor", "member")


def _require_group_admin() -> tuple[User, Member]:
    """Gate for every route here: 401 without a session, 403 for a device session
    or anyone who is not an active admin. Phase 1 has one group per install, so
    the group is the admin's single active member row. Task 6's access layer
    replaces this."""
    session = current_session()
    if session is None:
        abort(make_response(jsonify({"error": "unauthorized"}), 401))
    forbidden = make_response(jsonify({"error": "forbidden"}), 403)
    if session.kind != "user":
        abort(forbidden)
    member = db.session.execute(
        db.select(Member).where(Member.user_id == session.user_id, Member.role == "admin",
                                Member.active.is_(True)).order_by(Member.id).limit(1)
    ).scalar_one_or_none()
    if member is None:
        abort(forbidden)
    return db.session.get(User, session.user_id), member


def _group_dict(group: Group) -> dict:
    return {"id": group.id, "name": group.name, "timezone": group.timezone}


def _member_dict(member: Member) -> dict:
    return {"id": member.id, "display_name": member.display_name, "email": member.email,
            "role": member.role, "active": member.active,
            "signed_up": member.user_id is not None}


def _field_error(message: str, field: str, status: int = 400):
    return jsonify({"error": message, "field": field}), status


def _clean_name(value):
    name = value.strip() if isinstance(value, str) else ""
    return name if name and len(name) <= 120 else None


@admin_bp.get("")
@handle_db_errors("Could not load the group")
def get_group():
    _, admin = _require_group_admin()
    return jsonify(_group_dict(db.session.get(Group, admin.group_id)))


@admin_bp.patch("")
@handle_db_errors("Could not update the group")
def patch_group():
    _, admin = _require_group_admin()
    data, error = get_json_object()
    if error:
        return error
    group = db.session.get(Group, admin.group_id)
    if "name" in data:
        name = _clean_name(data["name"])
        if name is None:
            return _field_error("Enter a name (up to 120 characters)", "name")
        group.name = name
    if "timezone" in data:
        zone = data["timezone"]
        try:
            if not isinstance(zone, str) or not zone or len(zone) > 64:
                raise ZoneInfoNotFoundError(zone)
            ZoneInfo(zone)
        except (ZoneInfoNotFoundError, ValueError, OSError):
            return jsonify({"error": "bad_timezone", "field": "timezone"}), 422
        group.timezone = zone
    db.session.commit()
    return jsonify(_group_dict(group))


@admin_bp.get("/members")
@handle_db_errors("Could not load members")
def list_members():
    _, admin = _require_group_admin()
    rows = db.session.execute(
        db.select(Member).where(Member.group_id == admin.group_id)
        .order_by(func.lower(Member.display_name), Member.id)).scalars()
    return jsonify([_member_dict(m) for m in rows])


def _email_value(value):
    """(email, ok): None clears the address."""
    if value is None or value == "":
        return None, True
    email = normalize_email(value)
    return email, email is not None


@admin_bp.post("/members")
@handle_db_errors("Could not add the member")
def add_member():
    _, admin = _require_group_admin()
    data, error = get_json_object()
    if error:
        return error
    name = _clean_name(data.get("display_name"))
    if name is None:
        return _field_error("Enter a name (up to 120 characters)", "display_name")
    role = data.get("role", "member")
    if role not in ROLES:
        return _field_error("Role must be admin, editor or member", "role")
    email, ok = _email_value(data.get("email"))
    if not ok:
        return _field_error("Enter a valid email address", "email")
    member = Member(group_id=admin.group_id, display_name=name, email=email, role=role)
    try:
        with db.session.begin_nested():
            db.session.add(member)
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "email_in_use", "field": "email"}), 409
    db.session.commit()
    return jsonify(_member_dict(member)), 201


def _other_active_admin_exists(group_id: int, member_id: int) -> bool:
    return db.session.execute(
        db.select(Member.id).where(Member.group_id == group_id, Member.role == "admin",
                                   Member.active.is_(True), Member.id != member_id).limit(1)
    ).first() is not None


@admin_bp.patch("/members/<int:member_id>")
@handle_db_errors("Could not update the member")
def patch_member(member_id: int):
    _, admin = _require_group_admin()
    data, error = get_json_object()
    if error:
        return error
    member = db.session.execute(
        db.select(Member).where(Member.id == member_id, Member.group_id == admin.group_id)
    ).scalar_one_or_none()
    if member is None:
        return jsonify({"error": "not_found"}), 404

    changes = {}
    if "display_name" in data:
        name = _clean_name(data["display_name"])
        if name is None:
            return _field_error("Enter a name (up to 120 characters)", "display_name")
        changes["display_name"] = name
    if "email" in data:
        email, ok = _email_value(data["email"])
        if not ok:
            return _field_error("Enter a valid email address", "email")
        changes["email"] = email
    if "role" in data:
        if data["role"] not in ROLES:
            return _field_error("Role must be admin, editor or member", "role")
        changes["role"] = data["role"]
    if "active" in data:
        if not isinstance(data["active"], bool):
            return _field_error("active must be true or false", "active")
        changes["active"] = data["active"]

    is_active_admin = member.role == "admin" and member.active
    stays_active_admin = (changes.get("role", member.role) == "admin"
                          and changes.get("active", member.active))
    if is_active_admin and not stays_active_admin \
            and not _other_active_admin_exists(member.group_id, member.id):
        return jsonify({"error": "last_admin"}), 409
    for field, value in changes.items():
        setattr(member, field, value)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "email_in_use", "field": "email"}), 409
    return jsonify(_member_dict(member))


@admin_bp.post("/device-codes")
@handle_db_errors("Could not create a device code")
def create_device_code():
    user, admin = _require_group_admin()
    code = new_device_code()
    row = DeviceCode(group_id=admin.group_id, code_hash=hash_token(code), created_by=user.id,
                     expires_at=utc_now() + DEVICE_CODE_TTL)
    db.session.add(row)
    db.session.commit()
    # The only time the plain code exists: only its hash is stored.
    return jsonify({"id": row.id, "code": code, "expires_at": row.expires_at.isoformat()}), 201


@admin_bp.delete("/device-codes/<int:code_id>")
@handle_db_errors("Could not revoke the device code")
def revoke_device_code(code_id: int):
    _, admin = _require_group_admin()
    row = db.session.execute(
        db.select(DeviceCode).where(DeviceCode.id == code_id,
                                    DeviceCode.group_id == admin.group_id)
    ).scalar_one_or_none()
    if row is None:
        return jsonify({"error": "not_found"}), 404
    now = utc_now()
    if row.revoked_at is None:
        row.revoked_at = now
    db.session.execute(update(Session).where(Session.device_code_id == row.id,
                                             Session.revoked_at.is_(None))
                       .values(revoked_at=now))
    db.session.commit()
    return jsonify({"status": "revoked"})
