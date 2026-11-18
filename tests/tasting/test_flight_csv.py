"""Flight CSV upload plan: grouping, coffee matching, labels, warnings, hash, apply."""
import csv
import datetime
import io
import json
import random
import unicodedata

import pytest

from extensions import db
from tasting import flights_repository as frepo
from tasting.flight_csv import MAX_CUPS, apply_plan, build_plan
from tasting.models import TastingCoffee, TastingFlight
from tasting.repository import TasterIdentity
from tests.tasting.helpers import make_coffee, make_flight, make_group, make_member, make_user

HEADER = ["flight", "prep", "position", "blind_label", "roaster", "name"]


@pytest.fixture
def group(db_session):
    return make_group(db_session)


def _csv(header, *rows):
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(header)
    for r in rows:
        w.writerow(r)
    return out.getvalue()


def _row(flight="F1", prep="cupping", position="1", label="", roaster="Roastery", name="Guji"):
    return [flight, prep, position, label, roaster, name]


@pytest.fixture
def plan_of(group):
    def build(*rows, header=HEADER):
        return build_plan(_csv(header, *rows), group.id)
    return build


@pytest.fixture
def dplan(group):
    def build(columns, *rows):
        return build_plan(_csv(columns, *[[r.get(c, "") for c in columns] for r in rows]), group.id)
    return build


@pytest.fixture
def guji(db_session, group):
    return make_coffee(db_session, group, name="Guji", roaster="Roastery")


def _coffee(db_session, group, name, roaster="R", **kw):
    return make_coffee(db_session, group, name=name, roaster=roaster, **kw)


class TestBuildPlan:
    def test_groups_rows_into_flights(self, db_session, group, plan_of):
        a, b = _coffee(db_session, group, "A"), _coffee(db_session, group, "B")
        plan = plan_of(_row("One", "cupping", "1", name="A", roaster="R"),
                       _row("Two", "espresso", "1", name="B", roaster="R"),
                       _row("One", "cupping", "2", name="B", roaster="R"))
        assert not plan.has_errors
        assert [(f.name, f.prep, f.sheet, f.cup_count) for f in plan.flights] == [
            ("One", "cupping", "advanced", 2), ("Two", "espresso", "basic", 1)]
        assert [c[1] for c in plan._cups["One"]] == [a.id, b.id]

    @pytest.mark.parametrize("missing", ["flight", "prep", "name"])
    def test_missing_required_column_is_file_error(self, guji, plan_of, missing):
        header = [h for h in HEADER if h != missing]
        row = [c for h, c in zip(HEADER, _row()) if h != missing]
        plan = plan_of(row, header=header)
        assert plan.file_errors == [f"The file has no '{missing}' column"]
        assert plan.file_blocked and plan.flights == []

    def test_bom_header_reads(self, group, guji):
        plan = build_plan("﻿" + _csv(HEADER, _row()), group.id)
        assert plan.file_errors == [] and not plan.has_errors

    def test_matches_case_insensitive_stripped_nfc(self, db_session, group, plan_of):
        decomposed = " Peñas blancas "
        assert not unicodedata.is_normalized("NFC", decomposed)
        c = make_coffee(db_session, group, name="Peñas Blancas", roaster="Broadsheet")
        plan = plan_of(_row(name=decomposed, roaster="BROADSHEET"))
        assert not plan.has_errors and plan._cups["F1"] == [(1, c.id, None, None)]

    def test_unknown_coffee_row_error(self, guji, plan_of):
        (e,) = plan_of(_row(roaster="Nope", name="Nada")).row_errors
        assert e.column == "name" and e.row == 2 and e.flight == "F1"
        assert "Nope" in e.message and "Nada" in e.message

    def test_another_groups_coffee_is_unknown(self, db_session, group, plan_of, dplan):
        other = make_group(db_session, "Elsewhere")
        theirs = make_coffee(db_session, other, name="Guji", roaster="Roastery")
        assert plan_of(_row()).row_errors[0].message.startswith("No coffee named")
        plan = dplan(["id", "flight", "prep", "name"], {"id": str(theirs.id), "flight": "F1",
                                                         "prep": "cupping", "name": "Guji"})
        assert plan.row_errors[0].message == f"No coffee with id {theirs.id}"

    def test_archived_and_ambiguous(self, db_session, group, plan_of):
        _coffee(db_session, group, "Guji", "Roastery", archived_at=datetime.datetime(2026, 10, 1))
        assert "archived" in plan_of(_row()).row_errors[0].message
        _coffee(db_session, group, "Guji", "Roastery")
        assert not plan_of(_row()).has_errors          # an archived twin is no ambiguity
        _coffee(db_session, group, "guji", "roastery")
        assert "rename or archive" in plan_of(_row()).row_errors[0].message

    def test_same_coffee_twice_in_flight_row_error(self, guji, plan_of):
        (e,) = plan_of(_row(position="1"), _row(position="2")).row_errors
        assert e.row == 3 and e.column == "name"
        assert not plan_of(_row("A"), _row("B")).has_errors

    @pytest.mark.parametrize("bad", ["0", "-1", "1.0", "abc", "²"])
    def test_position_errors(self, guji, plan_of, bad):
        (e,) = plan_of(_row(position=bad)).row_errors
        assert e.column == "position"

    def test_positions_blank_mixed_duplicate_and_gaps(self, db_session, group, plan_of):
        a, b, c = (_coffee(db_session, group, n) for n in "ABC")
        plan = plan_of(*[_row(position="", name=n, roaster="R") for n in "BCA"])
        assert [(p, cid) for p, cid, _, _ in plan._cups["F1"]] == [(1, b.id), (2, c.id), (3, a.id)]
        mixed = plan_of(_row(position="1", name="A", roaster="R"), _row(position="", name="B", roaster="R"))
        assert [(e.row, e.column) for e in mixed.row_errors] == [(3, "position")]
        dup = plan_of(_row(position="1", name="A", roaster="R"), _row(position="1", name="B", roaster="R"))
        assert [(e.row, e.column) for e in dup.row_errors] == [(3, "position")]
        gaps = plan_of(_row(position="5", name="A", roaster="R"), _row(position="2", name="B", roaster="R"))
        assert not gaps.has_errors and [c[0] for c in gaps._cups["F1"]] == [2, 5]

    def test_prep_unknown_and_mixed_are_row_errors(self, db_session, group, plan_of):
        _coffee(db_session, group, "A")
        _coffee(db_session, group, "B")
        (e,) = plan_of(_row(prep="latte", name="A", roaster="R")).row_errors
        assert e.column == "prep"
        mixed = plan_of(_row(prep="cupping", position="1", name="A", roaster="R"),
                        _row(prep="espresso", position="2", name="B", roaster="R"))
        assert [(e.row, e.column) for e in mixed.row_errors] == [(3, "prep")]

    def test_labels(self, db_session, group, guji, plan_of):
        assert plan_of(_row()).flights[0].custom_labels is False
        a, b = _coffee(db_session, group, "A"), _coffee(db_session, group, "B")
        plan = plan_of(_row(position="1", label="h1", name="A", roaster="R"),
                       _row(position="2", label="H2", name="B", roaster="R"))
        assert plan.flights[0].custom_labels is True
        assert plan._cups["F1"] == [(1, a.id, "h1", None), (2, b.id, "H2", None)]
        partial = plan_of(_row("X", position="1", label="H1", name="A", roaster="R"),
                          _row("X", position="2", label="", name="B", roaster="R"))
        assert [(e.row, e.column) for e in partial.row_errors] == [(3, "blind_label")]
        dup = plan_of(_row("X", position="1", label="H1", name="A", roaster="R"),
                      _row("X", position="2", label="h1", name="B", roaster="R"))
        assert [(e.row, e.column) for e in dup.row_errors] == [(3, "blind_label")]

    @pytest.mark.parametrize("bad", ["Cup H1", "H-1", "H 1", "ABCDE", "é1"])
    def test_label_format_errors(self, guji, plan_of, bad):
        assert plan_of(_row(label=bad)).row_errors[0].column == "blind_label"

    @pytest.mark.parametrize("n,errors", [(26, False), (27, True)])
    def test_flight_over_26_cups_row_error(self, db_session, group, plan_of, n, errors):
        rows = []
        for i in range(n):
            _coffee(db_session, group, f"C{i}")
            rows.append(_row(position=str(i + 1), name=f"C{i}", roaster="R"))
        plan = plan_of(*rows)
        assert MAX_CUPS == 26 and plan.has_errors is errors
        if errors:
            assert [e.row for e in plan.row_errors] == [28]

    def test_flight_name_limit_and_header_case(self, guji, plan_of):
        assert plan_of(_row("x" * 255)).has_errors is False
        assert plan_of(_row("x" * 256)).row_errors[0].column == "flight"
        header = ["Flight", "PREP", "Position", "Blind_Label", "Roaster", "Name"]
        plan = plan_of(_row(label="H1"), header=header)
        assert plan.file_errors == [] and plan.flights[0].custom_labels

    def test_existing_name_warns_any_status_in_this_group_only(self, db_session, group, guji, plan_of):
        make_flight(db_session, group, [guji], name="F1", is_open=True)
        make_flight(db_session, group, [guji], name="F1", is_open=False)
        other = make_group(db_session, "Elsewhere")
        make_flight(db_session, other, [make_coffee(db_session, other)], name="F1")
        plan = plan_of(_row("F1"))
        assert plan.flights[0].existing_count == 2
        assert len(plan.warnings) == 1 and "F1" in plan.warnings[0].message

    def test_ids(self, db_session, group, dplan):
        _coffee(db_session, group, "Guji", "Roastery")
        second = _coffee(db_session, group, "Guji", "Roastery")
        plan = dplan(["id", "flight", "prep", "name", "roaster"],
                     {"id": str(second.id), "flight": "F1", "prep": "cupping", "name": "Other"})
        assert not plan.has_errors and plan._cups["F1"][0][1] == second.id
        for bad in ("999999", "abc", "99999999999999999999"):
            (e,) = dplan(["id", "flight", "prep", "name"],
                         {"id": bad, "flight": "F1", "prep": "cupping", "name": "Guji"}).row_errors
            assert e.column == "id"
        old = _coffee(db_session, group, "Old", archived_at=datetime.datetime(2026, 10, 1))
        (e,) = dplan(["id", "flight", "prep", "name"],
                     {"id": str(old.id), "flight": "F1", "prep": "cupping", "name": "Old"}).row_errors
        assert e.message == f"Coffee {old.id} is archived"

    def test_coffee_export_builds_a_flight(self, db_session, group):
        from tasting import coffee_csv
        _coffee(db_session, group, "=SUM(A1)", "@Roaster", origin="Peru")
        _coffee(db_session, group, "Plain", "Roastery")
        rows = list(csv.reader(io.StringIO(coffee_csv.export_csv(group.id))))
        for blank_ids in (False, True):
            body = [r + ["Table 1", "cupping"] for r in rows[1:]]
            if blank_ids:
                for r in body:
                    r[0] = ""
            plan = build_plan(_csv([*rows[0], "flight", "prep"], *body), group.id)
            assert not plan.has_errors, plan.row_errors
            assert [(f.name, f.cup_count, f.new_coffee_count) for f in plan.flights] == [("Table 1", 2, 0)]

    def test_new_coffees(self, db_session, group, guji, dplan):
        plan = dplan(["flight", "prep", "name", "roaster", "kind", "origin", "process"],
                     {"flight": "F1", "prep": "cupping", "name": "Fresh", "roaster": "Newco",
                      "kind": "cupping_lot", "origin": "Kenya", "process": "washed"})
        assert not plan.has_errors and plan.flights[0].new_coffee_count == 1
        (_, cid, _, new) = plan._cups["F1"][0]
        assert cid is None and new["name"] == "Fresh" and new["origin"] == "Kenya"
        no_kind = dplan(["flight", "prep", "name"], {"flight": "F1", "prep": "cupping", "name": "Fresh"})
        assert "No coffee named" in no_kind.row_errors[0].message
        blank_kind = dplan(["flight", "prep", "name", "kind"],
                           {"flight": "F1", "prep": "cupping", "name": "Fresh"})
        assert blank_kind.row_errors[0].column == "kind"
        matched = dplan(["flight", "prep", "name", "roaster", "kind", "process"],
                        {"flight": "F1", "prep": "cupping", "name": "Guji", "roaster": "Roastery",
                         "kind": "nonsense", "process": "wet-hulled"})
        assert not matched.has_errors and matched._cups["F1"][0] == (1, guji.id, None, None)

    def test_blank_flights_warn_once_and_scoped_errors(self, guji, plan_of):
        plan = plan_of(_row(), _row(flight="", name="x"), _row(flight=" ", name="y"))
        (w,) = plan.warnings
        assert "2 rows" in w.message and w.row is None
        assert plan_of(_row(flight="")).file_blocked
        scoped = plan_of(_row("Bad", roaster="Nope", name="Nada"), _row("Good"))
        assert scoped.flight_has_errors("Bad") and not scoped.flight_has_errors("Good")
        assert not scoped.file_blocked

    def test_hash_changes_with_inputs_and_is_stable(self, db_session, group, plan_of):
        _coffee(db_session, group, "A")
        b = _coffee(db_session, group, "B")
        base = plan_of(_row(name="A", roaster="R")).plan_hash
        assert plan_of(_row(name="A", roaster="R")).plan_hash == base
        assert plan_of(_row(name="B", roaster="R")).plan_hash != base
        assert plan_of(_row(name="A", roaster="R", position="2")).plan_hash != base
        assert plan_of(_row(name="A", roaster="R", label="H1")).plan_hash != base
        make_flight(db_session, group, [b], name="F1")
        assert plan_of(_row(name="A", roaster="R")).plan_hash != base

    def test_json_has_no_cup_data(self, db_session, group, plan_of, dplan):
        _coffee(db_session, group, "Secret Bean", "Hidden Roasters")
        text = json.dumps(plan_of(_row(label="ZQ9", name="Secret Bean", roaster="Hidden Roasters")).to_json())
        for banned in ("Secret Bean", "Hidden", "ZQ9", "coffee_id", "_cups"):
            assert banned not in text
        fresh = dplan(["flight", "prep", "name", "roaster", "kind", "origin", "blind_label"],
                      {"flight": "F1", "prep": "cupping", "name": "Zebra Lot", "roaster": "Quagga Co",
                       "kind": "cupping_lot", "origin": "Narnia", "blind_label": "ZQ9"}).to_json()
        assert not any(w in json.dumps(fresh) for w in ("Zebra", "Quagga", "Narnia", "ZQ9", "cupping_lot"))
        assert fresh["flights"][0]["new_coffee_count"] == 1


@pytest.fixture
def who(db_session, group):
    user = make_user(db_session)
    member = make_member(db_session, group, "Alex", user_id=user.id)
    return TasterIdentity(user_id=user.id, member_id=member.id, taster_key=f"user:{user.id}",
                          name="Alex", created_via="account")


def _ids(flight):
    return [fc.coffee_id for fc in sorted(flight.coffees, key=lambda fc: fc.position)]


class Reverser:
    def shuffle(self, x):
        x.reverse()


class TestApplyPlan:
    def _three(self, db_session, group):
        return [_coffee(db_session, group, n) for n in "ABC"]

    def test_creates_shared_blind_48h_flight_in_the_group(self, db_session, group, plan_of, who):
        cs = self._three(db_session, group)
        plan = plan_of(*[_row("F1", "cupping", str(i), name=c.name, roaster="R") for i, c in enumerate(cs, 1)])
        [f] = apply_plan(plan, group.id, ["F1"], who, shuffle=False)
        assert f.is_shared and f.is_blind and f.is_open and f.group_id == group.id
        assert f.closes_at - f.opened_at == datetime.timedelta(hours=48)
        assert [fc.blind_label for fc in sorted(f.coffees, key=lambda x: x.position)] == ["A", "B", "C"]
        assert (f.host_user_id, f.host_member_id) == (who.user_id, who.member_id)
        assert f.sheet == "advanced" and float(f.adv_step) == 0.5

    def test_shuffle_uses_rng_and_labels_skip_it(self, db_session, group, plan_of, who):
        cs = self._three(db_session, group)
        plan = plan_of(*[_row("F1", "cupping", str(i), name=c.name, roaster="R") for i, c in enumerate(cs, 1)])
        expected = [c.id for c in cs]
        random.Random(1).shuffle(expected)
        [f] = apply_plan(plan, group.id, ["F1"], who, shuffle=True, rng=random.Random(1))
        assert _ids(f) == expected
        labelled = plan_of(*[_row("L", position=str(i), label=f"H{i}", name=n, roaster="R")
                             for i, n in enumerate("ABC", 1)])
        [g] = apply_plan(labelled, group.id, ["L"], who, shuffle=True, rng=Reverser())
        assert _ids(g) == [c.id for c in cs]
        assert {k["coffee_id"]: k["label"] for k in frepo.label_key(g)}[cs[0].id] == "Cup H1"

    def test_create_flight_blind_labels_keyword(self, db_session, group, who):
        cs = self._three(db_session, group)
        data = {"coffee_ids": [c.id for c in cs], "prep": "drip", "shared": True, "blind": True}
        f = frepo.create_flight(group.id, data, who, blind_labels=["X1", "X2", "X3"])
        assert [fc.blind_label for fc in sorted(f.coffees, key=lambda x: x.position)] == ["X1", "X2", "X3"]
        with pytest.raises(ValueError):
            frepo.create_flight(group.id, data, who, blind_labels=["X1"])
        with pytest.raises(ValueError):
            frepo.create_flight(group.id, {**data, "blind": False}, who, blind_labels=["X1", "X2", "X3"])
        typed = frepo.create_flight(group.id, {**data, "blind": False}, who)
        assert typed.closes_at - typed.opened_at == datetime.timedelta(hours=24)

    def test_only_ticked_flights_and_their_coffees(self, db_session, group, dplan, who):
        cols = ["flight", "prep", "roaster", "name", "kind", "origin"]
        new = {"prep": "cupping", "roaster": "Fresh Co", "kind": "house"}
        plan = dplan(cols, {"flight": "One", "name": "Alpha", **new}, {"flight": "Two", "name": "Beta", **new})
        [f] = apply_plan(plan, group.id, ["Two"], who, created_by=who.user_id, shuffle=False)
        (c,) = TastingCoffee.query.all()
        assert c.name == "Beta" and c.group_id == group.id and c.created_by == who.user_id
        assert _ids(f) == [c.id] and TastingFlight.query.count() == 1

    def test_coffee_in_two_ticked_flights_created_once(self, db_session, group, dplan, who):
        cols = ["flight", "prep", "roaster", "name", "kind", "origin"]
        new = {"prep": "cupping", "roaster": "Fresh Co", "kind": "house"}
        plan = dplan(cols, {"flight": "One", "name": "Alpha", "origin": "First", **new},
                     {"flight": "Two", "name": "  ALPHA ", "origin": "Second", **new})
        made = apply_plan(plan, group.id, ["One", "Two"], who, shuffle=False)
        c = TastingCoffee.query.one()
        assert c.origin == "First" and _ids(made[0]) == _ids(made[1]) == [c.id]

    def test_refuses_errors_in_ticked_flights_only(self, db_session, group, plan_of, who):
        _coffee(db_session, group, "A")
        plan = plan_of(_row("Good", name="A", roaster="R"), _row("Bad", name="Nope", roaster="R"))
        with pytest.raises(ValueError):
            apply_plan(plan, group.id, ["Good", "Bad"], who)
        assert TastingFlight.query.count() == 0
        assert [f.name for f in apply_plan(plan, group.id, ["Good"], who, shuffle=False)] == ["Good"]
        db.session.rollback()
