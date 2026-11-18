"""/api/tasting flight routes: flights, tastings, close, timer, label key, cup
edit, deletes, reveal, the advanced summary and CSV, and the palate.

Registered on ``tasting.routes.tasting_bp``; paper entry, scan and the flight CSV
upload live in ``tasting/paper_routes.py``. Every route is gated by
``require(level)`` outside ``handle_db_errors`` and commits itself.

Who is asking: a person is their own account; a shared device names the taster
with ``member_id`` (query on a read, body on a write), resolved by
``actor_for_pick`` (another group's member 404, an inactive one 422). Writes that
need a taster refuse an unpicked device with 400 ``field: member_id``.

Host powers (close, timer, paper, the label key and cup edit on the account door)
follow ``flights_repository.is_host``. Decisions about "a person" branch on
``actor.kind``, never on ``actor.user_id``: a device pick of a linked member
carries a user id too.
"""
import logging
from typing import Optional

from flask import Response, jsonify, request
from sqlalchemy.exc import IntegrityError

from extensions import db
from identity.access import Actor, current_actor, require
from identity.models import Member
from tasting import cupping
from tasting import flight_edit
from tasting import flights_repository as frepo
from tasting import repository as trepo
from tasting.coffee_sessions import session_date
from tasting.errors import TastingStateError, TastingValidationError
from tasting.palate import palate
from tasting.repository import TasterIdentity
from tasting.routes import _group_timezone, _is_manager, _member_id_arg, _taster, tasting_bp
from utils import get_json_object, handle_db_errors, is_pg_int

logger = logging.getLogger(__name__)


def body_member_id(data: dict) -> Optional[int]:
    """``member_id`` from a JSON body: absent is None; anything that is not a
    positive Postgres integer is 400 ``bad_member_id``."""
    raw = data.get("member_id")
    if raw is None:
        return None
    if not is_pg_int(raw):
        raise TastingValidationError("member_id", "bad_member_id")
    return raw


def taster_required(member_id) -> tuple[Actor, TasterIdentity]:
    """The actor and who is tasting, for a write that needs a taster."""
    actor, who = _taster(member_id)
    if who is None:
        raise TastingValidationError("member_id", "Pick who's tasting")
    return actor, who


def flight_or_404(group_id: int, flight_id):
    flight = frepo.get_flight(group_id, flight_id)
    if flight is None:
        return None, (jsonify({"error": "Flight not found"}), 404)
    return flight, None


def _advanced_or_404(flight_id):
    flight, err = flight_or_404(current_actor().group_id, flight_id)
    if err or flight.sheet != "advanced":
        return None, err or (jsonify({"error": "Flight not found"}), 404)
    return flight, None


def _is_admin(actor: Actor) -> bool:
    return actor.kind == "user" and actor.role == "admin"


# ---------------------------------------------------------------------------
# flights
# ---------------------------------------------------------------------------

@tasting_bp.get("/flights/recent")
@require("member")
@handle_db_errors("Failed to load recent flights")
def recent_flights():
    actor, who = taster_required(_member_id_arg())
    flights = frepo.recent_flights(actor.group_id, who)
    db.session.commit()   # expire_if_due may have flipped a flight closed
    return jsonify({"flights": flights, "me": {"name": who.name, "created_via": who.created_via}})


@tasting_bp.post("/flights")
@require("member")
@handle_db_errors("Failed to log flight")
def create_flight():
    data, err = get_json_object()
    if err:
        return err
    actor, who = taster_required(body_member_id(data))
    flight = frepo.create_flight(actor.group_id, data, who)
    db.session.commit()
    body = frepo.flight_dict(flight, who)
    if not flight.is_open and flight.sheet == "basic":
        body["reveal"] = frepo.reveal_flight(flight, who)
    return jsonify(body), 201


@tasting_bp.get("/flights/<int:flight_id>")
@require("member")
@handle_db_errors("Failed to load flight")
def get_flight(flight_id):
    actor, who = _taster(_member_id_arg())
    flight, err = flight_or_404(actor.group_id, flight_id)
    if err:
        return err
    db.session.commit()
    return jsonify(frepo.flight_dict(flight, who))


@tasting_bp.post("/flights/<int:flight_id>/tastings")
@require("member")
@handle_db_errors("Failed to log tastings")
def log_tastings(flight_id):
    flight, err = flight_or_404(current_actor().group_id, flight_id)
    if err:
        return err
    data, err = get_json_object()
    if err:
        return err
    actor, who = taster_required(body_member_id(data))
    try:
        frepo.log_tastings(flight, data.get("entries"), who)
        db.session.commit()
    except IntegrityError:
        # Two taps racing past the Python check, or a device read and a phone read
        # of one person: the partial unique index is the real guard, and it must
        # answer the same 409, unless the flight itself went away (the FK).
        db.session.rollback()
        if frepo.get_flight(actor.group_id, flight_id) is None:
            return jsonify({"error": "Flight not found"}), 404
        raise TastingStateError("already_logged", "You've already logged this flight")
    return jsonify(frepo.flight_dict(frepo.get_flight(actor.group_id, flight_id), who)), 201


@tasting_bp.post("/flights/<int:flight_id>/close")
@require("member")
@handle_db_errors("Failed to close flight")
def close_flight(flight_id):
    flight, err = flight_or_404(current_actor().group_id, flight_id)
    if err:
        return err
    data, err = get_json_object(optional=True)
    if err:
        return err
    actor, who = taster_required(body_member_id(data))
    if not frepo.is_host(flight, who) and not _is_admin(actor):
        db.session.rollback()
        return jsonify({"error": "Only the host can close this flight"}), 403
    frepo.close_flight(flight)
    db.session.commit()
    return jsonify(frepo.flight_dict(flight, who))


@tasting_bp.get("/flights/<int:flight_id>/label-key")
@require("self")
@handle_db_errors("Failed to load label key")
def get_label_key(flight_id):
    """Never on a device: ``self`` refuses every device session at the decorator."""
    actor = current_actor()
    flight, err = flight_or_404(actor.group_id, flight_id)
    if err:
        return err
    if not frepo.is_host(flight, TasterIdentity.from_actor(actor)):
        return jsonify({"error": "Only the host can see the label key"}), 403
    if not flight.is_blind:
        raise TastingStateError("not_blind", "This flight isn't blind")
    return jsonify({"cups": frepo.label_key(flight)})


@tasting_bp.put("/flights/<int:flight_id>/cups")
@require("self")
@handle_db_errors("Failed to save flight")
def edit_flight_cups(flight_id):
    """Rename, add, reorder and remove cups in one save, until tasting begins. The
    answer names the cups, so the gate is the label key's: the account-door host."""
    actor = current_actor()
    flight, err = flight_or_404(actor.group_id, flight_id)
    if err:
        return err
    data, err = get_json_object()
    if err:
        return err
    if not frepo.is_host(flight, TasterIdentity.from_actor(actor)):
        return jsonify({"error": "Only the host can edit this flight"}), 403
    # A rename edits the coffee itself, which PATCH /coffees/<id> keeps to manage.
    if flight_edit.body_has_name(data) and not _is_manager(actor):
        return jsonify({"error": "Only an editor can rename a coffee"}), 403
    if not flight.is_blind:
        raise TastingStateError("not_blind", "This flight isn't blind")
    reason = flight_edit.lock_reason(flight)
    if reason:
        raise TastingStateError("flight_locked", reason)
    flight_edit.edit_cups(flight, data)
    db.session.commit()
    return jsonify({"cups": frepo.label_key(flight)})


def _timer_preamble(flight_id, data):
    """Shared by /timer and /pass: 404 (missing, or not advanced), then the
    taster, then host-or-manage 403. Returns (flight, who, error)."""
    flight, err = _advanced_or_404(flight_id)
    if err:
        return None, None, err
    actor, who = taster_required(body_member_id(data))
    if not (frepo.is_host(flight, who) or _is_manager(actor)):
        db.session.rollback()
        return None, None, (jsonify({"error": "Only the host or an editor can run the timer"}), 403)
    return flight, who, None


@tasting_bp.post("/flights/<int:flight_id>/timer")
@require("member")
@handle_db_errors("Failed to start timer")
def start_timer(flight_id):
    data, err = get_json_object(optional=True)
    if err:
        return err
    flight, who, err = _timer_preamble(flight_id, data)
    if err:
        return err
    frepo.start_timer(flight)
    db.session.commit()
    return jsonify(frepo.flight_dict(flight, who))


@tasting_bp.post("/flights/<int:flight_id>/pass")
@require("member")
@handle_db_errors("Failed to set pass")
def set_pass(flight_id):
    data, err = get_json_object()
    if err:
        return err
    flight, who, err = _timer_preamble(flight_id, data)
    if err:
        return err
    value = data.get("pass")
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 3:
        raise TastingValidationError("pass", "pass must be an integer from 1 to 3")
    frepo.set_pass(flight, value)
    db.session.commit()
    return jsonify(frepo.flight_dict(flight, who))


# ---------------------------------------------------------------------------
# deletes
# ---------------------------------------------------------------------------

def _may_delete_read(flight, rows, actor: Actor, who) -> Optional[str]:
    """Why the caller may NOT delete these rows, or None. A hard delete is
    irreversible:
    - an editor/admin may delete any read;
    - the shared device may not delete at all: anyone at it can pick anyone, and
      logging as someone is additive while deleting their read is not;
    - a paper read is the host's typing: the account-door host may retract it at
      any time (delete then re-enter is how a typo gets fixed);
    - someone else's read needs an editor;
    - a read on a closed flight others logged into has been revealed to the room."""
    if _is_manager(actor):
        return None
    if actor.kind == "device":
        return "Delete a tasting from your own phone, not the shared device"
    if frepo.is_paper_read(rows) and frepo.is_host(flight, who):
        return None
    if not frepo.is_own_read(rows, who):
        return "Only an editor can delete someone else's tasting"
    if not flight.is_open and frepo.others_logged(flight, who):
        return "This flight has been revealed — only an editor can delete a read now"
    return None


@tasting_bp.delete("/flights/<int:flight_id>/tastings")
@require("member")
@handle_db_errors("Failed to delete tasting")
def delete_tastings(flight_id):
    """Delete one person's read of the flight: the caller's own by default, or
    ``?taster_key=`` for someone else's (editor+)."""
    actor, who = _taster(_member_id_arg())
    flight, err = flight_or_404(actor.group_id, flight_id)
    if err:
        return err
    rows = frepo.reads_of(flight, who=who, taster_key=request.args.get("taster_key") or None)
    if not rows:
        db.session.rollback()
        return jsonify({"error": "No tasting of theirs on this flight"}), 404
    refusal = _may_delete_read(flight, rows, actor, who)
    if refusal:
        db.session.rollback()
        return jsonify({"error": refusal}), 403
    result = frepo.delete_tastings(flight, rows)
    db.session.commit()
    return jsonify(result)


@tasting_bp.delete("/flights/<int:flight_id>")
@require("member")
@handle_db_errors("Failed to delete flight")
def delete_flight(flight_id):
    """Delete a whole flight: the account-door host while nobody else has logged,
    an editor/admin always."""
    actor, who = _taster(_member_id_arg())
    flight, err = flight_or_404(actor.group_id, flight_id)
    if err:
        return err
    host_alone = actor.kind == "user" and frepo.is_host(flight, who) and not frepo.others_logged(flight, who)
    if not (_is_manager(actor) or host_alone):
        db.session.rollback()
        return jsonify({"error": "Only the host can delete this flight, and only before anyone else logs"}), 403
    result = frepo.delete_flight(flight)
    db.session.commit()
    return jsonify(result)


# ---------------------------------------------------------------------------
# reveal, summary, CSV
# ---------------------------------------------------------------------------

@tasting_bp.get("/flights/<int:flight_id>/reveal")
@require("member")
@handle_db_errors("Failed to load reveal")
def reveal_flight(flight_id):
    actor, who = _taster(_member_id_arg())
    flight, err = flight_or_404(actor.group_id, flight_id)
    if err:
        return err
    db.session.commit()   # persist a lazy expiry even when the reveal refuses
    return jsonify(frepo.reveal_flight(flight, who))


@tasting_bp.get("/flights/<int:flight_id>/summary")
@require("member")
@handle_db_errors("Failed to load summary")
def flight_summary(flight_id):
    actor, who = _taster(_member_id_arg())
    flight, err = _advanced_or_404(flight_id)
    if err:
        return err
    db.session.commit()
    if flight.is_open:
        raise TastingStateError("flight_open", "The summary waits until the cupping is closed")
    return jsonify(cupping.build_summary(flight, who, named=trepo.may_see_named(flight, actor)))


@tasting_bp.get("/flights/<int:flight_id>/export.csv")
@require("member")
@handle_db_errors("Failed to export cupping")
def export_cupping_csv(flight_id):
    actor = current_actor()
    flight, err = _advanced_or_404(flight_id)
    if err:
        return err
    db.session.commit()   # persist a lazy expiry
    # Refuse before revealing whether the flight is still open.
    if not trepo.may_see_named(flight, actor):
        return jsonify({"error": "Only the host or a manager can export this cupping"}), 403
    if flight.is_open:
        raise TastingStateError("flight_open", "The export waits until the cupping is closed")
    tz = _group_timezone(actor.group_id)
    return Response(cupping.build_csv(flight, tz=tz), mimetype="text/csv", headers={
        "Content-Disposition": f'attachment; filename="cupping-{session_date(flight, tz)}-{flight.id}.csv"'})


# ---------------------------------------------------------------------------
# palate
# ---------------------------------------------------------------------------

@tasting_bp.get("/palate")
@require("self")   # a shared device has no palate of its own
@handle_db_errors("Failed to load palate")
def get_palate():
    actor = current_actor()
    member_ids = db.session.execute(
        db.select(Member.id).where(Member.user_id == actor.user_id)).scalars().all()
    tz = _group_timezone(actor.group_id)
    body = palate(actor.user_id, member_ids, tz=tz)
    body["cupping"] = cupping.cupping_palate(TasterIdentity.from_actor(actor), member_ids, tz=tz)
    return jsonify(body)
