"""Coffee sessions builder (tasting.coffee_sessions)."""
import datetime
from datetime import timedelta

import pytest
from sqlalchemy import event

from tasting.coffee_sessions import BASIC_CATS, SESSIONS_PAGE, coffee_sessions, your_lean
from tasting.enums import ADV_CATEGORIES
from tasting.models import TastingDefect, TastingTag
from tasting.repository import TasterIdentity, blind_cup_label
from tests.tasting.helpers import (make_coffee, make_flight, make_group, make_member,
                                   make_tasting, make_user)
from utils import utc_now

JASMINE, PEACH = "Floral>jasmine", "Fruit>Stone Fruit>peach"
TZ = "UTC"


class Room:
    """Test people: each name is a real user with a member row in one group."""

    def __init__(self, db_session):
        self.db = db_session
        self.group = make_group(db_session)
        self.people = {}

    def person(self, sub, name=None):
        if sub not in self.people:
            user = make_user(self.db)
            member = make_member(self.db, self.group, name or sub.upper(), user_id=user.id)
            self.people[sub] = (user, member, name or sub.upper())
        return self.people[sub]

    def who(self, sub="a", name=None):
        user, member, display = self.person(sub, name)
        return TasterIdentity(user_id=user.id, member_id=member.id,
                              taster_key=f"user:{user.id}", name=display, created_via="account")

    def read(self, flight, coffee, sub, adv=None, **kw):
        user, member, display = self.person(sub, kw.pop("taster_name", None))
        kw.setdefault("taster_name", display)
        return make_tasting(self.db, flight, coffee, adv=adv, user_id=user.id, member_id=member.id,
                            taster_key=f"user:{user.id}", **kw)

    def coffee(self, **kw):
        return make_coffee(self.db, self.group, **kw)

    def adv_flight(self, coffees, **kw):
        kw = {"sheet": "advanced", "adv_step": 0.5, "prep": "cupping", "is_shared": True,
              "is_open": False, **kw}
        return make_flight(self.db, self.group, coffees, **kw)

    def closed(self, coffees, **kw):
        return make_flight(self.db, self.group, coffees, is_open=False, **kw)

    def call(self, coffee, who=None, **kw):
        kw.setdefault("can_name", lambda f: True)
        kw.setdefault("tz", TZ)
        return coffee_sessions(coffee, who, **kw)


@pytest.fixture
def room(db_session):
    return Room(db_session)


class TestCoffeeSessions:
    def test_open_flight_not_listed(self, room):
        c = room.coffee()
        f = make_flight(room.db, room.group, [c], is_shared=True, is_open=True,
                        closes_at=utc_now() + timedelta(hours=24))
        room.read(f, c, "a")
        assert room.call(c, room.who())["sessions"] == []

    def test_solo_listing(self, room):
        c = room.coffee()
        f = room.closed([c])
        room.read(f, c, "a")
        assert [s["flight_id"] for s in room.call(c, room.who("a"))["sessions"]] == [f.id]
        assert room.call(c, room.who("b", "Bea"))["sessions"] == []
        assert len(room.call(c, room.who("b", "Bea"), include_all_solo=True)["sessions"]) == 1

    def test_solo_reads_named_for_editor_despite_floor(self, room):
        c = room.coffee()
        f = room.closed([c])
        room.read(f, c, "a", taster_name="Ann")
        user_a = room.person("a")[0]
        s = room.call(c, room.who("b", "Bea"), include_all_solo=True)["sessions"][0]
        assert s["room"] is None and s["rank"] is None
        assert [(r["taster_key"], r["taster_name"], r["is_you"]) for r in s["reads"]] == [
            (f"user:{user_a.id}", "Ann", False)]
        # Without access to name, another person's solo session is not listed.
        assert room.call(c, room.who("b", "Bea"), include_all_solo=True,
                         can_name=lambda f: False)["sessions"] == []
        # Your own solo session stays listed even when names are withheld.
        s = room.call(c, room.who("a", "Ann"), include_all_solo=True,
                      can_name=lambda f: False)["sessions"][0]
        assert s["reads"] is None

    def test_floor_three_reads(self, room):
        c = room.coffee()
        f = room.adv_flight([c])
        for sub in ("a", "b"):
            room.read(f, c, sub, adv=8.0)
        s = room.call(c, room.who())["sessions"][0]
        assert s["room"] is None and s["reads"] is None and s["yours"] is not None
        room.read(f, c, "c", adv=8.0)
        room.db.expire_all()
        assert room.call(c, room.who())["sessions"][0]["room"]["n_others"] == 2

    def test_others_avg_excludes_you_range_includes_you(self, room):
        c = room.coffee()
        f = room.adv_flight([c])
        room.read(f, c, "a", adv=8.0, adv_aroma=9.0)
        for sub, v in (("b", 8.0), ("c", 8.0), ("d", 8.5)):
            room.read(f, c, sub, adv=8.0, adv_aroma=v)
        r = room.call(c, room.who())["sessions"][0]["room"]
        assert r["others_avg"]["aroma"] == 8.2
        assert r["range"]["aroma"] == [8.0, 9.0]
        assert set(r["others_avg"]) == set(ADV_CATEGORIES) | {"total"}
        assert set(r["range"]) == set(ADV_CATEGORIES) | {"total"}

    def test_no_read_of_yours_averages_everyone(self, room):
        c = room.coffee()
        f = room.adv_flight([c])
        for sub, v in (("b", 8.0), ("c", 8.0), ("d", 8.5)):
            room.read(f, c, sub, adv=8.0, adv_aroma=v)
        s = room.call(c, room.who("z", "Zed"))["sessions"][0]
        assert s["yours"] is None and s["room"]["n_others"] == 3
        assert s["room"]["others_avg"]["aroma"] == 8.2

    def test_reads_follow_can_name(self, room):
        c = room.coffee()
        f = room.adv_flight([c])
        for sub, name in (("a", "Zoe"), ("b", "Cal"), ("c", "Abe"), ("d", "Bo")):
            room.read(f, c, sub, adv=8.0, taster_name=name)
        assert room.call(c, room.who("a", "Zoe"), can_name=lambda f: False)["sessions"][0]["reads"] is None
        reads = room.call(c, room.who("a", "Zoe"))["sessions"][0]["reads"]
        assert len(reads) == 4 and reads[0]["is_you"] is True
        assert [r["taster_name"] for r in reads[1:]] == ["Abe", "Bo", "Cal"]

    def test_named_reads_sort_case_insensitive(self, room):
        c = room.coffee()
        f = room.adv_flight([c])
        for sub, name in (("a", "Zoe"), ("b", "bo"), ("c", "Abe"), ("d", "Cal")):
            room.read(f, c, sub, adv=8.0, taster_name=name)
        reads = room.call(c, room.who("a", "Zoe"))["sessions"][0]["reads"]
        assert [r["taster_name"] for r in reads[1:]] == ["Abe", "bo", "Cal"]

    def test_basic_rank_uses_mean_overall(self, room):
        c1, c2 = room.coffee(name="One"), room.coffee(name="Two")
        f = room.closed([c1, c2], is_shared=True)
        for sub in ("a", "b", "c"):
            room.read(f, c1, sub, overall=2)
            room.read(f, c2, sub, overall=5)
        s1 = room.call(c1, room.who("a"))["sessions"][0]
        s2 = room.call(c2, room.who("a"))["sessions"][0]
        assert s1["rank"] == {"place": 2, "of": 2} and s2["rank"] == {"place": 1, "of": 2}
        assert s2["vs_flight"] == 1.5

    def test_basic_session_shape(self, room):
        c = room.coffee()
        f = room.closed([c], is_shared=True)
        for sub in "abc":
            room.read(f, c, sub, overall=4, acidity=3, sweetness=3, body=3, balance=3)
        s = room.call(c, room.who())["sessions"][0]
        assert s["sheet"] == "basic" and s["room"]["votes"] is None
        assert set(s["room"]["others_avg"]) == set(BASIC_CATS)
        assert isinstance(s["yours"]["overall"], int)
        assert s["yours"]["total"] is None and s["yours"]["vote"] is None

    def test_dq_counts_and_ranges(self, room):
        c = room.coffee()
        f = room.adv_flight([c])
        room.read(f, c, "a", adv=8.0, adv_aroma=7.0)
        for sub in "bc":
            room.read(f, c, sub, adv=8.0, adv_aroma=8.0)
        r = room.call(c, room.who("z", "Zed"))["sessions"][0]["room"]
        assert r["range"]["aroma"][0] == 7.0
        assert r["others_avg"]["aroma"] == 7.7

    def test_rank_and_vs_flight(self, room):
        a, b, c, d = (room.coffee() for _ in range(4))
        f = room.adv_flight([a, b, c, d])
        for coffee, v in ((a, 8.5), (b, 8.3), (c, 8.0)):
            for sub in "xyz":
                room.read(f, coffee, sub, adv=v)
        for sub in "xy":
            room.read(f, d, sub, adv=9.0)
        mid = room.call(b, room.who("z"))["sessions"][0]
        assert mid["rank"] == {"place": 2, "of": 3} and mid["vs_flight"] == 0.3
        assert room.call(d, room.who("x"))["sessions"][0]["rank"] is None
        assert room.call(d, room.who("x"))["sessions"][0]["vs_flight"] is None

    def test_room_counts_terms_defects_votes(self, room):
        c = room.coffee()
        f = room.adv_flight([c])
        reads = [room.read(f, c, sub, adv=8.0, bar_vote=v)
                 for sub, v in (("a", "yes"), ("b", "yes"), ("c", "no"))]
        for t in reads:
            t.tags.append(TastingTag(term=JASMINE))
        reads[0].tags.append(TastingTag(term=PEACH))
        reads[1].defects.append(TastingDefect(term="fermented"))
        room.db.flush()
        r = room.call(c, room.who("a"))["sessions"][0]["room"]
        assert r["votes"] == {"yes": 2, "maybe": 0, "no": 1}
        assert [(t["term"], t["count"]) for t in r["terms"]] == [(JASMINE, 3), (PEACH, 1)]
        assert r["terms"][0]["label"] == "jasmine"
        assert r["defects"] == [{"term": "fermented", "count": 1}]

    def test_cup_label_blind_only(self, room):
        c = room.coffee()
        blind = room.adv_flight([c], is_blind=True)
        plain = room.adv_flight([c], is_blind=False)
        room.read(blind, c, "a", adv=8.0)
        room.read(plain, c, "a", adv=8.0)
        by_id = {s["flight_id"]: s for s in room.call(c, room.who())["sessions"]}
        assert by_id[blind.id]["cup_label"] == blind_cup_label(blind.coffees[0])
        assert by_id[plain.id]["cup_label"] is None

    def test_paging_and_sheet_filter(self, room):
        c = room.coffee()
        adv = [room.adv_flight([c]) for _ in range(SESSIONS_PAGE + 1)]
        basic = [room.closed([c], is_shared=True) for _ in range(2)]
        for f in adv:
            room.read(f, c, "a", adv=8.0)
        for f in basic:
            room.read(f, c, "a")
        everything = sorted([f.id for f in adv + basic], reverse=True)
        page1 = room.call(c, room.who())
        assert [s["flight_id"] for s in page1["sessions"]] == everything[:SESSIONS_PAGE]
        assert page1["next_before"] == everything[SESSIONS_PAGE - 1]
        page2 = room.call(c, room.who(), before=page1["next_before"])
        assert [s["flight_id"] for s in page2["sessions"]] == everything[SESSIONS_PAGE:]
        assert page2["next_before"] is None
        only_basic = room.call(c, room.who(), sheet="basic")
        assert [s["flight_id"] for s in only_basic["sessions"]] == sorted((f.id for f in basic), reverse=True)

    def test_guest_paper_read_in_reads(self, room):
        c = room.coffee()
        f = room.adv_flight([c])
        for sub in "ab":
            room.read(f, c, sub, adv=8.0)
        make_tasting(room.db, f, c, adv=8.0, user_id=None, taster_key="paper:name:pat",
                     taster_name="Pat", created_via="paper")
        reads = room.call(c, room.who("a"))["sessions"][0]["reads"]
        pat = next(r for r in reads if r["taster_name"] == "Pat")
        assert pat["is_you"] is False and pat["taster_key"] == "paper:name:pat"

    def test_archived_coffee_still_has_sessions(self, room):
        c = room.coffee(archived_at=utc_now())
        f = room.adv_flight([c])
        room.read(f, c, "a", adv=8.0)
        assert len(room.call(c, room.who())["sessions"]) == 1

    def test_sessions_bucket_by_group_timezone(self, room):
        c = room.coffee()
        # 06:30 UTC on the 10th is 23:30 on the 9th in Los Angeles (UTC-7 in September).
        f = room.closed([c], opened_at=datetime.datetime(2026, 9, 10, 6, 30),
                        closes_at=datetime.datetime(2026, 9, 10, 6, 30))
        room.read(f, c, "a")
        la = room.call(c, room.who("a"), tz="America/Los_Angeles")["sessions"][0]
        utc = room.call(c, room.who("a"), tz="UTC")["sessions"][0]
        assert la["date"] == "2026-09-09"
        assert utc["date"] == "2026-09-10"

    def test_query_count_flat(self, room):
        c = room.coffee()

        def add_session():
            f = room.adv_flight([c])
            for sub in "abc":
                room.read(f, c, sub, adv=8.0)
            room.db.commit()

        def count_queries():
            counter = {"n": 0}

            def _before(conn, cursor, statement, params, context, executemany):
                counter["n"] += 1
            engine = room.db.get_bind()
            event.listen(engine, "before_cursor_execute", _before)
            try:
                room.db.expire_all()
                room.call(c, room.who())
            finally:
                event.remove(engine, "before_cursor_execute", _before)
            return counter["n"]

        for _ in range(2):
            add_session()
        two = count_queries()
        for _ in range(8):
            add_session()
        assert count_queries() == two


MINE = [9, 8.5, 8.5, 9, 8.5, 8, 8, 8.5, 8.5, 8.5]
OTHERS = [
    [8.5, 8.5, 8, 8, 8, 8, 8, 8.5, 8, 8.5],
    [8.5, 8.5, 8.5, 8.5, 9, 8, 8, 8, 8.5, 8.5],
    [8.5, 8, 8, 8.5, 8.5, 8, 8, 8, 8, 8.5],
    [9, 9, 8.5, 9, 8.5, 8.5, 8, 8.5, 8.5, 8.5],
    [8, 8, 7.5, 8.5, 8, 8, 8, 8, 8.5, 8],
]


def _adv_read(room, flight, coffee, sub, scores):
    return room.read(flight, coffee, sub, adv=8.0,
                     **{f"adv_{cat}": v for cat, v in zip(ADV_CATEGORIES, scores)})


class TestYourLean:
    def test_your_lean_matches_mockup(self, room):
        c = room.coffee()
        f = room.adv_flight([c])
        _adv_read(room, f, c, "a", MINE)
        for i, scores in enumerate(OTHERS):
            _adv_read(room, f, c, f"o{i}", scores)
        lean = your_lean(c, room.who("a"))
        assert lean["advanced"]["total"] == 2.1
        assert lean["advanced"]["top"] == [{"category": "aroma", "diff": 0.5},
                                           {"category": "acidity", "diff": 0.5}]
        assert lean["basic"] is None

    def test_no_lean_below_three_reads_or_without_a_read(self, room):
        c = room.coffee()
        f = room.adv_flight([c])
        _adv_read(room, f, c, "a", MINE)
        _adv_read(room, f, c, "b", OTHERS[0])
        assert your_lean(c, room.who("a")) == {"advanced": None, "basic": None}
        _adv_read(room, f, c, "c", OTHERS[1])
        assert your_lean(c, room.who("z", "Zed")) == {"advanced": None, "basic": None}

    def test_basic_lean_is_overall_stars_only(self, room):
        c = room.coffee()
        f = room.closed([c], is_shared=True)
        room.read(f, c, "a", overall=5)
        room.read(f, c, "b", overall=3)
        room.read(f, c, "c", overall=4)
        assert your_lean(c, room.who("a")) == {"advanced": None, "basic": {"overall": 1.5}}
