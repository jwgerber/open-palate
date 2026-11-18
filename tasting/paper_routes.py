"""/api/tasting paper sheets (typed in, or scanned into a pre-fill) and the
flight CSV upload. Registered on ``tasting.routes.tasting_bp``.

Paper entry and scan: the host (either door) or an editor/admin. The sheet's
taster is exactly one of a group member (``taster_member_id``) or a typed
``guest_name``; the body's ``member_id`` stays the shared device's pick of who
is entering it.

Scan is off (404 ``scan_disabled``) unless the install has ``ANTHROPIC_API_KEY``.
Photos are never stored or logged.
"""
import json
import logging

from flask import abort, jsonify, make_response, request
from sqlalchemy.exc import IntegrityError

from extensions import db, limiter
from identity.access import current_actor, require
from identity.models import Member
from tasting import flight_csv
from tasting import flights_repository as frepo
from tasting import scan
from tasting.errors import TastingStateError, TastingValidationError
from tasting.flight_routes import _advanced_or_404, body_member_id, taster_required
from tasting.repository import NAME_MAX, TasterIdentity, blind_cup_label
from tasting.routes import _is_manager, _read_import_csv, tasting_bp
from utils import get_json_object, handle_db_errors, is_pg_int

logger = logging.getLogger(__name__)


def _may_enter_paper(flight, actor, who):
    """Why the caller may NOT type or scan a sheet into this cupping, or None."""
    if _is_manager(actor) or frepo.is_host(flight, who):
        return None
    return "Only the host or an editor can enter a paper sheet"


def _paper_taster(group_id: int, data: dict) -> TasterIdentity:
    """Whose sheet this is: a group member OR a guest name, exactly one."""
    member_id, guest_name = data.get("taster_member_id"), data.get("guest_name")
    if (member_id is None) == (guest_name is None):
        raise TastingValidationError("taster", "Name the taster: a member or a guest, not both")
    if member_id is not None:
        if not is_pg_int(member_id):
            raise TastingValidationError("taster_member_id", "Pick someone on this group's roster")
        member = db.session.execute(db.select(Member).where(
            Member.id == member_id, Member.group_id == group_id,
            Member.is_sample.is_(False))).scalar_one_or_none()
        if member is None:
            abort(make_response(jsonify({"error": "not_found"}), 404))
        if not member.active:
            abort(make_response(jsonify({"error": "member_inactive"}), 422))
        return TasterIdentity.paper(member_id=member.id, member_name=member.display_name)
    name = guest_name.strip() if isinstance(guest_name, str) else ""
    if not name or len(name) > NAME_MAX:
        raise TastingValidationError("guest_name", f"Guest name must be 1-{NAME_MAX} characters")
    return TasterIdentity.paper(guest_name=name)


@tasting_bp.post("/flights/<int:flight_id>/paper")
@require("member")
@handle_db_errors("Failed to enter paper sheet")
def enter_paper_sheet(flight_id):
    """Type a printed advanced sheet in as someone else's read, open or closed
    (paper is usually typed up afterwards)."""
    flight, err = _advanced_or_404(flight_id)
    if err:
        return err
    data, err = get_json_object()
    if err:
        return err
    actor, who = taster_required(body_member_id(data))
    refusal = _may_enter_paper(flight, actor, who)
    if refusal:
        db.session.rollback()
        return jsonify({"error": refusal}), 403
    taster = _paper_taster(actor.group_id, data)
    entered_by = actor.user_id if actor.kind == "user" else None
    try:
        rows = frepo.log_paper_tastings(flight, data.get("entries"), taster, entered_by=entered_by)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        if frepo.get_flight(actor.group_id, flight_id) is None:
            return jsonify({"error": "Flight not found"}), 404
        raise TastingStateError("already_logged", f"{taster.name} already has a read in this cupping")
    return jsonify({"taster_key": taster.taster_key, "taster_name": taster.name, "count": len(rows)}), 201


# ---------------------------------------------------------------------------
# scan
# ---------------------------------------------------------------------------

SCAN_PHOTO_TYPES = {"image/jpeg", "image/png", "image/webp"}
SCAN_PHOTO_MAX_BYTES = 3_500_000  # base64 grows it by a third; Claude's cap is 5 MB
SCAN_REQUEST_SLACK_BYTES = 64_000  # multipart framing + form fields
SCAN_UNAVAILABLE = "Couldn't read the photo right now — type the sheet in instead."
SCAN_UNREADABLE = "Couldn't read this photo — try a sharper, flatter shot, or type it in."


def _sniff_image_type(data: bytes):
    """The image type the bytes really are, or None. The client's header is not trusted."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _check_scan_size():
    """400 on ``photos`` for an oversize body, before request.form/files is parsed."""
    if (request.content_length or 0) > 2 * SCAN_PHOTO_MAX_BYTES + SCAN_REQUEST_SLACK_BYTES:
        raise TastingValidationError("photos", "Upload is too large — each photo must be under 3.5 MB")


def _scan_photos(page_count: int) -> list:
    """The photos as [(bytes, sniffed type)], or a 400 on ``photos``. Each file is
    read one byte past the cap so an oversize one is never held whole."""
    files = request.files.getlist("photos")
    if not files:
        raise TastingValidationError("photos", "Add a photo of the sheet")
    if len(files) > page_count:
        raise TastingValidationError(
            "photos", f"This cupping has {page_count} page(s) — add at most {page_count} photo(s)")
    photos = []
    for f in files:
        if f.mimetype not in SCAN_PHOTO_TYPES:
            raise TastingValidationError("photos", "Photos must be JPEG, PNG or WebP")
        data = f.stream.read(SCAN_PHOTO_MAX_BYTES + 1)
        if len(data) > SCAN_PHOTO_MAX_BYTES:
            raise TastingValidationError("photos", "Each photo must be under 3.5 MB")
        sniffed = _sniff_image_type(data)
        if sniffed is None:
            raise TastingValidationError("photos", "Photos must be JPEG, PNG or WebP")
        photos.append((data, sniffed))
    return photos


def _form_member_id():
    """``member_id`` from the multipart form: absent is None, else a strict int."""
    raw = request.form.get("member_id")
    if raw in (None, ""):
        return None
    if not (raw.isascii() and raw.isdigit() and is_pg_int(int(raw))):
        raise TastingValidationError("member_id", "bad_member_id")
    return int(raw)


@tasting_bp.post("/flights/<int:flight_id>/paper/scan")
@require("member")
@limiter.limit("10/minute")
@handle_db_errors("Failed to scan paper sheet")
def scan_paper_sheet(flight_id):
    """Read 1-2 photos of a printed advanced sheet into a pre-fill for paper entry.
    Writes nothing and keeps nothing: photos are never stored or logged (Werkzeug
    may spool a large part to an unnamed temp file deleted with the request)."""
    if not scan.enabled():
        return jsonify({"error": "scan_disabled"}), 404
    flight, err = _advanced_or_404(flight_id)
    if err:
        return err
    _check_scan_size()   # before any form parsing
    actor, who = taster_required(_form_member_id())
    refusal = _may_enter_paper(flight, actor, who)
    if refusal:
        db.session.rollback()
        return jsonify({"error": refusal}), 403
    ordered = sorted(flight.coffees, key=lambda fc: fc.position)
    per_page = scan.CUPS_PER_PAGE
    page_count = max(1, -(-len(ordered) // per_page))
    photos = _scan_photos(page_count)
    step = float(flight.adv_step)
    # A blind flight sends blind labels open or closed, so names never reach the prompt.
    labels = [blind_cup_label(fc) if flight.is_blind else fc.coffee.name for fc in ordered]
    pages = []
    try:
        for index, (data, mime_type) in enumerate(photos):
            # The page is unknown until Claude reads the footer, so a one-page
            # cupping gets every label; two pages get that page's six.
            page_labels = labels if page_count == 1 else labels[index * per_page:(index + 1) * per_page]
            pages.append(scan.read_page(data, mime_type, page_labels, step))
    except scan.ScanUnavailable:
        return jsonify({"error": SCAN_UNAVAILABLE}), 503
    except scan.ScanUnreadable:
        return jsonify({"error": SCAN_UNREADABLE}), 422
    result = scan.normalize_scan(pages, [scan.ScanCup(fc.position, label) for fc, label in zip(ordered, labels)],
                                 flight.id, step)
    logger.info("Paper scan flight_id=%s photos=%d model=%s cups_filled=%d warnings=%d",
                flight.id, len(photos), scan.configured_model(), len(result.cups), len(result.warnings))
    return jsonify(result.to_dict())


# ---------------------------------------------------------------------------
# flight CSV upload
# ---------------------------------------------------------------------------

def _flights_field():
    """The ticked flight names from the form: (names, None) or (None, error response)."""
    def bad(msg):
        return None, (jsonify({"error": msg, "field": "flights"}), 400)
    try:
        names = json.loads(request.form.get("flights") or "")
    except ValueError:
        return bad("flights must be a JSON list of flight names")
    if not isinstance(names, list) or not names or not all(isinstance(n, str) for n in names):
        return bad("flights must be a non-empty list of flight names")
    return names, None


@tasting_bp.post("/flights/import/preview")
@require("manage")
@handle_db_errors("Failed to preview flight upload")
def preview_flight_import():
    """Dry-run a flights CSV. The body carries counts and names only, never a cup."""
    text, err = _read_import_csv()
    if err:
        return err
    return jsonify(flight_csv.build_plan(text, current_actor().group_id).to_json())


@tasting_bp.post("/flights/import")
@require("manage")
@handle_db_errors("Failed to upload flights")
def import_flights():
    """Open the ticked flights from a CSV as shared blind flights hosted by the
    caller. The plan is rebuilt from the file and must match the previewed hash."""
    actor = current_actor()
    text, err = _read_import_csv()
    if err:
        return err
    plan_hash = (request.form.get("plan_hash") or "").strip()
    if not plan_hash:
        return jsonify({"error": "plan_hash is required: preview the file first", "field": "plan_hash"}), 400
    names, err = _flights_field()
    if err:
        return err
    plan = flight_csv.build_plan(text, actor.group_id)
    # Errors block only the flights being opened (a file error blocks all), so a
    # master file with one broken day can still open the others.
    if plan.file_blocked:
        return jsonify(plan.to_json()), 422
    if not set(names) <= {f.name for f in plan.flights}:
        return jsonify({"error": "flights names a flight that is not in the file", "field": "flights"}), 400
    if any(plan.flight_has_errors(n) for n in names):
        return jsonify(plan.to_json()), 422
    if plan.plan_hash != plan_hash:
        raise TastingStateError("plan_stale", "Data changed since preview: re-preview")
    shuffle = request.form.get("shuffle") != "false"
    # No local try/except: handle_db_errors rolls back, so a flight created before a
    # later one fails is never committed.
    made = flight_csv.apply_plan(plan, actor.group_id, names, TasterIdentity.from_actor(actor),
                                 created_by=actor.user_id, shuffle=shuffle)
    body = {"flights": [{"id": f.id, "name": f.name, "prep": f.prep, "sheet": f.sheet,
                         "cup_count": len(f.coffees), "closes_at": f.closes_at.isoformat()} for f in made]}
    db.session.commit()
    logger.info("Flight CSV upload: %d flight(s) opened (group %s, user %s)",
                len(made), actor.group_id, actor.user_id)
    return jsonify(body), 201
