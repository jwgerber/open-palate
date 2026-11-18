"""/api/tasting: coffees, coffee CSV, sessions, and the content files.

Every route is gated by ``identity.access.require(level)`` outside
``handle_db_errors`` and commits itself; the repository only flushes. Who is
asking comes from ``current_actor()``. A shared device may name the taster with
``member_id`` (``actor_for_pick``); a signed-in person may not.

Decisions about "a person" branch on ``actor.kind``, never on
``actor.user_id``: a device pick of a linked member carries a user id too.

Flights, tastings, reveal and the palate are added by the flights routes.
"""
import logging
from typing import Optional

from flask import Blueprint, Response, jsonify, make_response, request

from extensions import db
from identity.access import MANAGER_ROLES, Actor, actor_for_pick, current_actor, require
from identity.models import Group
from tasting import coffee_csv as tasting_coffee_csv
from tasting import coffee_sessions as tasting_coffee_sessions
from tasting import content
from tasting import repository as trepo
from tasting.errors import TastingStateError, TastingValidationError
from tasting.repository import TasterIdentity
from utils import get_json_object, handle_db_errors, is_pg_int, to_group_local, utc_now

logger = logging.getLogger(__name__)
tasting_bp = Blueprint("tasting", __name__, url_prefix="/api/tasting")
content_bp = Blueprint("content", __name__, url_prefix="/api")

MAX_IMPORT_BYTES = 5 * 1024 * 1024


def _group_timezone(group_id: int) -> str:
    return db.session.get(Group, group_id).timezone


def _is_manager(actor: Actor) -> bool:
    return actor.kind == "user" and actor.role in MANAGER_ROLES


def _member_id_arg() -> Optional[int]:
    """The ``member_id`` query arg, parsed strictly: absent is None, anything
    that is not a positive Postgres integer is 400 ``bad_member_id``."""
    raw = request.args.get("member_id")
    if raw is None:
        return None
    if not (raw.isascii() and raw.isdigit() and is_pg_int(int(raw))):
        raise TastingValidationError("member_id", "bad_member_id")
    return int(raw)


def _taster(member_id=None) -> tuple[Actor, Optional[TasterIdentity]]:
    """The session's actor and who is tasting, if anyone. A shared device
    names a member with ``member_id``; without one it has no identity yet
    (reads still work, nothing reads as "yours"). A person naming someone
    else is a 400."""
    actor = current_actor()
    if actor.kind == "device":
        if member_id is None:
            return actor, None
        return actor, TasterIdentity.from_actor(actor_for_pick(member_id))
    if member_id is not None:
        raise TastingValidationError("member_id", "only a shared device picks a name")
    return actor, TasterIdentity.from_actor(actor)


def _coffee_or_404(group_id: int, coffee_id):
    coffee = trepo.get_coffee(group_id, coffee_id) if is_pg_int(coffee_id) else None
    if coffee is None:
        return None, (jsonify({"error": "Coffee not found"}), 404)
    return coffee, None


# ---------------------------------------------------------------------------
# content
# ---------------------------------------------------------------------------

@content_bp.get("/content")
@require("member")
@handle_db_errors("Failed to load content")
def get_content():
    lex = content.get()
    response = make_response(jsonify(lex.to_json()))
    response.set_etag(lex.etag)
    response.headers["Cache-Control"] = "private, no-cache"
    return response.make_conditional(request)


# ---------------------------------------------------------------------------
# coffees
# ---------------------------------------------------------------------------

@tasting_bp.get("/coffees")
@require("member")
@handle_db_errors("Failed to load coffees")
def list_coffees():
    include_archived = request.args.get("include_archived", "").lower() in ("1", "true")
    actor = current_actor()
    who = None
    if request.args.get("mine", "").lower() in ("1", "true"):
        actor, who = _taster(_member_id_arg())
    coffees = trepo.list_coffees(actor.group_id, include_archived=include_archived, who=who)
    return jsonify({"coffees": coffees, "roasters": trepo.list_roasters(actor.group_id)})


@tasting_bp.get("/coffees/match")
@require("member")
@handle_db_errors("Failed to match coffee")
def match_coffee():
    q = (request.args.get("q") or "")[:200]
    return jsonify({"match": trepo.match_coffee(current_actor().group_id, q)})


@tasting_bp.post("/coffees")
@require("member")
@handle_db_errors("Failed to add coffee")
def create_coffee():
    actor = current_actor()
    data, err = get_json_object()
    if err:
        return err
    created_by = actor.user_id if actor.kind == "user" else None
    coffee = trepo.create_coffee(actor.group_id, data, created_by=created_by)
    db.session.commit()
    return jsonify(trepo.coffee_detail(coffee)), 201


@tasting_bp.get("/coffees/<int:coffee_id>")
@require("member")
@handle_db_errors("Failed to load coffee")
def get_coffee(coffee_id):
    actor, who = _taster(_member_id_arg())
    coffee, err = _coffee_or_404(actor.group_id, coffee_id)
    if err:
        return err
    detail = trepo.coffee_detail(coffee, who)
    # Lean is for a person; a name picked on a shared device is not "you".
    detail["your_lean"] = (tasting_coffee_sessions.your_lean(coffee, who)
                           if actor.kind == "user" else None)
    return jsonify(detail)


@tasting_bp.get("/coffees/<int:coffee_id>/sessions")
@require("member")
@handle_db_errors("Failed to load sessions")
def coffee_sessions(coffee_id):
    actor, identity = _taster(_member_id_arg())
    coffee, err = _coffee_or_404(actor.group_id, coffee_id)
    if err:
        return err
    sheet = request.args.get("sheet")
    if sheet not in (None, "basic", "advanced"):
        raise TastingValidationError("sheet", "sheet must be basic or advanced")
    # "You" is a person, never a name picked on a shared device.
    who = identity if actor.kind == "user" else None
    return jsonify(tasting_coffee_sessions.coffee_sessions(
        coffee, who, tz=_group_timezone(actor.group_id),
        can_name=lambda flight: trepo.may_see_named(flight, actor),
        include_all_solo=_is_manager(actor),
        before=request.args.get("before", type=int),
        sheet=sheet))


@tasting_bp.patch("/coffees/<int:coffee_id>")
@require("manage")
@handle_db_errors("Failed to update coffee")
def update_coffee(coffee_id):
    actor = current_actor()
    coffee, err = _coffee_or_404(actor.group_id, coffee_id)
    if err:
        return err
    data, err = get_json_object()
    if err:
        return err
    trepo.update_coffee(coffee, data)
    db.session.commit()
    return jsonify(trepo.coffee_detail(coffee))


def _set_archived(coffee_id: int, archived: bool):
    coffee, err = _coffee_or_404(current_actor().group_id, coffee_id)
    if err:
        return err
    trepo.set_archived(coffee, archived)
    db.session.commit()
    return jsonify(trepo.coffee_detail(coffee))


@tasting_bp.post("/coffees/<int:coffee_id>/archive")
@require("manage")
@handle_db_errors("Failed to archive coffee")
def archive_coffee(coffee_id):
    return _set_archived(coffee_id, True)


@tasting_bp.post("/coffees/<int:coffee_id>/unarchive")
@require("manage")
@handle_db_errors("Failed to unarchive coffee")
def unarchive_coffee(coffee_id):
    return _set_archived(coffee_id, False)


# ---------------------------------------------------------------------------
# coffee CSV
# ---------------------------------------------------------------------------

def _read_import_csv():
    """The uploaded CSV as text: (text, None) or (None, error response)."""
    file = request.files.get("file")
    if file is None or file.filename == "":
        return None, (jsonify({"error": "No file provided"}), 400)
    if not file.filename.lower().endswith(".csv"):
        return None, (jsonify({"error": "Only CSV files are supported"}), 400)
    file.seek(0, 2)
    size = file.tell()
    file.seek(0)
    if size > MAX_IMPORT_BYTES:
        return None, (jsonify({"error": "File too large. Maximum size is 5MB."}), 413)
    try:
        return file.read().decode("utf-8-sig"), None
    except UnicodeDecodeError:
        return None, (jsonify({"error": "File must be UTF-8 encoded CSV"}), 400)


@tasting_bp.get("/coffees/export.csv")
@require("manage")
@handle_db_errors("Failed to export coffees")
def export_coffees_csv():
    actor = current_actor()
    day = to_group_local(utc_now(), _group_timezone(actor.group_id)).date()
    return Response(tasting_coffee_csv.export_csv(actor.group_id), mimetype="text/csv", headers={
        "Content-Disposition": f'attachment; filename="coffees-{day}.csv"'})


@tasting_bp.post("/coffees/import/preview")
@require("manage")
@handle_db_errors("Failed to preview coffee import")
def preview_coffee_import():
    """Dry-run a coffee CSV: report what would change. Writes nothing."""
    text, err = _read_import_csv()
    if err:
        return err
    return jsonify(tasting_coffee_csv.build_plan(text, current_actor().group_id).to_json())


@tasting_bp.post("/coffees/import")
@require("manage")
@handle_db_errors("Failed to import coffees")
def import_coffees():
    """Apply a coffee CSV. The plan is rebuilt from the file against the current
    database and must match the previewed plan_hash, so a stale preview is refused."""
    actor = current_actor()
    text, err = _read_import_csv()
    if err:
        return err
    plan_hash = (request.form.get("plan_hash") or "").strip()
    if not plan_hash:
        return jsonify({"error": "plan_hash is required: preview the file first",
                        "field": "plan_hash"}), 400
    plan = tasting_coffee_csv.build_plan(text, actor.group_id)
    if plan.has_errors:
        return jsonify(plan.to_json()), 422
    if plan.plan_hash != plan_hash:
        raise TastingStateError("plan_stale", "Data changed since preview: re-preview")
    created, updated = tasting_coffee_csv.apply_plan(plan, actor.group_id, created_by=actor.user_id)
    db.session.commit()
    logger.info("Coffee CSV import: %d created, %d updated, %d skipped (group %s, user %s)",
                created, updated, len(plan.skipped), actor.group_id, actor.user_id)
    return jsonify({"created": created, "updated": updated, "unchanged": plan.unchanged_count,
                    "skipped": len(plan.skipped)})
