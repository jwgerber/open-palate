"""/api/group: group settings, roster and device codes. Group admins only."""
import logging
from datetime import timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from flask import Blueprint, jsonify
from sqlalchemy import func, update
from sqlalchemy.exc import IntegrityError

from extensions import db
from identity.access import current_actor, require
from identity.accounts import (ADMIN_LINK_TTL, DEVICE_CODE_TTL, find_user, get_or_create_user,
                               issue_signin_link, link_roster_members, new_device_code,
                               normalize_email)
from identity.models import DeviceCode, Group, Member, Session
from identity.tokens import hash_token
from tasting.sample_data import (SampleDataError, has_sample_data, load_sample_data,
                                remove_sample_data)
from utils import get_json_object, handle_db_errors, utc_now

logger = logging.getLogger(__name__)

admin_bp = Blueprint("admin", __name__, url_prefix="/api/group")

ROLES = ("admin", "editor", "member")


def _group_dict(group: Group) -> dict:
    return {"id": group.id, "name": group.name, "timezone": group.timezone}


def _member_dict(member: Member) -> dict:
    return {"id": member.id, "display_name": member.display_name, "email": member.email,
            "role": member.role, "active": member.active,
            "signed_up": member.user_id is not None, "is_sample": member.is_sample}


def _field_error(message: str, field: str, status: int = 400):
    return jsonify({"error": message, "field": field}), status


def _clean_name(value):
    name = value.strip() if isinstance(value, str) else ""
    return name if name and len(name) <= 120 else None


@admin_bp.get("")
@require("admin")
@handle_db_errors("Could not load the group")
def get_group():
    admin = current_actor()
    return jsonify({**_group_dict(db.session.get(Group, admin.group_id)),
                    "sample_data": has_sample_data(admin.group_id)})


@admin_bp.patch("")
@require("admin")
@handle_db_errors("Could not update the group")
def patch_group():
    admin = current_actor()
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
@require("admin")
@handle_db_errors("Could not load members")
def list_members():
    admin = current_actor()
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
@require("admin")
@handle_db_errors("Could not add the member")
def add_member():
    admin = current_actor()
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
@require("admin")
@handle_db_errors("Could not update the member")
def patch_member(member_id: int):
    admin = current_actor()
    data, error = get_json_object()
    if error:
        return error
    member = db.session.execute(
        db.select(Member).where(Member.id == member_id, Member.group_id == admin.group_id)
    ).scalar_one_or_none()
    if member is None:
        return jsonify({"error": "not_found"}), 404
    if member.is_sample:
        return jsonify({"error": "sample_member"}), 409

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
        if email != member.email and member.user_id is not None:
            # Member.email must keep matching the linked User.email; there is no
            # unlink route in Phase 1.
            return jsonify({"error": "member_linked", "field": "email"}), 409
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


@admin_bp.post("/members/<int:member_id>/signin-link")
@require("admin")
@handle_db_errors("Could not create a sign-in link")
def copy_signin_link(member_id: int):
    admin = current_actor()
    member = db.session.execute(
        db.select(Member).where(Member.id == member_id, Member.group_id == admin.group_id)
    ).scalar_one_or_none()
    if member is None:
        return jsonify({"error": "not_found"}), 404
    if member.is_sample:
        return jsonify({"error": "sample_member"}), 409
    if not member.active:
        return jsonify({"error": "member_inactive"}), 409
    if member.role in ("admin", "editor") and member.id != admin.member_id:
        # A link signs in as that person: never mint one for another manager.
        return jsonify({"error": "manager_member"}), 409
    email = normalize_email(member.email)
    if email is None:
        return jsonify({"error": "no_email"}), 409
    existing = find_user(email)
    if existing is not None and db.session.execute(
            db.select(Member.id).where(Member.user_id == existing.id,
                                       Member.group_id != admin.group_id).limit(1)
    ).first() is not None:
        # An account that belongs to another group must never be signed into
        # from here: the link would hand that group's session to this admin.
        return jsonify({"error": "other_group"}), 409
    # The admin vouches for this member, so the account is made even when
    # ALLOW_SIGNUP is off.
    user = existing or get_or_create_user(email, member.display_name)
    link_roster_members(user)
    if member.user_id != user.id:
        db.session.rollback()
        return jsonify({"error": "not_linked"}), 409
    link, expires_at = issue_signin_link(user, ttl=ADMIN_LINK_TTL, supersede=True)
    db.session.commit()
    expires_iso = expires_at.replace(tzinfo=timezone.utc).isoformat()
    # Never log the link or token.
    logger.info("Sign-in link copied: admin_member_id=%s target_member_id=%s expires_at=%s",
                admin.member_id, member.id, expires_iso)
    return jsonify({"link": link, "expires_at": expires_iso})


@admin_bp.post("/device-codes")
@require("admin")
@handle_db_errors("Could not create a device code")
def create_device_code():
    admin = current_actor()
    code = new_device_code()
    row = DeviceCode(group_id=admin.group_id, code_hash=hash_token(code), created_by=admin.user_id,
                     expires_at=utc_now() + DEVICE_CODE_TTL)
    db.session.add(row)
    db.session.commit()
    # The only time the plain code exists: only its hash is stored.
    return jsonify({"id": row.id, "code": code, "expires_at": row.expires_at.isoformat()}), 201


@admin_bp.get("/device-codes")
@require("admin")
@handle_db_errors("Could not load device codes")
def list_device_codes():
    admin = current_actor()
    now = utc_now()
    live = (db.select(func.count(Session.id))
            .where(Session.device_code_id == DeviceCode.id, Session.revoked_at.is_(None),
                   Session.expires_at > now).scalar_subquery())
    rows = db.session.execute(
        db.select(DeviceCode, live).where(DeviceCode.group_id == admin.group_id)
        .order_by(DeviceCode.created_at.desc(), DeviceCode.id.desc())).all()
    return jsonify([{"id": c.id, "created_at": c.created_at.isoformat(),
                     "expires_at": c.expires_at.isoformat(),
                     "used_at": c.used_at.isoformat() if c.used_at else None,
                     "revoked_at": c.revoked_at.isoformat() if c.revoked_at else None,
                     "active_sessions": n} for c, n in rows])


@admin_bp.delete("/device-codes/<int:code_id>")
@require("admin")
@handle_db_errors("Could not revoke the device code")
def revoke_device_code(code_id: int):
    admin = current_actor()
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


@admin_bp.post("/sample-data")
@require("admin")
@handle_db_errors("Could not load the sample data")
def post_sample_data():
    admin = current_actor()
    try:
        counts = load_sample_data(admin.group_id, admin)
    except SampleDataError as exc:
        db.session.rollback()
        return jsonify({"error": exc.code}), 409
    db.session.commit()
    return jsonify(counts), 201


@admin_bp.delete("/sample-data")
@require("admin")
@handle_db_errors("Could not remove the sample data")
def delete_sample_data():
    admin = current_actor()
    counts = remove_sample_data(admin.group_id)
    db.session.commit()
    return jsonify(counts)
