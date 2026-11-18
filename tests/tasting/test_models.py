"""Tasting tables: round-trip, CHECKs, cascades, uniqueness, and the
model-vs-migration CHECK text pins."""
import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import CheckConstraint, text
from sqlalchemy.exc import IntegrityError

from extensions import db
from tasting.enums import ADV_CATEGORIES
from tests.tasting.helpers import (make_coffee, make_flight, make_group, make_member,
                                   make_tasting, make_user)

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def group(db_session):
    # Committed: tests below roll back after an expected IntegrityError, and a
    # merely flushed group would vanish with it (Postgres enforces the FK).
    group = make_group(db_session)
    db_session.commit()
    return group


def _require_fk_enforcement(db_session):
    if db.engine.dialect.name != "sqlite":
        return
    db_session.execute(text("PRAGMA foreign_keys=ON"))
    if not db_session.execute(text("PRAGMA foreign_keys")).scalar():
        pytest.skip("SQLite FK enforcement unavailable on this connection")


class TestRoundTrip:
    def test_coffee_defaults(self, db_session, group):
        from tasting.models import TastingCoffee
        c = make_coffee(db_session, group, name="Guji Shakiso")
        db_session.commit()
        fetched = db_session.get(TastingCoffee, c.id)
        assert fetched.notes == "" and fetched.archived_at is None and fetched.is_archived is False
        d = fetched.to_dict()
        assert d["name"] == "Guji Shakiso" and d["kind"] == "house"
        assert "stores" not in d and "store_ids" not in d

    def test_flight_with_pour_order_and_tastings(self, db_session, group):
        from tasting.models import TastingDefect, TastingFlight, TastingTag
        a, b = make_coffee(db_session, group, name="A"), make_coffee(db_session, group, name="B")
        f = make_flight(db_session, group, [b, a])
        t = make_tasting(db_session, f, b, acidity=3,
                         tags=[TastingTag(term="Fruity>Berry>blueberry", strength=3)],
                         defects=[TastingDefect(term="papery")])
        db_session.commit()
        fetched = db_session.get(TastingFlight, f.id)
        assert [(fc.coffee.name, fc.position) for fc in fetched.coffees] == [("B", 1), ("A", 2)]
        assert fetched.is_open is True and fetched.is_shared is False and fetched.is_blind is False
        assert fetched.is_open_link is False and fetched.created_via == "account"
        assert {tag.term: tag.strength for tag in t.tags} == {"Fruity>Berry>blueberry": 3}
        assert [d.term for d in t.defects] == ["papery"]
        assert t.vals() == {"acidity": 3, "sweetness": None, "body": None, "balance": None, "overall": 4}

    def test_identity_columns_link_to_members_and_users(self, db_session, group):
        member, user = make_member(db_session, group), make_user(db_session)
        c = make_coffee(db_session, group, created_by=user.id)
        f = make_flight(db_session, group, [c], host_member_id=member.id, host_user_id=user.id)
        t = make_tasting(db_session, f, c, member_id=member.id, user_id=user.id,
                         entered_by_user_id=user.id, taster_key=f"member:{member.id}")
        db_session.commit()
        assert (c.created_by, f.host_member_id, f.host_user_id) == (user.id, member.id, user.id)
        assert (t.member_id, t.user_id) == (member.id, user.id)


class TestChecks:
    @pytest.mark.parametrize("field,value", [
        ("kind", "blend"), ("process", "steamed"), ("roast_level", "burnt"),
    ])
    def test_coffee_enum_checks(self, db_session, group, field, value):
        with pytest.raises(IntegrityError):
            make_coffee(db_session, group, **{field: value})
        db_session.rollback()

    def test_group_required_on_coffee_and_flight(self, db_session, group):
        from tasting.models import TastingCoffee
        db_session.add(TastingCoffee(name="x", kind="house"))
        with pytest.raises(IntegrityError):
            db_session.flush()
        db_session.rollback()

    def test_flight_prep_and_via_checks(self, db_session, group):
        c = make_coffee(db_session, group)
        with pytest.raises(IntegrityError):
            make_flight(db_session, group, [c], prep="aeropress")
        db_session.rollback()
        c = make_coffee(db_session, group)
        with pytest.raises(IntegrityError):
            make_flight(db_session, group, [c], created_via="guest")
        db_session.rollback()

    @pytest.mark.parametrize("field,value", [
        ("overall", 0), ("overall", 6), ("acidity", 0), ("sweetness", 6), ("body", 7), ("balance", -1),
    ])
    def test_scale_checks_are_one_to_five(self, db_session, group, field, value):
        c = make_coffee(db_session, group)
        f = make_flight(db_session, group, [c])
        with pytest.raises(IntegrityError):
            make_tasting(db_session, f, c, **{field: value})
        db_session.rollback()

    def test_overall_required(self, db_session, group):
        c = make_coffee(db_session, group)
        f = make_flight(db_session, group, [c])
        with pytest.raises(IntegrityError):
            make_tasting(db_session, f, c, overall=None)
        db_session.rollback()

    def test_tag_strength_check(self, db_session, group):
        from tasting.models import TastingTag
        c = make_coffee(db_session, group)
        f = make_flight(db_session, group, [c])
        with pytest.raises(IntegrityError):
            make_tasting(db_session, f, c, tags=[TastingTag(term="Fruity", strength=1)])
        db_session.rollback()

    def test_one_read_per_taster_per_cup(self, db_session, group):
        c = make_coffee(db_session, group)
        f = make_flight(db_session, group, [c])
        make_tasting(db_session, f, c, taster_key="user:1")
        with pytest.raises(IntegrityError):
            make_tasting(db_session, f, c, taster_key="user:1", overall=2)
        db_session.rollback()

    def test_pour_position_unique_within_flight(self, db_session, group):
        from tasting.models import TastingFlightCoffee
        a, b = make_coffee(db_session, group), make_coffee(db_session, group)
        f = make_flight(db_session, group, [a])
        f.coffees.append(TastingFlightCoffee(coffee_id=b.id, position=1))
        with pytest.raises(IntegrityError):
            db_session.flush()
        db_session.rollback()


class TestCascades:
    def test_deleting_a_flight_removes_slots_tastings_tags_defects(self, db_session, group):
        from tasting.models import (Tasting, TastingDefect, TastingFlight, TastingFlightCoffee,
                                    TastingTag)
        c = make_coffee(db_session, group)
        f = make_flight(db_session, group, [c])
        make_tasting(db_session, f, c, tags=[TastingTag(term="Fruity", strength=2)],
                     defects=[TastingDefect(term="musty")])
        db_session.commit()
        db_session.delete(db_session.get(TastingFlight, f.id))
        db_session.commit()
        assert db_session.query(TastingFlightCoffee).count() == 0
        assert db_session.query(Tasting).count() == 0
        assert db_session.query(TastingTag).count() == 0
        assert db_session.query(TastingDefect).count() == 0

    def test_deleting_a_coffee_with_history_is_refused_at_the_db(self, db_session, group):
        """RESTRICT, not CASCADE: archive is the path; history must survive."""
        _require_fk_enforcement(db_session)
        c = make_coffee(db_session, group)
        f = make_flight(db_session, group, [c])
        make_tasting(db_session, f, c)
        db_session.commit()
        with pytest.raises(IntegrityError):
            db_session.execute(text("DELETE FROM tasting_coffees WHERE id = :id"), {"id": c.id})
        db_session.rollback()


class TestIdentityUniqueness:
    def test_member_and_user_unique_indexes(self, db_session, group):
        """One person, two doors: a second read for the same member (or user)
        on the same cup is refused even under a different taster_key."""
        member, user = make_member(db_session, group), make_user(db_session)
        db_session.commit()   # the rollback below must not take them with it
        c = make_coffee(db_session, group)
        f = make_flight(db_session, group, [c])
        make_tasting(db_session, f, c, member_id=member.id, taster_key=f"member:{member.id}")
        with pytest.raises(IntegrityError):
            make_tasting(db_session, f, c, member_id=member.id, taster_key=f"user:x{member.id}")
        db_session.rollback()

        c = make_coffee(db_session, group)
        f = make_flight(db_session, group, [c])
        make_tasting(db_session, f, c, user_id=user.id, taster_key=f"user:{user.id}")
        with pytest.raises(IntegrityError):
            make_tasting(db_session, f, c, user_id=user.id, taster_key="member:other")
        db_session.rollback()

    def test_tasters_without_member_or_user_are_keyed_by_taster_key(self, db_session, group):
        c = make_coffee(db_session, group)
        f = make_flight(db_session, group, [c])
        make_tasting(db_session, f, c, taster_key="paper:name:Ana")
        make_tasting(db_session, f, c, taster_key="paper:name:Ben")
        db_session.commit()

    def test_same_member_may_read_other_cups_and_flights(self, db_session, group):
        member = make_member(db_session, group)
        a, b = make_coffee(db_session, group), make_coffee(db_session, group)
        f1, f2 = make_flight(db_session, group, [a, b]), make_flight(db_session, group, [a])
        for flight, coffee in ((f1, a), (f1, b), (f2, a)):
            make_tasting(db_session, flight, coffee, member_id=member.id,
                         taster_key=f"member:{member.id}")
        db_session.commit()


class TestAdvancedSheet:
    """An advanced read carries ten 7.0/7.5-10 scores and a bar vote and no
    `overall`; a basic read carries `overall` and no advanced fields."""

    @staticmethod
    def _adv(**over):
        kw = {f"adv_{c}": 8.5 for c in ADV_CATEGORIES}
        kw.update(sheet="advanced", overall=None, bar_vote="yes")
        kw.update(over)
        return kw

    def test_advanced_read_shape(self, db_session, group):
        c = make_coffee(db_session, group)
        f = make_flight(db_session, group, [c], sheet="advanced", adv_step=0.5)
        t = make_tasting(db_session, f, c, **self._adv())
        db_session.commit()
        assert t.sheet == "advanced" and t.overall is None
        for over in ({"adv_aroma": None}, {"overall": 4}, {"bar_vote": None}):
            c2 = make_coffee(db_session, group)
            f2 = make_flight(db_session, group, [c2], sheet="advanced", adv_step=0.5)
            with pytest.raises(IntegrityError):
                make_tasting(db_session, f2, c2, **self._adv(**over))
            db_session.rollback()

    def test_basic_read_rejects_advanced_fields(self, db_session, group):
        c = make_coffee(db_session, group)
        f = make_flight(db_session, group, [c])
        with pytest.raises(IntegrityError):
            make_tasting(db_session, f, c, sheet="basic", overall=4, adv_aroma=8.0)
        db_session.rollback()

    def test_basic_is_the_default_sheet(self, db_session, group):
        c = make_coffee(db_session, group)
        f = make_flight(db_session, group, [c])
        t = make_tasting(db_session, f, c)
        db_session.commit()
        assert t.sheet == "basic" and f.sheet == "basic" and f.adv_step is None

    @pytest.mark.parametrize("value,ok", [(7.0, True), (10, True), (7.5, True), (7.2, False), (10.5, False)])
    def test_advanced_score_domain(self, db_session, group, value, ok):
        c = make_coffee(db_session, group)
        f = make_flight(db_session, group, [c], sheet="advanced", adv_step=0.1)
        if ok:
            make_tasting(db_session, f, c, **self._adv(adv_balance=value))
            db_session.commit()
        else:
            with pytest.raises(IntegrityError):
                make_tasting(db_session, f, c, **self._adv(adv_balance=value))
            db_session.rollback()

    def test_bar_vote_domain(self, db_session, group):
        c = make_coffee(db_session, group)
        f = make_flight(db_session, group, [c], sheet="advanced", adv_step=0.5)
        with pytest.raises(IntegrityError):
            make_tasting(db_session, f, c, **self._adv(bar_vote="sure"))
        db_session.rollback()

    @pytest.mark.parametrize("sheet,step", [("advanced", None), ("basic", 0.5), ("advanced", 0.25), ("pro", None)])
    def test_flight_adv_step_shape(self, db_session, group, sheet, step):
        c = make_coffee(db_session, group)
        with pytest.raises(IntegrityError):
            make_flight(db_session, group, [c], sheet=sheet, adv_step=step)
        db_session.rollback()

    @pytest.mark.parametrize("adv_pass", [-1, 4])
    def test_flight_adv_pass_domain(self, db_session, group, adv_pass):
        c = make_coffee(db_session, group)
        with pytest.raises(IntegrityError):
            make_flight(db_session, group, [c], sheet="advanced", adv_step=0.5, adv_pass=adv_pass)
        db_session.rollback()

    def test_paper_is_an_accepted_door(self, db_session, group):
        user = make_user(db_session)
        c = make_coffee(db_session, group)
        f = make_flight(db_session, group, [c], created_via="paper")
        make_tasting(db_session, f, c, created_via="paper", entered_by_user_id=user.id,
                     taster_key="paper:name:Ana")
        db_session.commit()

    def test_total_and_dq(self, db_session, group):
        c = make_coffee(db_session, group)
        f = make_flight(db_session, group, [c], sheet="advanced", adv_step=0.5)
        t = make_tasting(db_session, f, c, **self._adv())
        db_session.commit()
        db_session.refresh(t)
        scores = t.adv_scores()
        assert list(scores) == list(ADV_CATEGORIES)
        assert all(isinstance(v, float) for v in scores.values())
        assert t.adv_total() == 85.0
        assert t.adv_dq_categories() == []
        t.adv_acidity = 7.0
        db_session.commit()
        db_session.refresh(t)
        assert t.adv_dq_categories() == ["acidity"]
        assert t.adv_total() == 83.5

    def test_basic_read_has_no_advanced_total(self, db_session, group):
        c = make_coffee(db_session, group)
        f = make_flight(db_session, group, [c])
        t = make_tasting(db_session, f, c)
        db_session.commit()
        assert t.adv_total() is None
        assert t.adv_dq_categories() == []
        assert set(t.adv_scores().values()) == {None}


class TestNaming:
    def test_no_bh_identifiers(self):
        """No table, column, index or constraint name may carry the old sheet's initials."""
        names = []
        for table in db.metadata.tables.values():
            names.append(table.name)
            names += [c.name for c in table.columns]
            names += [i.name for i in table.indexes if i.name]
            names += [c.name for c in table.constraints if c.name]
        assert names
        assert [n for n in names if "bh" in n.lower()] == []

    def test_sheet_values_are_basic_and_advanced(self):
        from tasting.enums import SHEETS
        assert SHEETS == ("basic", "advanced")


class TestMigrationPins:
    """The migration carries literal CHECK text; the model builds its own from the
    enum tuples. Pin them so editing one without the other fails here."""

    @staticmethod
    def _migration(name="0002_tasting"):
        path = ROOT / "migrations" / "versions" / f"{name}.py"
        spec = importlib.util.spec_from_file_location(f"mig{name[:4]}", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    @staticmethod
    def _checks():
        out = {}
        for table in db.metadata.tables.values():
            if table.name.startswith("tast"):
                for c in table.constraints:
                    if isinstance(c, CheckConstraint):
                        out[c.name] = str(c.sqltext)
        return out

    def test_revision_chain(self):
        m = self._migration()
        assert m.revision == "0002" and m.down_revision == "0001"

    def test_check_texts_match(self):
        m = self._migration()
        assert self._checks() == m.CHECKS

    def test_categories_match_enums(self):
        assert self._migration().ADV_CATEGORIES == ADV_CATEGORIES

    def test_indexes_match(self):
        m = self._migration()
        model = {}
        for table in db.metadata.tables.values():
            if table.name.startswith("tast"):
                for i in table.indexes:
                    pg = i.dialect_options["postgresql"]["where"]
                    lite = i.dialect_options["sqlite"]["where"]
                    assert (None if pg is None else str(pg)) == (None if lite is None else str(lite))
                    model[i.name] = (table.name, tuple(c.name for c in i.columns), bool(i.unique),
                                     None if pg is None else str(pg))
        later = self._migration("0004_flight_host_member_index")
        assert later.down_revision == "0003"
        assert model == {**m.INDEXES, **later.INDEXES}
