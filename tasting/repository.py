"""Tasting data access, coffee half: coffees, consensus, identity.

Validates, flushes, never commits: the route commits. Bad input raises
``TastingValidationError(field, message)`` (400 ``{error, field}``).

Every query is scoped by ``group_id`` here, not in the route: the schema cannot
stop a cross-group reference, so a coffee id from another group simply is not
found (404, never 403).

Anchoring. Coffee lists and details never carry an individual read; averages
and descriptors need ``CONSENSUS_THRESHOLD`` reads. Advanced (cupping) reads
never enter basic aggregates: ``_load_tastings`` defaults to ``sheet='basic'``.

Identity is passed in as a ``TasterIdentity`` built from the request's
``Actor``; the repository never reads the session itself. Flights, tastings
and the reveal live in ``tasting/flights_repository.py``.
"""
import hashlib
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from statistics import mean, pstdev
from typing import Optional

from rapidfuzz import fuzz
from sqlalchemy.orm import selectinload

from extensions import db
from identity.access import Actor
from tasting import content
from tasting.enums import (BAR_VOTES, COFFEE_KINDS, CONSENSUS_THRESHOLD, PROCESSES,
                           ROASTS)
from tasting.errors import TastingValidationError
from tasting.models import Tasting, TastingCoffee, TastingFlight, TastingFlightCoffee
from utils import utc_now

FUZZY_CUTOFF = 75
TREND_WINDOW_DAYS = 42
NAME_MAX = 120


@dataclass(frozen=True)
class TasterIdentity:
    """Who is tasting. ``taster_key`` is the DB identity: ``user:<id>`` through
    an account, ``member:<id>`` through a shared device's pick,
    ``paper:member:<id>`` / ``paper:name:<slug>`` for a typed-in sheet. One
    person is one read per cup through every door (``same_person``)."""
    user_id: Optional[int]    # None for a paper read: the typist is not the taster
    member_id: Optional[int]
    taster_key: str
    name: str
    created_via: str          # 'account' | 'device' | 'paper'

    @staticmethod
    def key(created_via: str, user_id: Optional[int], member_id: Optional[int]) -> str:
        if created_via == "device" and member_id:
            return f"member:{member_id}"
        return f"user:{user_id}"

    @classmethod
    def from_actor(cls, actor: Actor) -> "TasterIdentity":
        """A user session is the person; a device act is the picked member
        (``actor_for_pick``). An unpicked device has no identity."""
        if actor.kind == "device" and actor.member_id is None:
            raise ValueError("a device actor must name a member before it can taste")
        via = "account" if actor.kind == "user" else "device"
        return cls(user_id=actor.user_id, member_id=actor.member_id,
                   taster_key=cls.key(via, actor.user_id, actor.member_id),
                   name=actor.display_name[:NAME_MAX], created_via=via)

    @classmethod
    def paper(cls, *, member_id: Optional[int] = None, member_name: str = "",
              guest_name: Optional[str] = None) -> "TasterIdentity":
        """Someone else's paper sheet, typed in by a manager. Exactly one of a
        member or a guest name; ``user_id`` stays None so the row never reads
        as the typist's own."""
        if (member_id is None) == (guest_name is None):
            raise ValueError("paper identity needs exactly one of member or guest_name")
        if member_id is not None:
            return cls(user_id=None, member_id=member_id, taster_key=f"paper:member:{member_id}",
                       name=member_name[:NAME_MAX], created_via="paper")
        name = guest_name.strip()
        return cls(user_id=None, member_id=None, taster_key=f"paper:name:{guest_slug(name)}",
                   name=name, created_via="paper")


def guest_slug(name: str) -> str:
    """ASCII-fold, lower-case, collapse non-alphanumerics to '-', cap at 60. A name
    with no Latin letters falls back to a hash so it still keys."""
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")[:60].strip("-")
    return slug or "g" + hashlib.sha1(name.casefold().encode()).hexdigest()[:10]


def same_person(t: Tasting, who: Optional[TasterIdentity]) -> bool:
    """An account (user:), the shared device (member:) and a typed-in sheet
    (paper:member:) are three doors for one human; the user or member id ties
    them together when it is known on both sides."""
    if who is None:
        return False
    if t.taster_key == who.taster_key:
        return True
    if who.member_id is not None and t.member_id == who.member_id:
        return True
    return who.user_id is not None and t.user_id == who.user_id


def may_see_named(flight: TastingFlight, actor: Optional[Actor]) -> bool:
    """Per-person reads go to managers (editor/admin) and the ACCOUNT-door host.
    A flight hosted from a shared device has no account host: the device door
    never counts, however the picked member is linked. Decided on
    ``actor.kind``, never on ``actor.user_id`` (a device pick carries one)."""
    if actor is None or actor.kind != "user":
        return False
    if actor.role in ("editor", "admin"):
        return True
    return flight.created_via == "account" and flight.host_user_id == actor.user_id


# ---------------------------------------------------------------------------
# validation helpers
# ---------------------------------------------------------------------------

def _str(data, field, *, required=False, max_len=255, default=""):
    value = data.get(field, None)
    if value is None:
        if required:
            raise TastingValidationError(field, f"{field} is required")
        return default
    if not isinstance(value, str):
        raise TastingValidationError(field, f"{field} must be a string")
    value = value.strip()
    if required and not value:
        raise TastingValidationError(field, f"{field} is required")
    if len(value) > max_len:
        raise TastingValidationError(field, f"{field} is too long (max {max_len})")
    return value


def _enum(data, field, allowed, *, required=False):
    value = data.get(field, None)
    if value is None or value == "":
        if required:
            raise TastingValidationError(field, f"{field} is required")
        return None
    if value not in allowed:
        raise TastingValidationError(field, f"{field} must be one of {list(allowed)}")
    return value


# ---------------------------------------------------------------------------
# coffees
# ---------------------------------------------------------------------------

def get_coffee(group_id: int, coffee_id: int) -> Optional[TastingCoffee]:
    """The coffee, or None when it does not exist in this group."""
    return db.session.execute(
        db.select(TastingCoffee).where(TastingCoffee.id == coffee_id,
                                       TastingCoffee.group_id == group_id)
    ).scalar_one_or_none()


def create_coffee(group_id: int, data: dict, created_by: Optional[int] = None) -> TastingCoffee:
    coffee = TastingCoffee(
        group_id=group_id,
        name=_str(data, "name", required=True),
        roaster=_str(data, "roaster"),
        kind=_enum(data, "kind", COFFEE_KINDS, required=True),
        created_by=created_by,
    )
    _apply_details(coffee, data)
    db.session.add(coffee)
    db.session.flush()
    return coffee


# The optional free-text coffee fields and their limits; the CSV import shares them.
COFFEE_TEXT_LIMITS = (("origin", 120), ("region", 255), ("variety", 255),
                      ("altitude", 60), ("lot_code", 120))


def _apply_details(coffee: TastingCoffee, data: dict) -> None:
    for field, max_len in COFFEE_TEXT_LIMITS:
        if field in data:
            setattr(coffee, field, _str(data, field, max_len=max_len) or None)
    if "process" in data:
        coffee.process = _enum(data, "process", PROCESSES)
    if "roast_level" in data:
        coffee.roast_level = _enum(data, "roast_level", ROASTS)
    if "notes" in data:
        coffee.notes = _str(data, "notes", max_len=4000)


def update_coffee(coffee: TastingCoffee, data: dict) -> TastingCoffee:
    if "name" in data:
        coffee.name = _str(data, "name", required=True)
    if "roaster" in data:
        coffee.roaster = _str(data, "roaster")
    if "kind" in data:
        coffee.kind = _enum(data, "kind", COFFEE_KINDS, required=True)
    _apply_details(coffee, data)
    db.session.flush()
    return coffee


def set_archived(coffee: TastingCoffee, archived: bool) -> TastingCoffee:
    coffee.archived_at = utc_now() if archived else None
    db.session.flush()
    return coffee


def list_roasters(group_id: int) -> list:
    rows = db.session.execute(
        db.select(TastingCoffee.roaster)
        .where(TastingCoffee.group_id == group_id, TastingCoffee.roaster != "",
               TastingCoffee.archived_at.is_(None))
        .distinct().order_by(TastingCoffee.roaster)).all()
    return [r[0] for r in rows]


def _match_score(query_l: str, coffee: TastingCoffee) -> float:
    """Substring / first-word hits beat fuzzy similarity: the nudge fires while
    someone is still TYPING ("guji shak"), which whole-string ratios score low."""
    name_l = coffee.name.lower()
    if query_l in name_l:
        return 95.0
    first = name_l.split(" ")[0]
    if len(first) >= 3 and first in query_l:
        return 85.0
    full = f"{coffee.name} {coffee.roaster}".strip().lower()
    return max(fuzz.partial_ratio(query_l, name_l), fuzz.WRatio(query_l, full))


def match_coffee(group_id: int, query: str) -> Optional[dict]:
    """Best match over the group's active coffees for the "Did you mean ...?"
    nudge, or None. Needs 3+ characters; a hit below FUZZY_CUTOFF is no hit."""
    q = (query or "").strip().lower()
    if len(q) < 3:
        return None
    coffees = db.session.execute(
        db.select(TastingCoffee).where(TastingCoffee.group_id == group_id,
                                       TastingCoffee.archived_at.is_(None))).scalars().all()
    scored = [(c, _match_score(q, c)) for c in coffees]
    scored = [(c, sc) for c, sc in scored if sc >= FUZZY_CUTOFF]
    if not scored:
        return None
    coffee, score = max(scored, key=lambda cs: (cs[1], -cs[0].id))
    return {**coffee.to_dict(), "score": round(score), "n": _tasting_count(coffee.id)}


def _tasting_count(coffee_id: int) -> int:
    return db.session.scalar(
        db.select(db.func.count()).select_from(Tasting)
        .where(Tasting.coffee_id == coffee_id, Tasting.sheet == "basic"))


def _load_tastings(coffee_ids, *, sheet: Optional[str] = "basic") -> dict:
    """coffee_id -> [Tasting] with tags loaded, one query. Defaults to basic reads:
    advanced reads have no Overall and must never reach a basic aggregate, flavor
    term or the consensus threshold. ``sheet=None`` loads both."""
    if not coffee_ids:
        return {}
    q = (db.select(Tasting).options(selectinload(Tasting.tags), selectinload(Tasting.defects))
         .where(Tasting.coffee_id.in_(list(coffee_ids))))
    if sheet is not None:
        q = q.where(Tasting.sheet == sheet)
    by_coffee = defaultdict(list)
    for t in db.session.execute(q).scalars().all():
        by_coffee[t.coffee_id].append(t)
    return by_coffee


def list_coffees(group_id: int, *, include_archived: bool = False,
                 who: Optional[TasterIdentity] = None) -> list:
    """Coffee rows for the picker and the Coffees tab. Carries counts and, above
    the consensus threshold, average / spread / top-3 descriptors, never an
    individual read. ``who`` marks rows that person has tasted, through any door."""
    q = db.select(TastingCoffee).where(TastingCoffee.group_id == group_id)
    if not include_archived:
        q = q.where(TastingCoffee.archived_at.is_(None))
    coffees = db.session.execute(q.order_by(TastingCoffee.name, TastingCoffee.id)).scalars().all()
    # Activity (n, mine, last) counts every sheet; aggregates stay basic-only so a
    # cupping read never reaches an Overall average or the consensus threshold.
    by_coffee = _load_tastings([c.id for c in coffees], sheet=None)
    cupping = _cupping_lines([c.id for c in coffees])
    out = []
    for c in coffees:
        rows = by_coffee.get(c.id, [])
        d = c.to_dict()
        d["n"] = len(rows)
        d["basic_n"] = sum(1 for t in rows if t.sheet == "basic")
        d["cupping"] = cupping.get(c.id)
        d["tasted_by_me"] = who is not None and any(same_person(t, who) for t in rows)
        last = max((t.created_at for t in rows), default=None)
        d["last_tasted_at"] = last.isoformat() if last else None
        stats = consensus([t for t in rows if t.sheet == "basic"])
        d["avg_overall"] = stats["avg_overall"] if stats else None
        d["spread"] = stats["spread"] if stats else None
        d["top_terms"] = stats["descriptors"][:3] if stats else []
        out.append(d)
    return out


# ---------------------------------------------------------------------------
# consensus
# ---------------------------------------------------------------------------

def round1(x, nd=1):
    return round(float(x), nd)


def descriptor_agreement(rows) -> list:
    """Terms ranked by the share of tastings carrying them (direct tags only).
    Ties break on how many marked it strong."""
    n = len(rows)
    if n == 0:
        return []
    lex = content.get()
    count, strong = defaultdict(int), defaultdict(int)
    for t in rows:
        for tag in t.tags:
            count[tag.term] += 1
            if tag.strength == 3:
                strong[tag.term] += 1
    ranked = sorted(count, key=lambda k: (-count[k], -strong[k], lex.tier_of(k) * -1, lex.label_of(k)))
    return [{
        "term": k, "label": lex.label_of(k), "family": lex.family_of(k), "tier": lex.tier_of(k),
        "count": count[k], "pct": round(100.0 * count[k] / n),
    } for k in ranked]


def describe(terms_strong, terms_mild) -> str:
    """'Mostly S, with a hint of M.' / 'Mostly S.' / 'Notes of M.'"""
    def lst(a):
        return a[0] if len(a) == 1 else ", ".join(a[:-1]) + " and " + a[-1]
    if not terms_strong and not terms_mild:
        return ""
    if terms_strong and terms_mild:
        return f"Mostly {lst(terms_strong)}, with a hint of {lst(terms_mild)}."
    if terms_strong:
        return f"Mostly {lst(terms_strong)}."
    return f"Notes of {lst(terms_mild)}."


def _trend(rows, now=None) -> Optional[str]:
    now = now or utc_now()
    cut1 = now - timedelta(days=TREND_WINDOW_DAYS)
    cut2 = cut1 - timedelta(days=TREND_WINDOW_DAYS)
    recent = [t.overall for t in rows if t.created_at and t.created_at >= cut1]
    prior = [t.overall for t in rows if t.created_at and cut2 <= t.created_at < cut1]
    if len(recent) < CONSENSUS_THRESHOLD or len(prior) < CONSENSUS_THRESHOLD:
        return None
    diff = mean(recent) - mean(prior)
    if diff >= 0.3:
        return "trending up"
    if diff <= -0.3:
        return "trending down"
    return "steady over 6 weeks"


def consensus(rows, *, now=None) -> Optional[dict]:
    """Roll-up for one coffee's basic tastings, or None under the threshold."""
    n = len(rows)
    if n < CONSENSUS_THRESHOLD:
        return None
    lex = content.get()
    overalls = [t.overall for t in rows]
    hist = [sum(1 for o in overalls if o == k) for k in (1, 2, 3, 4, 5)]
    profile = {}
    for attr in lex.attributes[:-1]:
        vals = [getattr(t, attr) for t in rows if getattr(t, attr) is not None]
        if len(vals) >= CONSENSUS_THRESHOLD:
            m = mean(vals)
            profile[attr] = {"mean": round1(m), "low": min(vals), "high": max(vals),
                             "n": len(vals), "word": lex.scale_word(attr, m)}
        else:
            profile[attr] = None
    descriptors = descriptor_agreement(rows)
    lead = [d["label"] for d in descriptors if d["pct"] >= 50]
    rest = [d["label"] for d in descriptors if 25 <= d["pct"] < 50]
    return {
        "n": n,
        "avg_overall": round1(mean(overalls)),
        "spread": round1(pstdev(overalls)),
        "histogram": hist,
        "profile": profile,
        "descriptors": descriptors,
        "sentence": describe(lead, rest),
        "trend": _trend(rows, now=now),
    }


def closed_flight_clause():
    """A cupping counts only once closed: ``is_open`` false, or past ``closes_at``
    and not yet lazily expired. An open cupping's reads would anchor the live table."""
    return db.or_(TastingFlight.is_open.is_(False), TastingFlight.closes_at <= utc_now())


def _cupping_lines(coffee_ids) -> dict:
    """coffee_id -> {n, avg_total, votes} for coffees with at least the consensus
    threshold of scored reads from closed cuppings; others are absent. One query."""
    if not coffee_ids:
        return {}
    rows = db.session.execute(
        db.select(Tasting).join(TastingFlight, Tasting.flight_id == TastingFlight.id)
        .where(Tasting.coffee_id.in_(list(coffee_ids)), Tasting.sheet == "advanced",
               closed_flight_clause())).scalars().all()
    scored = defaultdict(list)
    for t in rows:
        total = t.adv_total()
        if total is not None:
            scored[t.coffee_id].append((t, total))
    out = {}
    for cid, reads in scored.items():
        if len(reads) < CONSENSUS_THRESHOLD:
            continue
        votes = {v: 0 for v in BAR_VOTES}
        for t, _ in reads:
            if t.bar_vote in votes:
                votes[t.bar_vote] += 1
        out[cid] = {"n": len(reads), "avg_total": round1(mean(total for _, total in reads)),
                    "votes": votes}
    return out


def _entry_dict(t: Tasting) -> dict:
    lex = content.get()
    strong = [lex.label_of(tag.term) for tag in t.tags if tag.strength == 3]
    mild = [lex.label_of(tag.term) for tag in t.tags if tag.strength == 2]
    return {**t.vals(), "note": t.note, "tags": {tag.term: tag.strength for tag in t.tags},
            "defects": [d.term for d in t.defects], "sentence": describe(strong, mild)}


def coffee_detail(coffee: TastingCoffee, who: Optional[TasterIdentity] = None) -> dict:
    """The coffee page. ``yours`` is the caller's own newest basic read of this
    coffee, shown regardless of the threshold: one's own read anchors nobody."""
    rows = sorted(_load_tastings([coffee.id]).get(coffee.id, []),
                  key=lambda t: (t.created_at or datetime.min, t.id), reverse=True)
    d = coffee.to_dict()
    d["n"] = len(rows)
    d["consensus"] = consensus(rows)
    d["cupping"] = _cupping_lines([coffee.id]).get(coffee.id)
    mine = [t for t in rows if same_person(t, who)]
    d["yours"] = None if not mine else {
        **_entry_dict(mine[0]), "reads": len(mine), "flight_id": mine[0].flight_id,
        "created_at": mine[0].created_at.isoformat() if mine[0].created_at else None,
    }
    return d


def blind_label(i: int) -> str:
    return chr(ord("A") + i) if i < 26 else f"Cup {i + 1}"


def blind_cup_label(fc: TastingFlightCoffee) -> str:
    return f"Cup {fc.blind_label or blind_label(fc.position - 1)}"
