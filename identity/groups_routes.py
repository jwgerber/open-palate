"""/api/groups and /api/install: teams, personal spaces and the owner's install settings."""
import ipaddress
import re
from urllib.parse import urlparse

from flask import Blueprint, jsonify
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from extensions import db
from identity.access import current_user, require
from identity.accounts import setup_needed
from identity.address import app_address, install_settings
from identity.admin_routes import bad_timezone_response, valid_timezone
from identity.models import Group, Member
from utils import get_json_object, handle_db_errors

groups_bp = Blueprint("groups", __name__, url_prefix="/api")

PERSONAL_NAME = "My tastings"


def _created_group_dict(group: Group) -> dict:
    return {"id": group.id, "name": group.name, "timezone": group.timezone,
            "role": "admin", "is_personal": group.is_personal}


def _owner_only():
    """None for the owner; otherwise the 403 response."""
    if not current_user().is_owner:
        return jsonify({"error": "forbidden"}), 403
    return None


@groups_bp.post("/groups")
@require("signed_in")
@handle_db_errors("Could not create the team")
def create_team():
    user = current_user()
    data, error = get_json_object()
    if error:
        return error
    if setup_needed():
        return jsonify({"error": "setup_needed"}), 409
    if (denied := _owner_only()) is not None:
        return denied
    name = data.get("name")
    name = name.strip() if isinstance(name, str) else ""
    if not name or len(name) > 120:
        return jsonify({"error": "Enter a name (up to 120 characters)", "field": "name"}), 400
    zone = data.get("timezone")
    if not valid_timezone(zone):
        return bad_timezone_response()
    group = Group(name=name, timezone=zone)
    db.session.add(group)
    db.session.flush()
    db.session.add(Member(group_id=group.id, user_id=user.id, display_name=user.display_name,
                          email=user.email, role="admin"))
    db.session.commit()
    return jsonify(_created_group_dict(group)), 201


def _personal_group(user_id: int) -> Group | None:
    return db.session.execute(
        db.select(Group).where(Group.personal_user_id == user_id)).scalar_one_or_none()


@groups_bp.post("/groups/personal")
@require("signed_in")
@handle_db_errors("Could not create your space")
def create_personal_space():
    user = current_user()
    if setup_needed():
        return jsonify({"error": "setup_needed"}), 409
    existing = _personal_group(user.id)
    if existing is not None:
        return jsonify(_created_group_dict(existing)), 200
    first_zone = db.session.execute(
        db.select(Group.timezone).join(Member, Member.group_id == Group.id)
        .where(Member.user_id == user.id, Member.active.is_(True)).order_by(Group.id).limit(1)
    ).scalar_one_or_none()
    try:
        with db.session.begin_nested():
            group = Group(name=PERSONAL_NAME, timezone=first_zone or "UTC", is_personal=True,
                          personal_user_id=user.id)
            db.session.add(group)
            db.session.flush()
            db.session.add(Member(group_id=group.id, user_id=user.id,
                                  display_name=user.display_name, email=user.email,
                                  role="admin"))
    except IntegrityError:  # a concurrent request made it first
        existing = _personal_group(user.id)
        if existing is None:
            raise
        return jsonify(_created_group_dict(existing)), 200
    db.session.commit()
    return jsonify(_created_group_dict(group)), 201


def _install_dict() -> dict:
    return {"public_url": install_settings().public_url, "address": app_address()}


@groups_bp.get("/install")
@require("signed_in")
@handle_db_errors("Could not load install settings")
def get_install():
    if (denied := _owner_only()) is not None:
        return denied
    return jsonify(_install_dict())


PUBLIC_URL_MAX = 255   # the install_settings.public_url column length
_DNS_NAME = re.compile(r"^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$")


def _is_valid_host(host: str | None) -> bool:
    """A DNS-style name (non-empty labels), an IPv4 address or an IPv6 address."""
    if not host:
        return False
    try:
        ipaddress.ip_address(host)   # urlparse strips the brackets from IPv6
        return True
    except ValueError:
        pass
    return bool(_DNS_NAME.match(host)) and not any(
        label.startswith("-") or label.endswith("-") for label in host.split("."))


def _clean_public_url(value) -> str | None:
    """The URL without a trailing slash, or None when it is not a bare http(s) origin."""
    if not isinstance(value, str):
        return None
    try:
        parts = urlparse(value.strip())
        host = parts.hostname
        parts.port  # noqa: B018  (raises ValueError on a bad port)
    except ValueError:
        return None
    if (len(value.strip()) > PUBLIC_URL_MAX or not _is_valid_host(host)
            or parts.scheme not in ("http", "https") or parts.path not in ("", "/")
            or parts.params or parts.query or parts.fragment or "?" in value or "#" in value
            or parts.username or parts.password):
        return None
    return f"{parts.scheme}://{parts.netloc}"


@groups_bp.patch("/install")
@require("signed_in")
@handle_db_errors("Could not update install settings")
def patch_install():
    if (denied := _owner_only()) is not None:
        return denied
    data, error = get_json_object()
    if error:
        return error
    if "public_url" in data:
        raw = data["public_url"]
        url = None if raw is None else _clean_public_url(raw)
        if raw is not None and url is None:
            return jsonify({"error": "Enter a web address like https://tasting.example.com",
                            "field": "public_url"}), 400
        install_settings().public_url = url
        db.session.commit()
    return jsonify(_install_dict())


@groups_bp.get("/install/groups")
@require("signed_in")
@handle_db_errors("Could not load teams")
def install_groups():
    """Names and active-member counts of teams; nothing else about any group."""
    if (denied := _owner_only()) is not None:
        return denied
    count = (db.select(func.count(Member.id))
             .where(Member.group_id == Group.id, Member.active.is_(True),
                    Member.is_sample.is_(False))
             .scalar_subquery())
    rows = db.session.execute(
        db.select(Group.id, Group.name, count).where(Group.is_personal.is_(False))
        .order_by(func.lower(Group.name), Group.id)).all()
    return jsonify([{"id": gid, "name": name, "member_count": n} for gid, name, n in rows])
