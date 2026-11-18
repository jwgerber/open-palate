"""A coffee's sessions: one entry per closed flight that held it, newest first.

Pure data layer for `GET /api/tasting/coffees/<id>/sessions`. Stars (basic) and
advanced points never share an average, a lean or a rank: every number here is
computed per session, and a session is on exactly one sheet.

Imports from `tasting.repository`; nothing imports this module but
`tasting/routes.py`. Days are bucketed in the group's time zone, passed as `tz`.
"""
from collections import Counter, defaultdict
from statistics import mean
from typing import Callable, Optional

from extensions import db
from tasting import content
from tasting.enums import ADV_CATEGORIES, BAR_VOTES, CONSENSUS_THRESHOLD
from tasting.models import Tasting, TastingFlight, TastingFlightCoffee
from tasting.repository import (
    TasterIdentity, blind_cup_label, closed_flight_clause, round1, same_person,
)
from utils import to_group_local

SESSIONS_PAGE = 10
BASIC_CATS = ("acidity", "sweetness", "body", "balance", "overall")


def session_date(flight, tz: str) -> str:
    """The sitting's group-local ISO date (``opened_at`` is naive UTC)."""
    return to_group_local(flight.opened_at, tz).date().isoformat()


def _category_diffs(mine, others: list) -> dict:
    """Your score minus the mean of the others', per category that both have."""
    mine_scores = mine.adv_scores()
    other_scores = [r.adv_scores() for r in others]
    out = {}
    for cat in ADV_CATEGORIES:
        theirs = [s[cat] for s in other_scores if s[cat] is not None]
        if mine_scores[cat] is not None and theirs:
            out[cat] = mine_scores[cat] - mean(theirs)
    return out


def _scores(t: Tasting, sheet: str) -> dict:
    if sheet == "advanced":
        return t.adv_scores()
    vals = t.vals()
    return {cat: vals[cat] for cat in BASIC_CATS}


def _score_keys(sheet: str) -> tuple:
    return ADV_CATEGORIES + ("total",) if sheet == "advanced" else BASIC_CATS


def _score_table(t: Tasting, sheet: str) -> dict:
    """Every number a read contributes to the room, keyed like `others_avg`."""
    table = _scores(t, sheet)
    if sheet == "advanced":
        table["total"] = t.adv_total()
    return table


def _read_dict(t: Tasting, sheet: str) -> dict:
    adv = sheet == "advanced"
    return {
        "scores": _scores(t, sheet),
        "total": t.adv_total() if adv else None,
        "overall": None if adv else t.overall,
        "vote": t.bar_vote if adv else None,
        "terms": [content.get().label_of(tag.term) for tag in t.tags],
        "defects": [d.term for d in t.defects],
        "note": t.note,
    }


def _headline(t: Tasting, sheet: str) -> Optional[float]:
    """The one number a cup is ranked by: advanced total, or the basic Overall."""
    v = t.adv_total() if sheet == "advanced" else t.overall
    return None if v is None else float(v)


def _ranks(sheet: str, reads_by_coffee: dict) -> dict:
    """coffee_id -> (rank | None, vs_flight | None) for one flight. Only cups with
    CONSENSUS_THRESHOLD or more reads are rankable, and a rank needs two of them."""
    means = {}
    for coffee_id, reads in reads_by_coffee.items():
        vals = [v for v in (_headline(t, sheet) for t in reads) if v is not None]
        if len(reads) >= CONSENSUS_THRESHOLD and vals:
            means[coffee_id] = round(mean(vals), 2)
    if len(means) < 2:
        return {}
    flight_mean = mean(means.values())
    return {
        cid: ({"place": 1 + sum(1 for m in means.values() if m > own), "of": len(means)},
              round1(own - flight_mean))
        for cid, own in means.items()
    }


def _room(reads: list, yours: Optional[Tasting], sheet: str) -> dict:
    keys = _score_keys(sheet)
    tables = [_score_table(t, sheet) for t in reads]
    others = [tab for t, tab in zip(reads, tables) if t is not yours]
    others_avg, ranges = {}, {}
    for key in keys:
        theirs = [tab[key] for tab in others if tab[key] is not None]
        everyone = [tab[key] for tab in tables if tab[key] is not None]
        others_avg[key] = round1(mean(theirs)) if theirs else None
        if everyone:
            ranges[key] = [float(min(everyone)), float(max(everyone))]
    votes = None
    if sheet == "advanced":
        counts = Counter(t.bar_vote for t in reads)
        votes = {v: counts[v] for v in BAR_VOTES}
    terms = Counter(tag.term for t in reads for tag in t.tags)
    defects = Counter(d.term for t in reads for d in t.defects)
    return {
        "n_others": len(others),
        "others_avg": others_avg,
        "range": ranges,
        "votes": votes,
        "terms": [{"term": term, "label": content.get().label_of(term), "count": n}
                  for term, n in sorted(terms.items(), key=lambda kv: (-kv[1], content.get().label_of(kv[0])))],
        "defects": [{"term": term, "count": n}
                    for term, n in sorted(defects.items(), key=lambda kv: (-kv[1], kv[0]))],
    }


def _named_reads(reads: list, who: Optional[TasterIdentity], sheet: str) -> list:
    rows = [{**_read_dict(t, sheet), "taster_name": t.taster_name, "taster_key": t.taster_key,
             "is_you": same_person(t, who)} for t in reads]
    return sorted(rows, key=lambda r: (not r["is_you"], r["taster_name"].casefold(), r["taster_key"]))


def _session(flight, reads: list, fc, flight_cups: int, rank, who, can_name, tz: str) -> dict:
    sheet = flight.sheet
    yours = next((t for t in reads if same_person(t, who)), None)
    rankable = len(reads) >= CONSENSUS_THRESHOLD
    place, vs_flight = rank if rank else (None, None)
    return {
        "flight_id": flight.id, "date": session_date(flight, tz),
        "name": flight.name, "prep": flight.prep, "sheet": sheet,
        "shared": bool(flight.is_shared),
        "cup_label": blind_cup_label(fc) if flight.is_blind else None,
        "n": len(reads), "flight_cups": flight_cups,
        "rank": place, "vs_flight": vs_flight,
        "yours": _read_dict(yours, sheet) if yours else None,
        "room": _room(reads, yours, sheet) if rankable else None,
        # A solo flight skips the 3-read floor: names are what let an editor delete
        # someone else's read. room/rank/vs_flight keep the floor.
        "reads": (_named_reads(reads, who, sheet)
                  if (rankable or not flight.is_shared) and can_name(flight) else None),
    }


def coffee_sessions(coffee, who: Optional[TasterIdentity], *, tz: str,
                    can_name: Callable[[TastingFlight], bool],
                    include_all_solo: bool = False,
                    before: Optional[int] = None,
                    sheet: Optional[str] = None) -> dict:
    """One page of this coffee's closed sessions, flight id descending.

    A session is listed when the caller has a read in it, the flight is shared, or
    `include_all_solo`. Round numbers (`room`, `reads`, `rank`) need 3 reads of this
    coffee; `reads` also needs `can_name(flight)`. An unshared (solo) session skips
    the floor for `reads` when names are allowed, so editors can see and delete another
    person's solo read; `room is None` is still the withheld signal. Query count is flat
    in page size.
    """
    rows = (Tasting.query
            .join(TastingFlight, Tasting.flight_id == TastingFlight.id)
            .filter(Tasting.coffee_id == coffee.id, TastingFlight.group_id == coffee.group_id,
                    closed_flight_clause())
            .options(db.joinedload(Tasting.flight), db.selectinload(Tasting.tags),
                     db.selectinload(Tasting.defects))
            .all())
    by_flight = defaultdict(list)
    for t in rows:
        by_flight[t.flight_id].append(t)

    def listed(reads: list) -> bool:
        flight = reads[0].flight
        if sheet and flight.sheet != sheet:
            return False
        if flight.is_shared or any(same_person(t, who) for t in reads):
            return True
        # Another person's solo session: only where the caller may also name its readers
        # (store access), else it would list as a blank, undeletable row.
        return include_all_solo and can_name(flight)

    ids = sorted((fid for fid, reads in by_flight.items() if listed(reads)), reverse=True)
    if before is not None:
        ids = [fid for fid in ids if fid < before]
    page, more = ids[:SESSIONS_PAGE], len(ids) > SESSIONS_PAGE
    if not page:
        return {"sessions": [], "next_before": None}

    cups = defaultdict(dict)
    for fc in TastingFlightCoffee.query.filter(TastingFlightCoffee.flight_id.in_(page)).all():
        cups[fc.flight_id][fc.coffee_id] = fc
    room_reads = defaultdict(lambda: defaultdict(list))
    for t in Tasting.query.filter(Tasting.flight_id.in_(page)).all():
        room_reads[t.flight_id][t.coffee_id].append(t)

    sessions = []
    for fid in page:
        reads = by_flight[fid]
        flight = reads[0].flight
        ranks = _ranks(flight.sheet, room_reads[fid])
        sessions.append(_session(flight, reads, cups[fid][coffee.id], len(cups[fid]),
                                 ranks.get(coffee.id), who, can_name, tz))
    return {"sessions": sessions, "next_before": page[-1] if more else None}


def your_lean(coffee, who: TasterIdentity) -> dict:
    """How the caller scores this coffee against everyone else, per sheet.

    Each side averages, over closed sessions where the caller has a read and the
    session holds CONSENSUS_THRESHOLD or more reads of this coffee, the caller's
    number minus the mean of the others'. advanced points and stars stay on their own
    sides. `top` is the two advanced categories with the largest absolute lean (sheet
    order breaks ties).
    """
    rows = (Tasting.query
            .join(TastingFlight, Tasting.flight_id == TastingFlight.id)
            .filter(Tasting.coffee_id == coffee.id, TastingFlight.group_id == coffee.group_id,
                    closed_flight_clause())
            .options(db.joinedload(Tasting.flight))
            .all())
    by_flight = defaultdict(list)
    for t in rows:
        by_flight[t.flight_id].append(t)

    adv_totals, adv_cats, basic = [], defaultdict(list), []
    for reads in by_flight.values():
        mine = next((t for t in reads if same_person(t, who)), None)
        if mine is None or len(reads) < CONSENSUS_THRESHOLD:
            continue
        others = [t for t in reads if not same_person(t, who)]
        if reads[0].flight.sheet == "advanced":
            theirs = [t.adv_total() for t in others if t.adv_total() is not None]
            if mine.adv_total() is not None and theirs:
                adv_totals.append(mine.adv_total() - mean(theirs))
            for cat, diff in _category_diffs(mine, others).items():
                adv_cats[cat].append(diff)
        else:
            theirs = [t.overall for t in others if t.overall is not None]
            if mine.overall is not None and theirs:
                basic.append(mine.overall - mean(theirs))

    adv = None
    if adv_totals:
        leans = {cat: round1(mean(adv_cats[cat])) for cat in ADV_CATEGORIES if adv_cats[cat]}
        ranked = sorted(leans, key=lambda cat: -abs(leans[cat]))  # stable: sheet order on ties
        adv = {"total": round1(mean(adv_totals)),
              "top": [{"category": cat, "diff": leans[cat]} for cat in ranked[:2]]}
    return {"advanced": adv, "basic": {"overall": round1(mean(basic))} if basic else None}
