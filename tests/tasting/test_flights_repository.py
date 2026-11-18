"""Flight half of the repository: entry validation, create/log, timer, paper,
the reveal, the palate, and group scoping."""
import datetime
from decimal import Decimal

import pytest

from tasting import flights_repository as frepo
from tasting.palate import palate
from tasting.enums import ADV_CATEGORIES
from tasting.errors import TastingStateError, TastingValidationError
from tasting.repository import TasterIdentity, blind_label, coffee_detail, list_coffees
from tests.tasting.helpers import (make_coffee, make_flight, make_group, make_member,
                                   make_tasting, make_user)
from utils import utc_now


@pytest.fixture
def group(db_session):
    return make_group(db_session)


@pytest.fixture
def who(db_session, group):
    user = make_user(db_session)
    member = make_member(db_session, group, "Alex", user_id=user.id)
    return TasterIdentity(user_id=user.id, member_id=member.id, taster_key=f"user:{user.id}",
                          name="Alex", created_via="account")


def _cup(**over):
    e = {c: 8.5 for c in ADV_CATEGORIES}
    e["bar_vote"] = "yes"
    e.update(over)
    return e


def _adv_flight(db_session, group, who, n=3, **over):
    coffees = [make_coffee(db_session, group) for _ in range(n)]
    data = {"coffee_ids": [c.id for c in coffees], "prep": "cupping", "shared": True, "sheet": "advanced"}
    data.update(over)
    return frepo.create_flight(group.id, data, who), coffees


def test_blind_labels():
    assert [blind_label(i) for i in (0, 1, 25)] == ["A", "B", "Z"]
    assert blind_label(26) == "Cup 27"


class TestAdvancedValidation:
    def test_fine_step_accepts_tenths(self):
        assert frepo._adv_score(8.3, "aroma", Decimal("0.1")) == Decimal("8.3")

    def test_coarse_step_rejects_tenths(self):
        with pytest.raises(TastingValidationError, match="steps of 0.5"):
            frepo._adv_score(8.3, "aroma", Decimal("0.5"))

    def test_int_and_dq_value(self):
        assert frepo._adv_score(8, "aroma", Decimal("0.5")) == Decimal("8.0")
        assert frepo._adv_score(7.0, "aroma", Decimal("0.5")) == Decimal("7.0")

    @pytest.mark.parametrize("bad", [True, "8.5", None, 7.2, 7.4, 10.5, 8.25,
                                     float("inf"), float("-inf"), float("nan")])
    def test_rejects_bad_values_naming_field(self, bad):
        with pytest.raises(TastingValidationError, match="aroma"):
            frepo._adv_score(bad, "aroma", Decimal("0.1"))

    def test_entry_happy_path(self):
        out = frepo._adv_entry(_cup(), 0, Decimal("0.5"))
        assert out["bar_vote"] == "yes" and set(out["scores"]) == set(ADV_CATEGORIES)
        assert out["scores"]["aroma"] == Decimal("8.5")

    def test_entry_missing_category_names_it(self):
        e = _cup()
        del e["bitterness"]
        with pytest.raises(TastingValidationError, match=r"entries\[0\]\.bitterness"):
            frepo._adv_entry(e, 0, Decimal("0.5"))

    def test_entry_bad_score_names_cup_and_category(self):
        with pytest.raises(TastingValidationError, match=r"entries\[2\]\.aroma"):
            frepo._adv_entry(_cup(aroma=8.3), 2, Decimal("0.5"))

    def test_entry_requires_valid_vote(self):
        e = _cup()
        del e["bar_vote"]
        with pytest.raises(TastingValidationError, match="bar_vote"):
            frepo._adv_entry(e, 0, Decimal("0.5"))
        with pytest.raises(TastingValidationError, match="bar_vote"):
            frepo._adv_entry(_cup(bar_vote="sure"), 0, Decimal("0.5"))

    @pytest.mark.parametrize("key", ["overall", "body"])
    def test_entry_rejects_basic_attributes(self, key):
        with pytest.raises(TastingValidationError, match=rf"entries\[0\]\.{key} does not apply"):
            frepo._adv_entry(_cup(**{key: 4}), 0, Decimal("0.5"))


class TestAdvancedFlights:
    def test_create_defaults_step_to_half(self, db_session, group, who):
        f, _ = _adv_flight(db_session, group, who)
        assert f.sheet == "advanced" and f.adv_step == Decimal("0.5")
        d = frepo.flight_dict(f, who)
        assert d["sheet"] == "advanced" and d["adv_step"] == 0.5
        assert d["timer_started_at"] is None and d["adv_pass"] is None

    def test_basic_flight_has_no_step(self, db_session, group, who):
        c = make_coffee(db_session, group)
        f = frepo.create_flight(group.id, {"coffee_ids": [c.id], "prep": "drip", "shared": True}, who)
        d = frepo.flight_dict(f, who)
        assert d["sheet"] == "basic" and d["adv_step"] is None

    def test_needs_cupping_prep(self, db_session, group, who):
        with pytest.raises(TastingValidationError, match="prep=cupping"):
            _adv_flight(db_session, group, who, prep="drip")

    def test_needs_shared(self, db_session, group, who):
        with pytest.raises(TastingValidationError, match="shared flight"):
            _adv_flight(db_session, group, who, shared=False)

    @pytest.mark.parametrize("step", [0.25, 1, "0.5", True])
    def test_bad_step_refused(self, db_session, group, who, step):
        with pytest.raises(TastingValidationError, match="adv_step"):
            _adv_flight(db_session, group, who, adv_step=step)

    def test_unknown_sheet_refused(self, db_session, group, who):
        with pytest.raises(TastingValidationError, match="sheet"):
            _adv_flight(db_session, group, who, sheet="paper")

    def test_log_skipping_cups(self, db_session, group, who):
        f, cs = _adv_flight(db_session, group, who)
        (t,) = frepo.log_tastings(f, [dict(_cup(), coffee_id=cs[0].id, bar_vote="maybe")], who)
        assert t.sheet == "advanced" and t.overall is None
        assert t.adv_aroma == Decimal("8.5") and t.bar_vote == "maybe"
        assert (t.user_id, t.member_id) == (who.user_id, who.member_id)

    def test_log_by_position(self, db_session, group, who):
        f, _ = _adv_flight(db_session, group, who)
        rows = frepo.log_tastings(f, [dict(_cup(), position=2)], who)
        assert rows[0].coffee_id == f.coffees[1].coffee_id

    def test_repeat_cup_refused(self, db_session, group, who):
        f, cs = _adv_flight(db_session, group, who)
        e = dict(_cup(), coffee_id=cs[0].id)
        with pytest.raises(TastingValidationError, match="repeats"):
            frepo.log_tastings(f, [e, dict(e)], who)

    def test_empty_entries_refused(self, db_session, group, who):
        f, _ = _adv_flight(db_session, group, who)
        with pytest.raises(TastingValidationError, match="non-empty"):
            frepo.log_tastings(f, [], who)

    def test_basic_entry_on_advanced_flight_refused(self, db_session, group, who):
        f, cs = _adv_flight(db_session, group, who)
        with pytest.raises(TastingValidationError):
            frepo.log_tastings(f, [{"coffee_id": cs[0].id, "overall": 4}], who)

    def test_advanced_entry_on_basic_flight_refused(self, db_session, group, who):
        c = make_coffee(db_session, group)
        f = frepo.create_flight(group.id, {"coffee_ids": [c.id], "prep": "drip", "shared": True}, who)
        with pytest.raises(TastingValidationError):
            frepo.log_tastings(f, [dict(_cup(), coffee_id=c.id)], who)
        with pytest.raises(TastingValidationError, match="overall"):
            frepo.log_tastings(f, [{"coffee_id": c.id, "bar_vote": "yes"}], who)

    def test_coarse_step_refuses_tenths_fine_accepts(self, db_session, group, who):
        f, cs = _adv_flight(db_session, group, who)
        with pytest.raises(TastingValidationError, match="aroma"):
            frepo.log_tastings(f, [dict(_cup(aroma=8.3), coffee_id=cs[0].id)], who)
        f2, cs2 = _adv_flight(db_session, group, who, adv_step=0.1)
        rows = frepo.log_tastings(f2, [dict(_cup(aroma=8.3), coffee_id=cs2[0].id)], who)
        assert rows[0].adv_aroma == Decimal("8.3")


class TestGroupScoping:
    def test_coffee_from_another_group_is_not_found(self, db_session, group, who):
        other = make_group(db_session, "Elsewhere")
        theirs = make_coffee(db_session, other)
        with pytest.raises(frepo.CoffeeNotFound):
            frepo.create_flight(group.id, {"coffee_ids": [theirs.id], "prep": "drip", "shared": True}, who)

    def test_get_flight_is_group_scoped(self, db_session, group, who):
        other = make_group(db_session, "Elsewhere")
        f = make_flight(db_session, other, [make_coffee(db_session, other)])
        assert frepo.get_flight(group.id, f.id) is None
        assert frepo.get_flight(other.id, f.id).id == f.id


class TestHosting:
    def test_user_host_stamps_both_ids(self, db_session, group, who):
        f, _ = _adv_flight(db_session, group, who)
        assert (f.host_user_id, f.host_member_id, f.created_via) == (who.user_id, who.member_id, "account")

    def test_device_host_has_no_user(self, db_session, group, who):
        device_pick = TasterIdentity(user_id=who.user_id, member_id=who.member_id,
                                     taster_key=f"member:{who.member_id}", name="Alex", created_via="device")
        f, _ = _adv_flight(db_session, group, device_pick)
        assert (f.host_user_id, f.host_member_id, f.created_via) == (None, who.member_id, "device")
        # Host powers follow the member through every door, and the linked account.
        assert frepo.is_host(f, device_pick) and frepo.is_host(f, who)

    def test_is_host_never_for_paper_or_strangers(self, db_session, group, who):
        f, _ = _adv_flight(db_session, group, who)
        assert not frepo.is_host(f, TasterIdentity.paper(member_id=who.member_id, member_name="Alex"))
        assert not frepo.is_host(f, None)
        stranger = TasterIdentity(user_id=None, member_id=who.member_id + 1000,
                                  taster_key="member:x", name="S", created_via="device")
        assert not frepo.is_host(f, stranger)


class TestTimer:
    NOW = datetime.datetime(2026, 10, 21, 12, 0, 0)

    def test_start_sets_stamp_and_pass_zero_and_restarts(self, db_session, group, who):
        f, _ = _adv_flight(db_session, group, who)
        frepo.start_timer(f, now=self.NOW)
        assert f.timer_started_at == self.NOW and f.adv_pass == 0
        frepo.set_pass(f, 3)
        later = self.NOW + datetime.timedelta(minutes=9)
        frepo.start_timer(f, now=later)
        assert f.adv_pass == 0 and f.timer_started_at == later

    def test_closed_flight_raises(self, db_session, group, who):
        f, _ = _adv_flight(db_session, group, who)
        frepo.start_timer(f, now=self.NOW)
        f.is_open = False
        for call in (lambda: frepo.start_timer(f), lambda: frepo.set_pass(f, 1)):
            with pytest.raises(TastingStateError) as e:
                call()
            assert e.value.error == "flight_closed"

    def test_set_pass_absolute_idempotent_and_needs_timer(self, db_session, group, who):
        f, _ = _adv_flight(db_session, group, who)
        with pytest.raises(TastingStateError) as e:
            frepo.set_pass(f, 1)
        assert e.value.error == "timer_not_started"
        frepo.start_timer(f, now=self.NOW)
        assert frepo.set_pass(f, 2).adv_pass == 2
        assert frepo.set_pass(f, 2).adv_pass == 2

    @pytest.mark.parametrize("bad", [0, 4, True])
    def test_set_pass_out_of_range_raises(self, db_session, group, who, bad):
        f, _ = _adv_flight(db_session, group, who)
        frepo.start_timer(f, now=self.NOW)
        with pytest.raises(ValueError):
            frepo.set_pass(f, bad)

    def test_flight_dict_timer_elapsed_s(self, db_session, group, who):
        f, _ = _adv_flight(db_session, group, who)
        assert frepo.flight_dict(f, who)["timer_elapsed_s"] is None
        frepo.start_timer(f, now=self.NOW)
        now = self.NOW + datetime.timedelta(seconds=192.7)
        assert frepo.flight_dict(f, who, now=now)["timer_elapsed_s"] == 192
        assert frepo.flight_dict(f, who, now=self.NOW - datetime.timedelta(seconds=5))["timer_elapsed_s"] == 0


class TestLogPaper:
    def test_closed_flight_accepts_and_stamps_rows(self, db_session, group, who):
        f, cs = _adv_flight(db_session, group, who)
        f.is_open = False
        db_session.flush()
        (t,) = frepo.log_paper_tastings(f, [dict(_cup(), coffee_id=cs[0].id)],
                                        TasterIdentity.paper(guest_name="Sam"), entered_by=who.user_id)
        assert (t.created_via, t.user_id, t.entered_by_user_id, t.sheet) == \
            ("paper", None, who.user_id, "advanced")
        assert t.taster_key == "paper:name:sam" and t.taster_name == "Sam"

    def test_validates_like_live(self, db_session, group, who):
        f, cs = _adv_flight(db_session, group, who)
        sam = TasterIdentity.paper(guest_name="Sam")

        def go(entry):
            return frepo.log_paper_tastings(f, [entry], sam, entered_by=None)

        with pytest.raises(TastingValidationError):
            go({k: v for k, v in dict(_cup(), coffee_id=cs[0].id).items() if k != "bitterness"})
        with pytest.raises(TastingValidationError, match="aroma"):
            go(dict(_cup(aroma=8.25), coffee_id=cs[0].id))
        assert go(dict(_cup(aroma=7.0), coffee_id=cs[0].id))[0].adv_aroma == Decimal("7.0")

    def test_member_live_then_paper_and_paper_then_live(self, db_session, group, who):
        f, cs = _adv_flight(db_session, group, who)
        frepo.log_tastings(f, [dict(_cup(), coffee_id=cs[0].id)], who)
        db_session.refresh(f)
        with pytest.raises(TastingStateError) as exc:
            frepo.log_paper_tastings(f, [dict(_cup(), coffee_id=cs[1].id)],
                                     TasterIdentity.paper(member_id=who.member_id, member_name="Alex"),
                                     entered_by=None)
        assert exc.value.error == "already_logged" and "already has a read" in exc.value.message
        g, cs2 = _adv_flight(db_session, group, who)
        frepo.log_paper_tastings(g, [dict(_cup(), coffee_id=cs2[0].id)],
                                 TasterIdentity.paper(member_id=who.member_id, member_name="Alex"),
                                 entered_by=None)
        db_session.refresh(g)
        with pytest.raises(TastingStateError) as exc:
            frepo.log_tastings(g, [dict(_cup(), coffee_id=cs2[1].id)], who)
        assert exc.value.error == "already_logged"

    def test_same_guest_twice_409(self, db_session, group, who):
        f, cs = _adv_flight(db_session, group, who)
        frepo.log_paper_tastings(f, [dict(_cup(), coffee_id=cs[0].id)],
                                 TasterIdentity.paper(guest_name="Sam"), entered_by=None)
        db_session.refresh(f)
        with pytest.raises(TastingStateError):
            frepo.log_paper_tastings(f, [dict(_cup(), coffee_id=cs[1].id)],
                                     TasterIdentity.paper(guest_name="sam "), entered_by=None)

    def test_paper_read_stays_out_of_basic_aggregates(self, db_session, group, who):
        c = make_coffee(db_session, group)
        qf = make_flight(db_session, group, [c])
        for i, ov in enumerate((2, 4, 5)):
            make_tasting(db_session, qf, c, overall=ov, taster_key=f"user:q{i}")
        bf = make_flight(db_session, group, [c], sheet="advanced", adv_step=0.5, prep="cupping")
        db_session.commit()
        before = coffee_detail(c)["consensus"]
        frepo.log_paper_tastings(bf, [dict(_cup(), coffee_id=c.id)],
                                 TasterIdentity.paper(guest_name="Sam"), entered_by=None)
        db_session.commit()
        assert coffee_detail(c)["consensus"] == before and coffee_detail(c)["n"] == 3


class TestReveal:
    def test_reveal_is_basic_only_and_waits_for_close(self, db_session, group, who):
        c = make_coffee(db_session, group)
        now = utc_now()
        qf = make_flight(db_session, group, [c], is_shared=True, opened_at=now,
                         closes_at=now + datetime.timedelta(hours=24))
        for i, ov in enumerate((3, 4, 5)):
            make_tasting(db_session, qf, c, overall=ov, taster_key=f"user:q{i}")
        bf = make_flight(db_session, group, [c], sheet="advanced", adv_step=0.5, prep="cupping")
        for i in range(4):
            make_tasting(db_session, bf, c, adv=8.0, taster_key=f"user:b{i}")
        db_session.commit()
        with pytest.raises(TastingStateError) as e:
            frepo.reveal_flight(qf, who)
        assert e.value.error == "flight_open"
        qf.is_open = False
        cups = frepo.reveal_flight(qf, who)["cups"]
        assert cups[0]["n"] == 3 and cups[0]["consensus"]["n"] == 3
        bf.is_open = False
        with pytest.raises(TastingStateError) as e:
            frepo.reveal_flight(bf, who)
        assert e.value.error == "use_summary"

    def test_expire_if_due_closes_at_closes_at(self, db_session, group, who):
        c = make_coffee(db_session, group)
        f = make_flight(db_session, group, [c], is_shared=True)   # helper's window is long past
        assert frepo.expire_if_due(f) is True
        assert f.is_open is False and f.closed_at == f.closes_at


class TestPalate:
    def _row(self, db_session, group, me, mine, others):
        c = make_coffee(db_session, group)
        for ov in mine:
            f = make_flight(db_session, group, [c], is_open=False)
            make_tasting(db_session, f, c, overall=ov, user_id=me.user_id, member_id=me.member_id,
                         taster_key=f"user:{me.user_id}")
        for key, ov in others:
            f = make_flight(db_session, group, [c], is_open=False)
            make_tasting(db_session, f, c, overall=ov, taster_key=f"user:{key}")
        db_session.commit()
        return palate(group.id, me.user_id, [me.member_id], tz="UTC")["coffees_tasted"][0]

    def test_theirs_none_with_one_other_person(self, db_session, group, who):
        assert self._row(db_session, group, who, [4, 5], [("a", 2)])["theirs"] is None

    def test_theirs_none_with_one_person_two_reads(self, db_session, group, who):
        row = self._row(db_session, group, who, [4], [("a", 2), ("a", 4)])
        assert row["theirs"] is None and row["others_n"] == 2

    def test_theirs_is_mean_of_two_other_people(self, db_session, group, who):
        row = self._row(db_session, group, who, [4], [("a", 2), ("b", 3)])
        assert row["theirs"] == 2.5 and row["others_n"] == 2

    def test_palate_ignores_advanced(self, db_session, group, who):
        c = make_coffee(db_session, group)
        f = make_flight(db_session, group, [c], sheet="advanced", adv_step=0.5, prep="cupping")
        make_tasting(db_session, f, c, adv=8.0, user_id=who.user_id, taster_key=f"user:{who.user_id}")
        db_session.commit()
        assert palate(group.id, who.user_id, [who.member_id], tz="UTC")["tastings"] == 0

    def test_palate_includes_device_reads_after_link(self, db_session, group):
        """A roster member's device reads join their palate once an account is linked."""
        member = make_member(db_session, group, "Rowan")
        c = make_coffee(db_session, group)
        f = make_flight(db_session, group, [c], is_open=False)
        make_tasting(db_session, f, c, overall=5, member_id=member.id, taster_key=f"member:{member.id}",
                     created_via="device")
        db_session.commit()
        user = make_user(db_session)
        member.user_id = user.id
        db_session.commit()
        body = palate(group.id, user.id, [member.id], tz="UTC")
        assert body["tastings"] == 1 and body["coffees_tasted"][0]["yours"] == 5.0

    def test_open_flight_reads_stay_out_of_the_palate(self, db_session, group, who):
        """A read in an open (blind) flight would name the cup's coffee on the palate."""
        c = make_coffee(db_session, group)
        now = utc_now()
        f = make_flight(db_session, group, [c], is_shared=True, is_blind=True, opened_at=now,
                        closes_at=now + datetime.timedelta(hours=24))
        make_tasting(db_session, f, c, overall=5, user_id=who.user_id, member_id=who.member_id,
                     taster_key=f"user:{who.user_id}")
        db_session.commit()
        assert palate(group.id, who.user_id, [who.member_id], tz="UTC")["tastings"] == 0
        f.is_open = False
        db_session.commit()
        assert palate(group.id, who.user_id, [who.member_id], tz="UTC")["tastings"] == 1


def test_list_coffees_still_closed_only(db_session, group, who):
    """Logging into an open flight moves no coffee count (7a ruling, kept)."""
    c = make_coffee(db_session, group)
    f = frepo.create_flight(group.id, {"coffee_ids": [c.id], "prep": "drip", "shared": True}, who)
    frepo.log_tastings(f, [{"coffee_id": c.id, "overall": 5}], who)
    db_session.commit()
    assert next(r for r in list_coffees(group.id) if r["id"] == c.id)["n"] == 0
