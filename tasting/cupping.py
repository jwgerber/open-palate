"""Advanced cupping: the flight-scoped summary, its CSV, and the palate's cupping block.

One cupping's table only, built from ``flight.tastings``, never ``consensus()``
(which spans every read of a coffee). Named parts (per-person reads, who flagged
D/Q) are included only when the caller passes ``named=True``; otherwise they are
omitted here, not hidden later.

Imports from the repositories; nothing there imports this module.
"""
import csv
import io
from collections import Counter
from statistics import mean
from typing import Optional

from sqlalchemy.orm import joinedload

from extensions import db
from tasting import content
from tasting.coffee_sessions import _category_diffs, session_date
from tasting.enums import ADV_CATEGORIES, BAR_VOTES, CONSENSUS_THRESHOLD
from tasting.flights_repository import flight_dict
from tasting.models import Tasting, TastingFlight, TastingFlightCoffee
from tasting.palate import mine_clause
from tasting.repository import TasterIdentity, closed_flight_clause, same_person
from utils import csv_safe

TOP_TERMS = 5
CALIBRATION_MIN_OTHERS = 3


def _read_dict(t) -> dict:
    lex = content.get()
    return {
        "taster_name": t.taster_name, "taster_key": t.taster_key, "created_via": t.created_via,
        "total": t.adv_total(), "scores": t.adv_scores(), "bar_vote": t.bar_vote,
        "terms": [lex.label_of(tag.term) for tag in t.tags],
        "defects": [d.term for d in t.defects], "note": t.note,
    }


def adv_reads_by_coffee(flight) -> dict:
    """coffee_id -> that coffee's advanced reads, for every coffee in the flight."""
    return {fc.coffee_id: [t for t in flight.tastings if t.coffee_id == fc.coffee_id and t.sheet == "advanced"]
            for fc in flight.coffees}


def _category_stats(reads: list) -> dict:
    out = {}
    all_scores = [r.adv_scores() for r in reads]
    for cat in ADV_CATEGORIES:
        vals = [s[cat] for s in all_scores if s[cat] is not None]
        out[cat] = {"avg": round(mean(vals), 2), "min": min(vals), "max": max(vals)} if vals else None
    return out


def _top_terms(reads: list) -> list:
    lex = content.get()
    counts = Counter(tag.term for t in reads for tag in t.tags)
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], lex.label_of(kv[0])))[:TOP_TERMS]
    return [{"term": k, "label": lex.label_of(k), "pct": round(100 * n / len(reads))} for k, n in ranked]


def _dq(reads: list, *, named: bool) -> list:
    """Named: one entry per (read, category). Unnamed: distinct categories in sheet
    order with a count; per-read entries would line up with the roster order."""
    if named:
        return [{"category": cat, "by": r.taster_name} for r in reads for cat in r.adv_dq_categories()]
    counts = Counter(cat for r in reads for cat in r.adv_dq_categories())
    return [{"category": cat, "by": None, "count": counts[cat]} for cat in ADV_CATEGORIES if counts[cat]]


def _coffee_summary(fc, reads: list, *, named: bool) -> dict:
    static = {"coffee_id": fc.coffee_id, "position": fc.position, "blind_label": fc.blind_label,
              "name": fc.coffee.name, "roaster": fc.coffee.roaster, "n": len(reads)}
    # Below the threshold an unnamed viewer could subtract their own read from the
    # aggregates and recover another taster's read, so withhold them.
    if not named and len(reads) < CONSENSUS_THRESHOLD:
        return {**static, "avg_total": None, "categories": {cat: None for cat in ADV_CATEGORIES},
                "votes": None, "yes_share": None, "top_terms": [], "defects": {}, "dq": [], "reads": None}
    totals = [t for t in (r.adv_total() for r in reads) if t is not None]
    votes = Counter(r.bar_vote for r in reads)
    voted = sum(votes[v] for v in BAR_VOTES)
    return {
        **static,
        "avg_total": round(mean(totals), 2) if totals else None,
        "categories": _category_stats(reads),
        "votes": {v: votes[v] for v in BAR_VOTES},
        "yes_share": round(votes["yes"] / voted, 2) if voted else None,
        "top_terms": _top_terms(reads),
        "defects": dict(Counter(d.term for r in reads for d in r.defects)),
        "dq": _dq(reads, named=named),
        "reads": [_read_dict(r) for r in reads] if named else None,
    }


def _calibration(by_coffee: dict, who: Optional[TasterIdentity]) -> Optional[dict]:
    """The caller's score minus the mean of everyone else's, per category, averaged
    over the coffees with at least CALIBRATION_MIN_OTHERS other reads."""
    if who is None:
        return None
    diffs = {cat: [] for cat in ADV_CATEGORIES}
    qualifying = 0
    for reads in by_coffee.values():
        mine = next((r for r in reads if same_person(r, who)), None)
        others = [r for r in reads if not same_person(r, who)]
        if mine is None or len(others) < CALIBRATION_MIN_OTHERS:
            continue
        qualifying += 1
        for cat, diff in _category_diffs(mine, others).items():
            diffs[cat].append(diff)
    if not qualifying:
        return None
    return {cat: round(mean(v), 1) for cat, v in diffs.items() if v}


def build_summary(flight, who: Optional[TasterIdentity], *, named: bool) -> dict:
    by_coffee = adv_reads_by_coffee(flight)
    coffees = [_coffee_summary(fc, by_coffee[fc.coffee_id], named=named) for fc in flight.coffees]
    coffees.sort(key=lambda c: (c["n"] == 0 or c["avg_total"] is None, -(c["avg_total"] or 0), c["position"]))
    yours = {cid: _read_dict(r) for cid, reads in by_coffee.items() for r in reads if same_person(r, who)}
    return {"flight": flight_dict(flight, who), "coffees": coffees, "yours": yours,
            "calibration": _calibration(by_coffee, who), "named": named}


# ---------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------

CSV_HEADER = ["flight_name", "flight_date", "coffee", "roaster", "origin", "process",
              "blind_label", "taster", "source", *ADV_CATEGORIES, "total", "dq", "dq_categories",
              "bar_vote", "flavor_terms", "defects", "note"]
_CSV_SOURCE = {"account": "live", "device": "device", "paper": "paper"}


def _score(v) -> str:
    return "" if v is None else f"{v:.1f}"


def build_csv(flight, *, tz: str) -> str:
    """One row per advanced read, by coffee position then taster name. Text cells
    are formula-guarded; score cells stay numeric."""
    lex = content.get()
    out = io.StringIO()
    w = csv.writer(out, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    w.writerow(CSV_HEADER)
    date = session_date(flight, tz)
    by_coffee = adv_reads_by_coffee(flight)
    for fc in flight.coffees:
        c = fc.coffee
        for t in sorted(by_coffee[fc.coffee_id], key=lambda t: t.taster_name):
            scores, dq = t.adv_scores(), t.adv_dq_categories()
            w.writerow([
                *(csv_safe(x) for x in (flight.name, date, c.name, c.roaster, c.origin, c.process,
                                        fc.blind_label, t.taster_name)),
                _CSV_SOURCE.get(t.created_via, t.created_via),
                *(_score(scores[cat]) for cat in ADV_CATEGORIES),
                _score(t.adv_total()), "yes" if dq else "no", "; ".join(dq), t.bar_vote or "",
                csv_safe("; ".join(lex.label_of(tag.term) for tag in t.tags)),
                csv_safe("; ".join(d.term for d in t.defects)),
                csv_safe(t.note),
            ])
    return out.getvalue()


# ---------------------------------------------------------------------------
# the palate's cupping block
# ---------------------------------------------------------------------------

def _mine(who: TasterIdentity, member_ids):
    """Your reads: your key, your account, or any of your member rows, so a paper
    sheet typed in for you and your device reads count as yours."""
    return db.or_(Tasting.taster_key == who.taster_key, mine_clause(who.user_id, member_ids))


def _is_mine(t: Tasting, who: TasterIdentity, member_ids) -> bool:
    return (t.taster_key == who.taster_key or (who.user_id is not None and t.user_id == who.user_id)
            or (t.member_id is not None and t.member_id in member_ids))


def cupping_palate(who: TasterIdentity, member_ids, *, tz: str) -> dict:
    """Your closed advanced reads, and how they sit against the room. Stars and
    totals are never combined; no other taster is named; a room number needs
    CALIBRATION_MIN_OTHERS other reads on that cup."""
    member_ids = set(member_ids)
    base = db.select(Tasting).where(Tasting.sheet == "advanced", _mine(who, member_ids))
    closed = base.join(TastingFlight, Tasting.flight_id == TastingFlight.id).where(closed_flight_clause())
    count = db.select(db.func.count()).select_from
    open_reads = db.session.scalar(count(base.subquery())) - db.session.scalar(count(closed.subquery()))
    mine = [t for t in db.session.execute(
        closed.options(joinedload(Tasting.flight), joinedload(Tasting.coffee))).scalars()
            if t.adv_total() is not None]
    flight_ids = {t.flight_id for t in mine}
    room, position = {}, {}
    if flight_ids:
        position = {(fc.flight_id, fc.coffee_id): fc.position for fc in db.session.execute(
            db.select(TastingFlightCoffee).where(TastingFlightCoffee.flight_id.in_(flight_ids))).scalars()}
        for r in db.session.execute(db.select(Tasting).where(
                Tasting.sheet == "advanced", Tasting.flight_id.in_(flight_ids))).scalars():
            if r.adv_total() is not None:
                room.setdefault((r.flight_id, r.coffee_id), []).append(r)

    cups, diffs_by_coffee = [], {}
    yes_others = voted_others = 0
    votes = Counter(t.bar_vote for t in mine)
    order = sorted(mine, key=lambda t: (-t.flight.opened_at.timestamp(), -t.flight_id,
                                        position.get((t.flight_id, t.coffee_id), 0), t.coffee_id))
    for t in order:
        others = [r for r in room.get((t.flight_id, t.coffee_id), []) if not _is_mine(r, who, member_ids)]
        qualifies = len(others) >= CALIBRATION_MIN_OTHERS
        if qualifies:
            diffs_by_coffee.setdefault(t.coffee_id, []).append(_category_diffs(t, others))
            other_votes = Counter(r.bar_vote for r in others)
            yes_others += other_votes["yes"]
            voted_others += sum(other_votes[v] for v in BAR_VOTES)
        cups.append({
            "coffee_id": t.coffee_id, "name": t.coffee.name, "roaster": t.coffee.roaster,
            "flight_id": t.flight_id, "date": session_date(t.flight, tz), "total": t.adv_total(),
            "room_total": round(mean(r.adv_total() for r in others), 1) if qualifies else None,
        })

    lean_by_cat = {}
    for coffee_diffs in diffs_by_coffee.values():
        for cat in ADV_CATEGORIES:
            vals = [d[cat] for d in coffee_diffs if cat in d]
            if vals:   # mean within a coffee first: a coffee cupped twice counts once
                lean_by_cat.setdefault(cat, []).append(mean(vals))
    lean_raw = {cat: mean(lean_by_cat[cat]) for cat in ADV_CATEGORIES if cat in lean_by_cat}
    return {
        "reads": len(mine), "coffees": len({t.coffee_id for t in mine}), "open_reads": open_reads,
        "lean": {cat: round(v, 1) for cat, v in lean_raw.items()},
        "lean_mean": round(mean(lean_raw.values()), 1) if lean_raw else None,
        "lean_coffees": len(diffs_by_coffee),
        "votes": {v: votes[v] for v in BAR_VOTES},
        "room_yes_share": round(yes_others / voted_others, 2) if voted_others else None,
        "cups": cups,
    }
