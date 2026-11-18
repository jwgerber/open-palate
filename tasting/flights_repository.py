"""Tasting data access, flight half: flights, tastings, the reveal and hosting.

Validates, flushes, never commits: the route commits. Bad input raises
``TastingValidationError`` (400); a state refusal raises ``TastingStateError``
(409 ``{error, message}``); a coffee id outside the group raises
``CoffeeNotFound`` (404, the same answer as an id that does not exist).

The flight is the container. A solo entry is a flight of one, created closed in
the same transaction as its tastings. A shared flight opens with no tastings,
each taster logs once (``log_tastings``), and the reveal waits for
``close_flight`` or ``closes_at`` (``expire_if_due``, run lazily on every read;
there is no cron).

Blind is blind on the wire: while a blind flight is open ``flight_dict`` names a
cup by its label and position only, for everyone, the host included.

Every lookup is scoped by ``group_id`` here: a flight or coffee from another
group is simply not found. The palate lives in ``tasting/palate.py``.
"""
from datetime import timedelta
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import selectinload
from werkzeug.exceptions import NotFound

from extensions import db
from tasting import content
from tasting.enums import (ADV_CATEGORIES, ADV_DQ_VALUE, ADV_MAX, ADV_MIN, ADV_STEPS, BAR_VOTES,
                           MAX_TAGS_PER_CUP, PREPS, SHEETS, TAG_STRENGTHS)
from tasting.errors import TastingStateError, TastingValidationError
from tasting.models import Tasting, TastingCoffee, TastingDefect, TastingFlight, TastingFlightCoffee, TastingTag
from tasting.repository import (TasterIdentity, _enum, _entry_dict, _load_tastings, _str,
                                blind_cup_label, blind_label, consensus, same_person)
from utils import is_pg_int, utc_now

SHARED_FLIGHT_WINDOW = timedelta(hours=24)
# A flight opened from an uploaded file: the cupping may be the next day or two.
UPLOADED_FLIGHT_WINDOW = timedelta(hours=48)
RECENT_LIMIT = 20


class CoffeeNotFound(NotFound):
    """A coffee id in a body that is not in the caller's group: 404, the same
    answer whether it exists elsewhere or nowhere."""

    def __init__(self, field: str = "coffee_ids"):
        super().__init__()
        self.field = field

    def get_response(self, environ=None, scope=None):
        from flask import jsonify
        db.session.rollback()
        response = jsonify({"error": "Coffee not found", "field": self.field})
        response.status_code = 404
        return response


# ---------------------------------------------------------------------------
# entry validation
# ---------------------------------------------------------------------------

def _scale(data, field, *, required=False):
    value = data.get(field, None)
    if value is None:
        if required:
            raise TastingValidationError(field, f"{field} is required")
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 5:
        raise TastingValidationError(field, f"{field} must be an integer 1-5")
    return value


def _adv_score(value, field, step):
    """An advanced score: a real number on ``step``, either the DQ value or in [ADV_MIN, ADV_MAX]."""
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise TastingValidationError(field, f"{field} must be a number")
    d = Decimal(str(value))
    # Flask's JSON parser accepts Infinity/NaN; they would die later as InvalidOperation (a 500).
    if not d.is_finite():
        raise TastingValidationError(field, f"{field} must be a finite number")
    if (d * 10) % (step * 10) != 0:
        raise TastingValidationError(field, f"{field} must be in steps of {step}")
    if d != Decimal(str(ADV_DQ_VALUE)) and not Decimal(str(ADV_MIN)) <= d <= Decimal(str(ADV_MAX)):
        raise TastingValidationError(
            field, f"{field} must be {ADV_DQ_VALUE} (disqualified) or between {ADV_MIN} and {ADV_MAX}")
    return d.quantize(Decimal("0.1"))


def _adv_entry(e, i, step):
    """One advanced cup: all ten category scores plus the bar vote; no Overall."""
    # acidity/sweetness/balance are advanced categories too, so only the rest are foreign here.
    for attr in (a for a in content.get().attributes if a not in ADV_CATEGORIES):
        if e.get(attr) is not None:
            raise TastingValidationError("entries", f"entries[{i}].{attr} does not apply to an advanced read")
    scores = {}
    for cat in ADV_CATEGORIES:
        field = f"entries[{i}].{cat}"
        if e.get(cat) is None:
            raise TastingValidationError("entries", f"{field} is required")
        scores[cat] = _adv_score(e[cat], field, step)
    vote = e.get("bar_vote")
    if vote not in BAR_VOTES:
        raise TastingValidationError("entries", f"entries[{i}].bar_vote must be one of {list(BAR_VOTES)}")
    return {"scores": scores, "bar_vote": vote}


def _check_tags(tags, i):
    lex = content.get()
    if not isinstance(tags, dict):
        raise TastingValidationError("entries", f"entries[{i}].tags must be an object")
    if len(tags) > MAX_TAGS_PER_CUP:
        raise TastingValidationError("entries", f"entries[{i}] has more than {MAX_TAGS_PER_CUP} flavors")
    for term, strength in tags.items():
        if not lex.is_valid_term(term):
            raise TastingValidationError("entries", f"entries[{i}] has an unknown flavor {term!r}")
        if strength not in TAG_STRENGTHS:
            raise TastingValidationError("entries", f"entries[{i}] flavor strength must be 2 or 3")
        # "Specific wins": a family never sits beside one of its own leaves, or the
        # read double-counts in consensus.
        if any(a in tags for a in lex.ancestors_of(term)):
            raise TastingValidationError("entries", f"entries[{i}] picks {lex.label_of(term)!r} and a flavor above it")


def _validate_entries(entries, slots, *, sheet="basic", step=None) -> list:
    """``slots`` is [(position, coffee_id)] in pour order. An entry names its cup by
    ``position`` (what a blind taster has) or ``coffee_id``; position wins when both
    are present. An advanced flight may skip cups; a basic one needs every one."""
    if not isinstance(entries, list) or not entries:
        raise TastingValidationError("entries", "entries must be a non-empty list")
    by_position = dict(slots)
    coffee_ids = [cid for _, cid in slots]
    attributes = content.get().attributes
    seen, parsed = set(), []
    for i, e in enumerate(entries):
        if not isinstance(e, dict):
            raise TastingValidationError("entries", f"entries[{i}] must be an object")
        pos = e.get("position")
        if pos is not None:
            if isinstance(pos, bool) or not isinstance(pos, int) or pos not in by_position:
                raise TastingValidationError("entries", f"entries[{i}].position is not a cup in this flight")
            cid = by_position[pos]
        else:
            cid = e.get("coffee_id")
            if isinstance(cid, bool) or cid not in coffee_ids:
                raise TastingValidationError("entries", f"entries[{i}].coffee_id is not in this flight")
        if cid in seen:
            raise TastingValidationError("entries", f"entries[{i}] repeats a cup")
        seen.add(cid)
        if sheet == "advanced":
            adv = _adv_entry(e, i, step)
            vals = {a: None for a in attributes}
        else:
            adv = None
            vals = {a: _scale(e, a, required=(a == "overall")) for a in attributes}
        tags = e.get("tags") or {}
        _check_tags(tags, i)
        defects = e.get("defects") or []
        if not isinstance(defects, list) or any(d not in content.get().defects for d in defects):
            raise TastingValidationError("entries", f"entries[{i}] has an unknown defect")
        parsed.append({
            "coffee_id": cid, "vals": vals,
            "adv": adv["scores"] if adv else None, "bar_vote": adv["bar_vote"] if adv else None,
            "tags": tags, "defects": list(dict.fromkeys(defects)), "note": _str(e, "note", max_len=4000),
        })
    if sheet != "advanced" and any(cid not in seen for cid in coffee_ids):
        raise TastingValidationError("entries", "every cup needs an Overall before the flight is logged")
    return parsed


def _write_tastings(flight: TastingFlight, parsed: list, who: TasterIdentity, *,
                    entered_by: Optional[int] = None) -> list:
    out = []
    for e in parsed:
        # The sheet comes from the flight, never the request: the DB does not tie a
        # tasting's sheet to its flight's, so this is the one place that guarantees it.
        adv = {f"adv_{c}": v for c, v in (e["adv"] or {}).items()}
        t = Tasting(
            flight_id=flight.id, coffee_id=e["coffee_id"], sheet=flight.sheet, bar_vote=e["bar_vote"], **adv,
            user_id=who.user_id, member_id=who.member_id, taster_key=who.taster_key,
            taster_name=who.name, created_via=who.created_via, entered_by_user_id=entered_by,
            note=e["note"], **e["vals"],
        )
        t.tags = [TastingTag(term=k, strength=v) for k, v in e["tags"].items()]
        t.defects = [TastingDefect(term=d) for d in e["defects"]]
        db.session.add(t)
        out.append(t)
    db.session.flush()
    return out


# ---------------------------------------------------------------------------
# flights
# ---------------------------------------------------------------------------

def coffees_in_group(group_id: int, ids: list, field: str = "coffee_ids") -> dict:
    """id -> coffee for every id, all in this group; otherwise ``CoffeeNotFound``."""
    found = {c.id: c for c in db.session.execute(
        db.select(TastingCoffee).where(TastingCoffee.id.in_(ids), TastingCoffee.group_id == group_id)
    ).scalars()} if ids else {}
    if len(found) != len(set(ids)):
        raise CoffeeNotFound(field)
    return found


def _coffee_ids(data) -> list:
    coffee_ids = data.get("coffee_ids")
    if not isinstance(coffee_ids, list) or not coffee_ids:
        raise TastingValidationError("coffee_ids", "pick at least one coffee")
    if any(isinstance(c, bool) or not isinstance(c, int) for c in coffee_ids):
        raise TastingValidationError("coffee_ids", "coffee_ids must be integers")
    if len(set(coffee_ids)) != len(coffee_ids):
        raise TastingValidationError("coffee_ids", "a coffee can only be in a flight once")
    if not all(is_pg_int(c) for c in coffee_ids):
        raise CoffeeNotFound()
    return coffee_ids


def _sheet_and_step(data, prep, shared):
    sheet = _enum(data, "sheet", SHEETS) or "basic"
    if sheet != "advanced":
        if data.get("adv_step") is not None:
            raise TastingValidationError("adv_step", "adv_step only applies to the advanced sheet")
        return sheet, None
    if prep != "cupping":
        raise TastingValidationError("sheet", "the advanced sheet needs prep=cupping")
    if not shared:
        raise TastingValidationError("sheet", "the advanced sheet needs a shared flight")
    raw = data.get("adv_step", ADV_STEPS[0])
    if isinstance(raw, bool) or not isinstance(raw, (int, float)) or raw not in ADV_STEPS:
        raise TastingValidationError("adv_step", f"adv_step must be one of {list(ADV_STEPS)}")
    return sheet, Decimal(str(raw))


def create_flight(group_id: int, data: dict, who: TasterIdentity, *, now=None,
                  blind_labels: Optional[list] = None,
                  window: Optional[timedelta] = None) -> TastingFlight:
    """One write for a solo flight (coffees + tastings, created closed), or an open
    shared flight with no tastings yet. ``blind_labels`` and ``window`` are keywords
    for the CSV upload only; a request body cannot set them. On a shared device the
    host is the picked member and ``host_user_id`` stays NULL."""
    now = now or utc_now()
    coffee_ids = _coffee_ids(data)
    coffees = coffees_in_group(group_id, coffee_ids)
    # The picker hides archived coffees; a stale tab or hand-built body must not
    # keep feeding one by id. A flight already holding one still logs.
    if any(c.archived_at is not None for c in coffees.values()):
        raise TastingValidationError("coffee_ids", "that coffee is archived")
    prep = _enum(data, "prep", PREPS, required=True)
    shared = bool(data.get("shared", False))
    blind = bool(data.get("blind", False))
    if blind and not shared:
        raise TastingValidationError("blind", "only a shared flight can be blind")
    if blind_labels is not None and (not blind or len(blind_labels) != len(coffee_ids)):
        raise ValueError("blind_labels needs a blind flight and one label per coffee")
    sheet, adv_step = _sheet_and_step(data, prep, shared)
    if shared and data.get("entries"):
        raise TastingValidationError("entries", "log a shared flight through /flights/<id>/tastings")

    flight = TastingFlight(
        group_id=group_id, sheet=sheet, adv_step=adv_step, name=_str(data, "name") or None, prep=prep,
        host_user_id=who.user_id if who.created_via == "account" else None,
        host_member_id=who.member_id, host_name=who.name,
        is_shared=shared, is_blind=blind, is_open=shared, created_via=who.created_via,
        opened_at=now, closes_at=now + (window or SHARED_FLIGHT_WINDOW) if shared else now,
        closed_at=None if shared else now,
    )
    for i, cid in enumerate(coffee_ids):
        label = (blind_labels[i] if blind_labels else blind_label(i)) if blind else None
        flight.coffees.append(TastingFlightCoffee(coffee_id=cid, position=i + 1, blind_label=label))
    db.session.add(flight)
    db.session.flush()
    if not shared:
        parsed = _validate_entries(data.get("entries"), [(i + 1, cid) for i, cid in enumerate(coffee_ids)])
        _write_tastings(flight, parsed, who)
    return flight


def get_flight(group_id: int, flight_id, *, now=None) -> Optional[TastingFlight]:
    """The flight with its cups and reads, lazily expired; None outside this group."""
    if not is_pg_int(flight_id):
        return None
    flight = db.session.execute(
        db.select(TastingFlight).options(
            selectinload(TastingFlight.coffees).selectinload(TastingFlightCoffee.coffee),
            selectinload(TastingFlight.tastings).selectinload(Tasting.tags),
            selectinload(TastingFlight.tastings).selectinload(Tasting.defects),
        ).where(TastingFlight.id == flight_id, TastingFlight.group_id == group_id)
    ).scalar_one_or_none()
    if flight is not None:
        expire_if_due(flight, now=now)
    return flight


def expire_if_due(flight: TastingFlight, *, now=None) -> bool:
    """Lazy auto-close: a shared flight past ``closes_at`` closes on its next read."""
    now = now or utc_now()
    if flight.is_open and flight.closes_at is not None and flight.closes_at <= now:
        flight.is_open = False
        flight.closed_at = flight.closes_at
        db.session.flush()
        return True
    return False


def _require_open(flight: TastingFlight, message="This flight is already closed"):
    if not flight.is_open:
        raise TastingStateError("flight_closed", message)


def close_flight(flight: TastingFlight, *, now=None) -> TastingFlight:
    _require_open(flight)
    flight.is_open = False
    flight.closed_at = now or utc_now()
    db.session.flush()
    return flight


def start_timer(flight: TastingFlight, *, now=None) -> TastingFlight:
    """Start (or restart) the cupping timer: stamp now and reset to pass 0
    (the break before the first pass)."""
    _require_open(flight)
    flight.timer_started_at = now or utc_now()
    flight.adv_pass = 0
    db.session.flush()
    return flight


def set_pass(flight: TastingFlight, value: int) -> TastingFlight:
    """Set the absolute pass (1..3). The same value again is a no-op, so a double
    tap or two hosts agreeing cannot skip a pass."""
    _require_open(flight)
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 3:
        raise ValueError("pass must be an integer from 1 to 3")
    if flight.adv_pass is None:
        raise TastingStateError("timer_not_started", "Start the timer first")
    flight.adv_pass = value
    db.session.flush()
    return flight


# ---------------------------------------------------------------------------
# reads
# ---------------------------------------------------------------------------

def _already_logged(flight: TastingFlight, who: TasterIdentity) -> bool:
    return any(same_person(t, who) for t in flight.tastings)


def _step(flight: TastingFlight):
    return Decimal(str(flight.adv_step)) if flight.adv_step is not None else None


def log_tastings(flight: TastingFlight, entries, who: TasterIdentity) -> list:
    _require_open(flight, "This flight is closed")
    if _already_logged(flight, who):
        raise TastingStateError("already_logged", "You've already logged this flight")
    parsed = _validate_entries(entries, [(fc.position, fc.coffee_id) for fc in flight.coffees],
                               sheet=flight.sheet, step=_step(flight))
    return _write_tastings(flight, parsed, who)


def log_paper_tastings(flight: TastingFlight, entries, taster: TasterIdentity, *,
                       entered_by: Optional[int]) -> list:
    """A typed-in paper sheet as ``taster``'s read. Unlike a live read it is
    allowed on a closed flight: paper is usually typed up afterwards."""
    if _already_logged(flight, taster):
        raise TastingStateError("already_logged", f"{taster.name} already has a read in this cupping")
    parsed = _validate_entries(entries, [(fc.position, fc.coffee_id) for fc in flight.coffees],
                               sheet=flight.sheet, step=_step(flight))
    return _write_tastings(flight, parsed, taster, entered_by=entered_by)


def reads_of(flight: TastingFlight, *, who: Optional[TasterIdentity] = None,
             taster_key: Optional[str] = None) -> list:
    """ONE person's read of a flight: every cup they logged in that sitting, by
    ``who`` through every door (``same_person``) or by an explicit ``taster_key``."""
    if taster_key is not None:
        return [t for t in flight.tastings if t.taster_key == taster_key]
    return [t for t in flight.tastings if same_person(t, who)]


def is_own_read(rows: list, who: Optional[TasterIdentity]) -> bool:
    return bool(rows) and all(same_person(t, who) for t in rows)


def is_paper_read(rows: list) -> bool:
    return bool(rows) and all(t.created_via == "paper" for t in rows)


def others_logged(flight: TastingFlight, who: Optional[TasterIdentity]) -> bool:
    return any(not same_person(t, who) for t in flight.tastings)


def delete_tastings(flight: TastingFlight, rows: list) -> dict:
    """Hard-delete one person's read. Only a SOLO flight goes with its last read:
    a shared flight is a live container (people holding the link may be mid-tasting)."""
    if not rows:
        return {"deleted": 0, "flight_deleted": False}
    for t in rows:
        flight.tastings.remove(t)      # delete-orphan issues the DELETE and keeps the collection in sync
    db.session.flush()
    flight_deleted = not flight.is_shared and not flight.tastings
    if flight_deleted:
        db.session.delete(flight)
        db.session.flush()
    return {"deleted": len(rows), "flight_deleted": flight_deleted}


def delete_flight(flight: TastingFlight) -> dict:
    n = len(flight.tastings)
    db.session.delete(flight)
    db.session.flush()
    return {"deleted": n, "flight_deleted": True}


# ---------------------------------------------------------------------------
# hosting and the wire shape
# ---------------------------------------------------------------------------

def _hosts(flight: TastingFlight, user_id, member_id, created_via) -> bool:
    if created_via == "paper":
        return False
    if flight.host_member_id is not None and member_id == flight.host_member_id:
        return True
    return created_via == "account" and flight.host_user_id is not None and user_id == flight.host_user_id


def is_host(flight: TastingFlight, who: Optional[TasterIdentity]) -> bool:
    """Host powers: the hosting member on any door (a device pick, or that member's
    own account), or the hosting account. A paper identity never hosts."""
    return who is not None and _hosts(flight, who.user_id, who.member_id, who.created_via)


def _roster(flight: TastingFlight) -> list:
    logged = {}
    for t in flight.tastings:
        logged.setdefault(t.taster_key, {
            "taster_key": t.taster_key, "name": t.taster_name,
            "is_host": _hosts(flight, t.user_id, t.member_id, t.created_via), "status": "logged"})
    roster = list(logged.values())
    if not any(r["is_host"] for r in roster):
        roster.insert(0, {"taster_key": TasterIdentity.key(flight.created_via, flight.host_user_id,
                                                           flight.host_member_id),
                          "name": flight.host_name, "is_host": True, "status": "tasting"})
    return roster


def _hidden(flight: TastingFlight) -> bool:
    """Blind labels hide the coffee from EVERYONE, the host included, while open."""
    return flight.is_blind and flight.is_open


def label_key(flight: TastingFlight) -> list:
    """Cup label -> coffee, in pour order. The one place names leave an open blind
    flight; the route serves it to the account-door host only."""
    return [{"position": fc.position, "label": blind_cup_label(fc), "coffee_id": fc.coffee_id,
             "name": fc.coffee.name, "roaster": fc.coffee.roaster, "origin": fc.coffee.origin}
            for fc in sorted(flight.coffees, key=lambda fc: fc.position)]


def _timer_elapsed_s(flight: TastingFlight, now=None) -> Optional[int]:
    """Whole seconds since the timer started, server-computed so clients never
    parse the naive-UTC stamp; None until started."""
    if flight.timer_started_at is None:
        return None
    return max(0, int(((now or utc_now()) - flight.timer_started_at).total_seconds()))


def _iso(dt):
    return dt.isoformat() if dt else None


def flight_dict(flight: TastingFlight, who: Optional[TasterIdentity], *, now=None) -> dict:
    """The flight without a single score or tag. While blind and open a cup's id
    and kind stay off the wire too: an id is one GET /coffees/<id> from the name."""
    hidden = _hidden(flight)
    cups = [{
        "coffee_id": None if hidden else fc.coffee_id,
        "position": fc.position,
        "label": blind_cup_label(fc) if hidden else fc.coffee.name,
        "blind": hidden,
        "blind_label": fc.blind_label,
        "name": None if hidden else fc.coffee.name,
        "roaster": None if hidden else fc.coffee.roaster,
        "kind": None if hidden else fc.coffee.kind,
    } for fc in flight.coffees]
    roster = _roster(flight)
    return {
        "id": flight.id, "name": flight.name, "prep": flight.prep, "sheet": flight.sheet,
        "adv_step": float(flight.adv_step) if flight.adv_step is not None else None,
        "timer_started_at": _iso(flight.timer_started_at), "adv_pass": flight.adv_pass,
        "timer_elapsed_s": _timer_elapsed_s(flight, now),
        "host_name": flight.host_name, "is_host": is_host(flight, who),
        "is_shared": flight.is_shared, "is_blind": flight.is_blind, "is_open": flight.is_open,
        "created_via": flight.created_via,
        "opened_at": _iso(flight.opened_at), "closes_at": _iso(flight.closes_at),
        "closed_at": _iso(flight.closed_at),
        "cups": cups, "roster": roster,
        "logged_count": sum(1 for r in roster if r["status"] == "logged"),
        "you_logged": who is not None and _already_logged(flight, who),
    }


def recent_flights(group_id: int, who: TasterIdentity, *, limit: int = RECENT_LIMIT) -> list:
    """The caller's own flights in this group (hosted, or logged into), newest
    first. Never a score. A device pick sees only that member's device-door flights."""
    if who.created_via == "device":
        hosted = db.and_(TastingFlight.created_via == "device", TastingFlight.host_member_id == who.member_id)
        logged = Tasting.taster_key == who.taster_key
    else:
        hosted = db.or_(TastingFlight.host_user_id == who.user_id, TastingFlight.host_member_id == who.member_id)
        logged = db.or_(Tasting.taster_key == who.taster_key, Tasting.user_id == who.user_id,
                        Tasting.member_id == who.member_id)
    logged_ids = db.select(Tasting.flight_id).where(logged)
    flights = db.session.execute(
        db.select(TastingFlight).options(
            selectinload(TastingFlight.coffees).selectinload(TastingFlightCoffee.coffee),
            selectinload(TastingFlight.tastings))
        .where(TastingFlight.group_id == group_id, db.or_(hosted, TastingFlight.id.in_(logged_ids)))
        .order_by(TastingFlight.opened_at.desc(), TastingFlight.id.desc()).limit(limit)).scalars().all()
    now, out = utc_now(), []
    for f in flights:
        expire_if_due(f, now=now)
        d = flight_dict(f, who)
        d["title"] = f.name or " · ".join(c["label"] for c in d["cups"])
        d["cup_count"] = len(d["cups"])
        out.append(d)
    return out


# ---------------------------------------------------------------------------
# reveal
# ---------------------------------------------------------------------------

def _descriptors(rows, stats, yours, who) -> list:
    lex = content.get()
    your_terms = {tag.term for tag in yours.tags} if yours else set()
    others_pct = {d["term"]: d["pct"] for d in (stats["descriptors"] if stats else [])}
    out = []
    for term in sorted(your_terms, key=lambda k: (-others_pct.get(k, 0), lex.label_of(k))):
        # "shared" names another taster's read, so it waits for the threshold too.
        shared = bool(stats) and others_pct.get(term, 0) > 0 and any(
            not same_person(t, who) and any(tag.term == term for tag in t.tags) for t in rows)
        out.append({"term": term, "label": lex.label_of(term), "family": lex.family_of(term),
                    "kind": "shared" if shared else "yours",
                    "pct": others_pct.get(term) if shared else None})
    if stats:
        out += [{**{k: d[k] for k in ("term", "label", "family", "pct")}, "kind": "others"}
                for d in stats["descriptors"] if d["term"] not in your_terms]
    return out


def _verdict(stats, yours) -> Optional[str]:
    if not (stats and yours):
        return None
    avg, spread, you = stats["avg_overall"], stats["spread"], yours.overall
    if abs(you - avg) <= max(spread, 0.5):
        return "You landed with the room."
    words = content.get().forms["basic"]["scale_words"]["overall"]
    room, you_w = words[max(0, min(4, round(avg) - 1))], words[you - 1]
    if you > avg:
        return f"You liked it more than most — {you_w} vs. the room's {room}."
    return f"You were harder on it than most — {you_w} vs. the room's {room}."


def reveal_flight(flight: TastingFlight, who: Optional[TasterIdentity]) -> dict:
    """Per cup: the coffee's consensus over every closed basic read of it, where the
    caller's read landed, and which descriptors they share with the room."""
    if flight.sheet == "advanced":
        raise TastingStateError("use_summary", "An advanced cupping has no reveal: open its summary")
    if flight.is_open:
        raise TastingStateError("flight_open", "The reveal waits until the flight is closed")
    by_coffee = _load_tastings([fc.coffee_id for fc in flight.coffees])
    mine = {t.coffee_id: t for t in flight.tastings if same_person(t, who)}
    cups = []
    for fc in flight.coffees:
        rows = by_coffee.get(fc.coffee_id, [])
        stats = consensus(rows)
        yours = mine.get(fc.coffee_id)
        cups.append({
            "coffee_id": fc.coffee_id, "position": fc.position, "blind_label": fc.blind_label,
            "name": fc.coffee.name, "roaster": fc.coffee.roaster, "n": len(rows),
            "consensus": {k: stats[k] for k in ("n", "avg_overall", "spread", "histogram")} if stats else None,
            "yours": _entry_dict(yours) if yours else None,
            "descriptors": _descriptors(rows, stats, yours, who),
            "verdict": _verdict(stats, yours),
        })
    return {"flight": flight_dict(flight, who), "cups": cups}
