"""Access layer: who is calling (an Actor) and what level a route needs.

Access is decided by group role, in five levels:

=========  =====================================
level      who passes
=========  =====================================
member     any session in the group
self       a user session (a person)
device     a shared-device session
manage     a user whose role is editor or admin
admin      a user whose role is admin
=========  =====================================

Phase 1 has one group per install. A user's group is their single ACTIVE
member row (none: 403 ``no_group``; more than one: 403 ``ambiguous_group``,
never a guess). A device's group is ``device_group_id``.
"""
from dataclasses import dataclass
from functools import wraps
from typing import Literal

from flask import abort, jsonify, make_response, request

from extensions import db
from identity.models import Member
from identity.sessions import current_session
from utils import is_pg_int

Level = Literal["member", "self", "device", "manage", "admin"]
LEVELS: frozenset[str] = frozenset({"member", "self", "device", "manage", "admin"})
DEVICE_DISPLAY_NAME = "Shared device"
MANAGER_ROLES: tuple[str, ...] = ("editor", "admin")   # roles at the manage level
_ACTOR_KEY = "tasting.actor"


@dataclass(frozen=True)
class Actor:
    kind: Literal["user", "device"]
    group_id: int
    user_id: int | None          # user sessions; for devices, from the picked member
    member_id: int | None        # user: their member row; device: the picked member
    role: Literal["admin", "editor", "member"] | None   # None on a device
    display_name: str


def _deny(status: int, error: str):
    abort(make_response(jsonify({"error": error}), status))


def _resolve_actor() -> Actor:
    session = current_session()
    if session is None:
        _deny(401, "unauthorized")
    if session.kind == "device":
        return Actor(kind="device", group_id=session.device_group_id, user_id=None,
                     member_id=None, role=None, display_name=DEVICE_DISPLAY_NAME)
    rows = db.session.execute(
        db.select(Member).where(Member.user_id == session.user_id, Member.active.is_(True))
        .limit(2)).scalars().all()
    if not rows:
        _deny(403, "no_group")
    if len(rows) > 1:
        _deny(403, "ambiguous_group")
    member = rows[0]
    return Actor(kind="user", group_id=member.group_id, user_id=session.user_id,
                 member_id=member.id, role=member.role, display_name=member.display_name)


def _allowed(actor: Actor, level: str) -> bool:
    if level == "member":
        return True
    if level == "device":
        return actor.kind == "device"
    if actor.kind != "user":
        return False
    if level == "self":
        return True
    if level == "manage":
        return actor.role in MANAGER_ROLES
    return actor.role == "admin"  # level == "admin"


def require(level: Level):
    """Route decorator: resolve the session into an Actor before the route body
    runs (so the rolling bump commits before any write is staged), then 401
    without a session and 403 when the level is not met. Put it outside
    ``handle_db_errors``."""
    if level not in LEVELS:
        raise ValueError(f"unknown access level: {level!r}")

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            # Per request, not flask.g: g outlives one request inside an
            # outer app context and would carry an actor into the next.
            request.environ.pop(_ACTOR_KEY, None)
            actor = _resolve_actor()
            if not _allowed(actor, level):
                _deny(403, "forbidden")
            request.environ[_ACTOR_KEY] = actor
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def current_actor() -> Actor:
    """The Actor for this request. Only valid inside a ``require``-decorated route."""
    actor = request.environ.get(_ACTOR_KEY)
    if actor is None:
        raise RuntimeError("current_actor() called outside a require()-gated route")
    return actor


def actor_for_pick(member_id) -> Actor:
    """The Actor for a device write made as a picked member: 404 unless the member
    is in the device's group, 422 ``member_inactive`` if they are inactive."""
    device = current_actor()
    if device.kind != "device":
        raise RuntimeError("actor_for_pick() is for device sessions only")
    member = db.session.execute(
        db.select(Member).where(Member.id == member_id, Member.group_id == device.group_id)
    ).scalar_one_or_none() if is_pg_int(member_id) else None
    if member is None:
        _deny(404, "not_found")
    if not member.active:
        _deny(422, "member_inactive")
    return Actor(kind="device", group_id=device.group_id, user_id=member.user_id,
                 member_id=member.id, role=None, display_name=member.display_name)
