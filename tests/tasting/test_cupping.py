"""Flight-scoped advanced summary, the cupping CSV and the palate's cupping block."""
import csv
import datetime
import io
import json

import pytest

from tasting import cupping
from tasting.enums import ADV_CATEGORIES
from tasting.models import TastingDefect, TastingTag
from tasting.repository import TasterIdentity
from tests.tasting.helpers import make_coffee, make_flight, make_group, make_member, make_tasting
from utils import utc_now


def _who(key="caller", member_id=None):
    return TasterIdentity(user_id=None, member_id=member_id, taster_key=f"user:{key}",
                          name=key.title(), created_via="account")


def _read(db_session, flight, coffee, key, name, adv, **kw):
    return make_tasting(db_session, flight, coffee, adv=adv, taster_key=f"user:{key}",
                        taster_name=name, **kw)


@pytest.fixture
def group(db_session):
    return make_group(db_session)


@pytest.fixture
def flight(db_session, group):
    a, b, c = (make_coffee(db_session, group, n) for n in ("Alpha", "Bravo", "Charlie"))
    f = make_flight(db_session, group, [a, b, c], sheet="advanced", adv_step=0.5, prep="cupping",
                    is_open=False)
    return f, a, b, c


def _summary(f, who=None, named=True):
    return cupping.build_summary(f, who, named=named)


class TestRanking:
    def test_avg_total_desc_unscored_last(self, db_session, flight):
        f, a, b, c = flight
        _read(db_session, f, a, "u1", "One", 8.4)
        _read(db_session, f, b, "u1", "One", 8.8)
        db_session.refresh(f)
        out = _summary(f)
        assert [x["coffee_id"] for x in out["coffees"]] == [b.id, a.id, c.id]
        last = out["coffees"][-1]
        assert last["n"] == 0 and last["avg_total"] is None
        assert all(v is None for v in last["categories"].values())
        assert out["coffees"][0]["avg_total"] == 88.0
        assert out["coffees"][0]["categories"]["aroma"] == {"avg": 8.8, "min": 8.8, "max": 8.8}

    def test_votes_and_yes_share(self, db_session, flight):
        f, a, *_ = flight
        for key, vote in (("u1", "yes"), ("u2", "yes"), ("u3", "no")):
            _read(db_session, f, a, key, key, 8.0, bar_vote=vote)
        db_session.refresh(f)
        top = _summary(f)["coffees"][0]
        assert top["votes"] == {"yes": 2, "maybe": 0, "no": 1} and top["yes_share"] == 0.67

    def test_terms_and_defects(self, db_session, flight):
        f, a, *_ = flight
        t = _read(db_session, f, a, "u1", "One", 8.0)
        t.tags.append(TastingTag(term="Fruit>Berry>blueberry", strength=2))
        t.defects.append(TastingDefect(term="papery"))
        db_session.flush()
        db_session.refresh(f)
        top = _summary(f)["coffees"][0]
        assert top["top_terms"][0]["term"] == "Fruit>Berry>blueberry" and top["top_terms"][0]["pct"] == 100
        assert top["defects"] == {"papery": 1}


class TestNamedGate:
    def _dq(self, db_session, flight):
        f, a, *_ = flight
        _read(db_session, f, a, "u1", "Sam", 8.0, adv_acidity=7.0)
        _read(db_session, f, a, "u2", "Two", 8.0)
        _read(db_session, f, a, "u3", "Three", 8.0)
        db_session.refresh(f)
        return f

    def test_named_shows_by_and_reads(self, db_session, flight):
        top = _summary(self._dq(db_session, flight))["coffees"][0]
        assert top["dq"] == [{"category": "acidity", "by": "Sam"}]
        assert top["reads"][0]["taster_name"] == "Sam" and top["reads"][0]["scores"]["acidity"] == 7.0

    def test_unnamed_omits_by_and_reads(self, db_session, flight):
        out = _summary(self._dq(db_session, flight), named=False)
        top = out["coffees"][0]
        assert top["dq"] == [{"category": "acidity", "by": None, "count": 1}]
        assert top["reads"] is None and out["named"] is False and "Sam" not in str(out["coffees"])

    def test_unnamed_dq_is_distinct_categories_in_sheet_order(self, db_session, flight):
        f, a, *_ = flight
        _read(db_session, f, a, "u1", "Uno", 8.0, adv_balance=7.0)
        _read(db_session, f, a, "u2", "Dos", 8.0, adv_balance=7.0)
        _read(db_session, f, a, "u3", "Tres", 8.0, adv_aroma=7.0, adv_balance=7.0)
        db_session.refresh(f)
        assert _summary(f, named=False)["coffees"][0]["dq"] == [
            {"category": "aroma", "by": None, "count": 1}, {"category": "balance", "by": None, "count": 3}]
        dq = _summary(f)["coffees"][0]["dq"]
        assert sorted((d["by"], d["category"]) for d in dq) == [
            ("Dos", "balance"), ("Tres", "aroma"), ("Tres", "balance"), ("Uno", "balance")]

    def test_yours_present_when_unnamed(self, db_session, flight):
        f, a, *_ = flight
        _read(db_session, f, a, "caller", "Caller", 8.5)
        _read(db_session, f, a, "u2", "Other", 8.0)
        db_session.refresh(f)
        out = _summary(f, _who(), named=False)
        assert out["yours"][a.id]["total"] == 85.0 and out["coffees"][0]["reads"] is None


class TestCalibration:
    def test_leave_one_out_with_three_others(self, db_session, flight):
        f, a, *_ = flight
        _read(db_session, f, a, "caller", "Caller", 8.0, adv_aroma=9.0)
        for i in range(3):
            _read(db_session, f, a, f"o{i}", f"O{i}", 8.0)
        db_session.refresh(f)
        cal = _summary(f, _who(), named=False)["calibration"]
        assert cal["aroma"] == 1.0 and cal["flavour"] == 0.0

    def test_two_others_or_no_caller_is_none(self, db_session, flight):
        f, a, *_ = flight
        _read(db_session, f, a, "caller", "Caller", 8.0, adv_aroma=9.0)
        for i in range(2):
            _read(db_session, f, a, f"o{i}", f"O{i}", 8.0)
        db_session.refresh(f)
        assert _summary(f, _who(), named=False)["calibration"] is None
        assert _summary(f, None)["calibration"] is None


class TestSmallCuppingWithholding:
    def test_two_reads_unnamed_withholds_aggregates(self, db_session, flight):
        f, a, *_ = flight
        _read(db_session, f, a, "caller", "Caller", 8.5)
        t = _read(db_session, f, a, "u2", "Other", 7.8, adv_acidity=7.0, bar_vote="no")
        t.tags.append(TastingTag(term="Fruit>Berry>blueberry", strength=2))
        t.defects.append(TastingDefect(term="papery"))
        db_session.flush()
        db_session.refresh(f)
        out = _summary(f, _who(), named=False)
        top = next(c for c in out["coffees"] if c["coffee_id"] == a.id)
        assert top["n"] == 2 and top["avg_total"] is None
        assert all(v is None for v in top["categories"].values())
        assert top["votes"] is None and top["yes_share"] is None and top["reads"] is None
        assert top["top_terms"] == [] and top["defects"] == {} and top["dq"] == []
        assert out["yours"][a.id]["total"] == 85.0
        full = next(c for c in _summary(f, _who())["coffees"] if c["coffee_id"] == a.id)
        assert full["avg_total"] is not None and len(full["reads"]) == 2
        assert full["votes"]["no"] == 1 and full["dq"][0]["by"] == "Other"

    def test_ranking_shown_before_withheld(self, db_session, flight):
        f, a, b, c = flight
        for i in range(2):
            _read(db_session, f, a, f"a{i}", f"A{i}", 9.0)
        for i in range(3):
            _read(db_session, f, b, f"b{i}", f"B{i}", 8.0)
        db_session.refresh(f)
        assert [x["coffee_id"] for x in _summary(f, named=False)["coffees"]] == [b.id, a.id, c.id]
        top = _summary(f, named=False)["coffees"][0]
        assert top["avg_total"] == 80.0 and top["votes"]["yes"] == 3


HEADER = ["flight_name", "flight_date", "coffee", "roaster", "origin", "process",
          "blind_label", "taster", "source", *ADV_CATEGORIES, "total",
          "dq", "dq_categories", "bar_vote", "flavor_terms", "defects", "note"]


class TestCsv:
    def _rows(self, f, tz="UTC"):
        return list(csv.reader(io.StringIO(cupping.build_csv(f, tz=tz))))

    def test_header_rows_dq_and_date(self, db_session, flight):
        f, a, b, c = flight
        _read(db_session, f, a, "u1", "One", 8.0)
        _read(db_session, f, a, "u2", "Two", 8.0, adv_acidity=7.0)
        _read(db_session, f, b, "u1", "One", 8.5)
        _read(db_session, f, b, "u2", "Two", 8.5, created_via="device")
        db_session.refresh(f)
        rows = self._rows(f)
        assert rows[0] == HEADER and len(rows) == 5
        col = {h: i for i, h in enumerate(HEADER)}
        assert rows[1][col["flight_date"]] == "2026-09-10"
        assert rows[1][col["coffee"]] == "Alpha" and rows[1][col["taster"]] == "One"
        assert rows[1][col["source"]] == "live" and rows[1][col["aroma"]] == "8.0"
        assert rows[2][col["acidity"]] == "7.0" and rows[2][col["dq"]] == "yes"
        assert rows[2][col["dq_categories"]] == "acidity" and rows[1][col["dq"]] == "no"
        assert rows[4][col["source"]] == "device"

    def test_date_is_the_groups_day(self, db_session, flight):
        f, a, *_ = flight
        f.opened_at = datetime.datetime(2026, 9, 10, 2, 0)
        _read(db_session, f, a, "u1", "One", 8.0)
        db_session.refresh(f)
        assert self._rows(f, tz="America/Los_Angeles")[1][1] == "2026-09-09"

    def test_formula_guard_and_embedded_commas(self, db_session, group):
        k = make_coffee(db_session, group, "Kenya, AA")
        f = make_flight(db_session, group, [k], sheet="advanced", adv_step=0.5, prep="cupping", is_open=False)
        nasty = '=HYPERLINK("x")\nline2, "quoted"'
        _read(db_session, f, k, "u1", "One", 8.0, note=nasty)
        db_session.refresh(f)
        row = self._rows(f)[1]
        col = {h: i for i, h in enumerate(HEADER)}
        assert row[col["coffee"]] == "Kenya, AA" and row[col["note"]] == "'" + nasty


class TestCuppingPalate:
    def _flight(self, db_session, group, coffees, *, closed=True, **kw):
        if not closed:   # the helper's default window is long past; an open cupping must be live
            kw["closes_at"] = utc_now() + datetime.timedelta(hours=24)
        return make_flight(db_session, group, coffees, sheet="advanced", adv_step=0.5, prep="cupping",
                           is_open=not closed, **kw)

    def _others(self, db_session, f, c, n, score=8.0, **kw):
        return [_read(db_session, f, c, f"o{i}", f"Other{i}", score, **kw) for i in range(n)]

    @pytest.fixture(autouse=True)
    def _group(self, group):
        self.group = group

    def _palate(self, who=None, member_ids=()):
        return cupping.cupping_palate(self.group.id, who or _who(), list(member_ids), tz="UTC")

    def test_closed_only(self, db_session, group):
        c = make_coffee(db_session, group)
        closed = self._flight(db_session, group, [c])
        open_ = self._flight(db_session, group, [c], closed=False)
        _read(db_session, closed, c, "caller", "Caller", 8.5)
        _read(db_session, open_, c, "caller", "Caller", 9.0)
        out = self._palate()
        assert [x["flight_id"] for x in out["cups"]] == [closed.id]
        assert out["open_reads"] == 1 and out["reads"] == 1

    def test_room_needs_three_others(self, db_session, group):
        c = make_coffee(db_session, group)
        f = self._flight(db_session, group, [c])
        _read(db_session, f, c, "caller", "Caller", 8.5)
        self._others(db_session, f, c, 2)
        out = self._palate()
        assert out["cups"][0]["room_total"] is None and out["lean"] == {} and out["lean_mean"] is None
        _read(db_session, f, c, "o9", "Other9", 8.0)
        out = self._palate()
        assert out["cups"][0]["room_total"] == 80.0 and out["lean"]["aroma"] == 0.5
        assert list(out["lean"]) == list(ADV_CATEGORIES)

    def test_lean_mean_comes_from_unrounded_values(self, db_session, group):
        c = make_coffee(db_session, group)
        f = self._flight(db_session, group, [c])
        _read(db_session, f, c, "caller", "Caller", 8.0)
        _read(db_session, f, c, "o0", "Other0", 8.0, **{f"adv_{cat}": 7.5 for cat in ADV_CATEGORIES[:8]})
        _read(db_session, f, c, "o1", "Other1", 8.0)
        _read(db_session, f, c, "o2", "Other2", 8.0)
        out = self._palate()
        assert all(out["lean"][cat] == 0.2 for cat in ADV_CATEGORIES[:8]) and out["lean_mean"] == 0.1

    def test_paper_and_device_reads_of_my_member_are_mine(self, db_session, group):
        member = make_member(db_session, group, "Rowan")
        c1, c2 = make_coffee(db_session, group), make_coffee(db_session, group)
        f = self._flight(db_session, group, [c1, c2])
        make_tasting(db_session, f, c1, adv=8.5, member_id=member.id, taster_key=f"paper:member:{member.id}",
                     created_via="paper")
        make_tasting(db_session, f, c2, adv=9.0, member_id=member.id, taster_key=f"member:{member.id}",
                     created_via="device")
        out = self._palate(_who("rowan"), [member.id])
        assert out["reads"] == 2 and sorted(x["total"] for x in out["cups"]) == [85.0, 90.0]

    def test_names_nobody(self, db_session, group):
        c = make_coffee(db_session, group)
        f = self._flight(db_session, group, [c])
        _read(db_session, f, c, "caller", "Caller", 8.5)
        self._others(db_session, f, c, 3)
        blob = json.dumps(self._palate())
        assert "Other0" not in blob and "user:o0" not in blob and "taster_key" not in blob

    def test_votes_and_room_share(self, db_session, group):
        c1, c2 = make_coffee(db_session, group), make_coffee(db_session, group)
        f = self._flight(db_session, group, [c1, c2])
        _read(db_session, f, c1, "caller", "Caller", 8.5, bar_vote="yes")
        for i, v in enumerate(("yes", "yes", "no")):
            _read(db_session, f, c1, f"o{i}", f"Other{i}", 8.0, bar_vote=v)
        _read(db_session, f, c2, "caller", "Caller", 8.5, bar_vote="no")
        self._others(db_session, f, c2, 2, bar_vote="yes")
        out = self._palate()
        assert out["votes"] == {"yes": 1, "maybe": 0, "no": 1} and out["room_yes_share"] == 0.67

    def test_ignores_basic_reads(self, db_session, group):
        c = make_coffee(db_session, group)
        f = make_flight(db_session, group, [c], is_open=False)
        make_tasting(db_session, f, c, taster_key="user:caller", overall=5)
        out = self._palate()
        assert out["reads"] == 0 and out["cups"] == [] and out["room_yes_share"] is None
