"""My palate, basic half: personal calibration over a person's basic reads.

A person's reads are every basic read whose ``user_id`` is theirs OR whose
``member_id`` is one of their member rows, so a roster member's earlier device
reads join their palate once an account is linked. Paper reads are advanced
only and never reach this half. The cupping half is ``tasting.cupping.cupping_palate``.

Closed flights only, for the person's own reads as well as everyone else's: a
read in an open blind flight listed here under its coffee's name would tell the
taster which cup was which before the reveal.
"""
from collections import defaultdict
from datetime import datetime
from statistics import mean
from typing import Optional

from sqlalchemy.orm import selectinload

from extensions import db
from tasting import content
from tasting.enums import CONSENSUS_THRESHOLD
from tasting.models import Tasting, TastingFlight
from tasting.repository import closed_flight_clause, round1
from utils import to_group_local, utc_now

MIN_OTHER_PEOPLE = 2   # the group's average shows only from this many other people


def mine_clause(user_id: Optional[int], member_ids):
    """A person's reads: their account, or any of their member rows (never NULL = NULL)."""
    clauses = []
    if user_id is not None:
        clauses.append(Tasting.user_id == user_id)
    if member_ids:
        clauses.append(Tasting.member_id.in_(list(member_ids)))
    return db.or_(*clauses) if clauses else db.false()


def _person_key(t: Tasting) -> str:
    """One other person, however many doors they used."""
    if t.user_id is not None:
        return f"u{t.user_id}"
    if t.member_id is not None:
        return f"m{t.member_id}"
    return t.taster_key


def _last_months(local_now, count: int) -> list:
    """['2026-04', ..., '2026-09']: the ``count`` months ending with local_now's, oldest first."""
    out, y, m = [], local_now.year, local_now.month
    for _ in range(count):
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return list(reversed(out))


def _closed_basic():
    return (db.select(Tasting).join(TastingFlight, Tasting.flight_id == TastingFlight.id)
            .where(Tasting.sheet == "basic", closed_flight_clause()))


def palate(user_id: Optional[int], member_ids, *, tz: str, now=None) -> dict:
    """Bias, gap series and coffees tasted for one person (``self`` level)."""
    now = now or utc_now()
    clause = mine_clause(user_id, member_ids)
    mine = db.session.execute(
        _closed_basic().options(selectinload(Tasting.tags), selectinload(Tasting.coffee))
        .where(clause).order_by(Tasting.created_at)).scalars().all()
    months = _last_months(to_group_local(now, tz), 6)
    if not mine:
        return {"tastings": 0, "coffees": 0, "terms_used": 0, "specific_terms": 0,
                "bias": None, "bias_coffees": 0, "coffees_tasted": [],
                "gap_series": [{"month": mo, "gap": None, "n": 0} for mo in months]}
    mine_ids = {t.id for t in mine}
    coffee_ids = {t.coffee_id for t in mine}
    by_coffee = defaultdict(list)
    for t in db.session.execute(_closed_basic().where(Tasting.coffee_id.in_(coffee_ids))).scalars():
        by_coffee[t.coffee_id].append(t)

    def others_of(cid):
        return [o for o in by_coffee[cid] if o.id not in mine_ids]

    diffs, gaps = defaultdict(list), []
    for t in mine:
        others = [o.overall for o in others_of(t.coffee_id)]
        if len(by_coffee[t.coffee_id]) >= CONSENSUS_THRESHOLD and others:
            gap = t.overall - mean(others)
            diffs[t.coffee_id].append(gap)       # one vote per coffee, however often tasted
            gaps.append((t.created_at, abs(gap)))
    bias = round1(mean(mean(v) for v in diffs.values()), 2) if diffs else None

    by_month = defaultdict(list)
    for ts, gap in gaps:
        if ts is not None:
            local = to_group_local(ts, tz)
            by_month[f"{local.year:04d}-{local.month:02d}"].append(gap)
    gap_series = [{"month": mo, "gap": round1(mean(by_month[mo]), 2) if by_month.get(mo) else None,
                   "n": len(by_month.get(mo, []))} for mo in months]

    def last_read(cid):
        return max(t.created_at or datetime.min for t in mine if t.coffee_id == cid)

    coffees_tasted = []
    for cid in sorted(coffee_ids, key=last_read, reverse=True):
        yours = [t.overall for t in mine if t.coffee_id == cid]
        others = others_of(cid)
        coffee = next(t.coffee for t in mine if t.coffee_id == cid)
        coffees_tasted.append({
            "coffee_id": cid, "name": coffee.name, "roaster": coffee.roaster, "kind": coffee.kind,
            "reads": len(yours), "yours": round1(mean(yours)),
            # One other person's average IS that person's read, so it needs two.
            "theirs": (round1(mean(o.overall for o in others))
                       if len({_person_key(o) for o in others}) >= MIN_OTHER_PEOPLE else None),
            "others_n": len(others),
        })
    lex = content.get()
    terms = {tag.term for t in mine for tag in t.tags}
    return {
        "tastings": len(mine), "coffees": len(coffee_ids), "terms_used": len(terms),
        "specific_terms": sum(1 for k in terms if lex.tier_of(k) == 3),
        "bias": bias, "bias_coffees": len(diffs), "gap_series": gap_series, "coffees_tasted": coffees_tasted,
    }
