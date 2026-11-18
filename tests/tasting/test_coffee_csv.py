"""Coffee CSV export / import: the round trip, the dry-run plan, the apply."""
import csv
import datetime
import io

import pytest

from tasting.coffee_csv import COLUMNS, export_csv
from tests.tasting import helpers


@pytest.fixture
def group(db_session):
    return helpers.make_group(db_session)


@pytest.fixture
def make_coffee(db_session, group):
    def build(name=None, roaster="Roaster", kind="house", **kw):
        return helpers.make_coffee(db_session, group, name=name, roaster=roaster, kind=kind, **kw)
    return build


def _rows(text):
    return list(csv.DictReader(io.StringIO(text)))


class TestExport:
    def test_export_header_is_columns_in_order(self, db_session, group, make_coffee):
        make_coffee(name="Guji")
        assert export_csv(group.id).splitlines()[0] == ",".join(COLUMNS)

    def test_export_row_values(self, db_session, group, make_coffee):
        c = make_coffee(name="Guji", roaster="Onyx", kind="house", process="washed",
                        archived_at=datetime.datetime(2026, 10, 1))
        row = _rows(export_csv(group.id))[0]
        assert row["id"] == str(c.id)
        assert row["name"] == "Guji"
        assert row["roaster"] == "Onyx"
        assert row["kind"] == "house"
        assert row["process"] == "washed"
        assert "stores" not in row
        assert row["archived"] == "yes"
        assert row["origin"] == "" and row["roast_level"] == "" and row["notes"] == ""

    def test_export_includes_archived_and_orders_by_id(self, db_session, group, make_coffee):
        a = make_coffee(name="B")
        b = make_coffee(name="A", archived_at=datetime.datetime(2026, 10, 1))
        rows = _rows(export_csv(group.id))
        assert [r["id"] for r in rows] == [str(a.id), str(b.id)]
        assert [r["archived"] for r in rows] == ["no", "yes"]

    def test_export_escapes_formula_cells(self, db_session, group, make_coffee):
        make_coffee(name="Guji", notes="=HYPERLINK(1)")
        assert _rows(export_csv(group.id))[0]["notes"] == "'=HYPERLINK(1)"


# ---------------------------------------------------------------------------
# build_plan
# ---------------------------------------------------------------------------

from tasting.coffee_csv import build_plan  # noqa: E402


ctx = {}


@pytest.fixture(autouse=True)
def _bind_group(group):
    ctx["gid"] = group.id


def _csv(header, *rows):
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(header)
    for r in rows:
        w.writerow(r)
    return out.getvalue()


def _export_rows():
    rows = list(csv.reader(io.StringIO(export_csv(ctx["gid"]))))
    return rows[0], rows[1:]


def _with(header, row, **cells):
    row = list(row)
    for k, v in cells.items():
        row[header.index(k)] = v
    return row


def _plan(text):
    return build_plan(text, ctx["gid"]).to_json()


class TestBuildPlan:
    def test_roundtrip_of_export_is_unchanged(self, db_session, group, make_coffee):
        make_coffee(name="Guji", process="washed", notes="=x")
        make_coffee(name="Kochere", kind="cupping_lot", origin="Ethiopia")
        plan = _plan(export_csv(group.id))
        assert plan["file_errors"] == [] and plan["row_errors"] == []
        assert plan["creates"] == [] and plan["updates"] == []
        assert plan["unchanged_count"] == 2

    def test_excel_mangled_roundtrip_is_unchanged(self, db_session, group, make_coffee):
        make_coffee(name="Guji", notes="-ish")
        text = "﻿" + export_csv(group.id).replace("\r\n", "\n").replace("\n", "\r\n") + "\r\n,,,\r\n\r\n"
        assert "'-ish" in text
        plan = _plan(text)
        assert plan["row_errors"] == [] and plan["file_errors"] == []
        assert plan["updates"] == [] and plan["unchanged_count"] == 1

    def test_blank_id_creates(self, db_session, group, make_coffee):
        plan = _plan(_csv(["id", "name", "kind"], ["", "Kochere", "cupping_lot"]))
        assert plan["row_errors"] == []
        assert len(plan["creates"]) == 1
        cols = {f["column"]: f["new"] for f in plan["creates"][0]["fields"]}
        assert cols == {"name": "Kochere", "kind": "cupping_lot"}
        assert plan["creates"][0]["coffee_id"] is None

    def test_changed_cell_is_one_field_change(self, db_session, group, make_coffee):
        make_coffee(name="Guji", process="washed")
        header, rows = _export_rows()
        plan = _plan(_csv(header, _with(header, rows[0], process="natural")))
        assert plan["updates"][0]["fields"] == [{"column": "process", "old": "washed", "new": "natural"}]

    def test_blank_cell_clears_field(self, db_session, group, make_coffee):
        make_coffee(name="Guji", origin="Ethiopia")
        header, rows = _export_rows()
        plan = _plan(_csv(header, _with(header, rows[0], origin="")))
        assert plan["updates"][0]["fields"] == [{"column": "origin", "old": "Ethiopia", "new": None}]

    def test_missing_column_leaves_field_untouched(self, db_session, group, make_coffee):
        c = make_coffee(name="Guji", kind="house", notes="from the bag")
        plan = _plan(_csv(["id", "name", "kind"], [c.id, "Guji", "house"]))
        assert plan["updates"] == [] and plan["unchanged_count"] == 1

    def test_enum_case_insensitive_and_bad_value_errors(self, db_session, group, make_coffee):
        c = make_coffee(name="Guji", kind="house")
        ok = _plan(_csv(["id", "name", "process"], [c.id, "Guji", "Natural"]))
        assert ok["updates"][0]["fields"] == [{"column": "process", "old": None, "new": "natural"}]
        bad = _plan(_csv(["id", "name", "process"], [c.id, "Guji", "wet"]))
        assert bad["row_errors"][0]["column"] == "process"
        assert bad["row_errors"][0]["row"] == 2
        assert "washed" in bad["row_errors"][0]["message"]

    def test_blank_name_or_kind_is_error(self, db_session, group, make_coffee):
        c = make_coffee(name="Guji")
        plan = _plan(_csv(["id", "name", "kind"], [c.id, "", "house"], ["", "New", ""], ["", "Other", "house"]))
        errs = {(e["row"], e["column"]) for e in plan["row_errors"]}
        assert errs == {(2, "name"), (3, "kind")}
        # a create from a file with no kind column at all
        plan = _plan(_csv(["id", "name"], ["", "New"]))
        assert plan["row_errors"][0]["column"] == "kind"

    def test_unknown_and_duplicate_id_errors(self, db_session, group, make_coffee):
        c = make_coffee(name="Guji")
        plan = _plan(_csv(["id", "name"], [999999, "X"], [c.id, "Guji"], [c.id, "Guji 2"], ["abc", "Y"]))
        msgs = {e["row"]: e["message"] for e in plan["row_errors"]}
        assert msgs[2] == "No coffee with id 999999"
        assert 3 not in msgs
        assert "more than once" in msgs[4]
        assert 5 in msgs

    def test_archived_parsing(self, db_session, group, make_coffee):
        c = make_coffee(name="Guji")
        for cell, expect in (("yes", True), ("TRUE", True), ("0", False), ("", False)):
            plan = _plan(_csv(["id", "name", "archived"], [c.id, "Guji", cell]))
            assert plan["row_errors"] == []
            changes = plan["updates"][0]["fields"] if plan["updates"] else []
            assert changes == ([{"column": "archived", "old": False, "new": True}] if expect else [])
        bad = _plan(_csv(["id", "name", "archived"], [c.id, "Guji", "maybe"]))
        assert bad["row_errors"][0]["column"] == "archived"

    def test_text_too_long_errors(self, db_session, group, make_coffee):
        plan = _plan(_csv(["id", "name", "kind", "altitude"], ["", "New", "house", "x" * 61]))
        assert plan["row_errors"][0]["column"] == "altitude"

    def test_blank_id_exact_match_is_skipped(self, db_session, group, make_coffee):
        make_coffee(name="Guji", roaster="Onyx")
        plan = build_plan(_csv(["id", "name", "roaster", "kind"], ["", "Guji", "Onyx", "house"]), ctx["gid"])
        assert not plan.has_errors
        j = plan.to_json()
        assert j["creates"] == [] and len(j["skipped"]) == 1
        assert j["skipped"][0]["row"] == 2 and j["skipped"][0]["name"] == "Guji"

    def test_decomposed_padded_name_is_skipped_not_duplicated(self, db_session, group, make_coffee):
        make_coffee(name="Pe\u00f1as Blancas", roaster="R")
        plan = build_plan(_csv(["id", "name", "roaster", "kind"],
                               ["", "Pen\u0303as blancas ", "R", "house"]), ctx["gid"])
        j = plan.to_json()
        assert j["creates"] == [] and len(j["skipped"]) == 1

    def test_match_ignores_case(self, db_session, group, make_coffee):
        make_coffee(name="Guji", roaster="Onyx")
        j = _plan(_csv(["id", "name", "roaster", "kind"], ["", "guji", "ONYX", "house"]))
        assert j["creates"] == [] and len(j["skipped"]) == 1

    def test_different_roaster_is_not_a_match(self, db_session, group, make_coffee):
        make_coffee(name="Guji", roaster="Onyx")
        j = _plan(_csv(["id", "name", "roaster", "kind"], ["", "Guji", "Other", "house"]))
        assert len(j["creates"]) == 1 and j["skipped"] == []

    def test_archived_match_is_skipped_and_says_so(self, db_session, group, make_coffee):
        from tasting import repository as trepo
        c = make_coffee(name="Guji", roaster="Onyx")
        trepo.set_archived(c, True)
        db_session.flush()
        j = _plan(_csv(["id", "name", "roaster", "kind"], ["", "Guji", "Onyx", "house"]))
        assert j["creates"] == [] and "(archived)" in j["skipped"][0]["message"]

    def test_active_match_message_has_no_archived(self, db_session, group, make_coffee):
        make_coffee(name="Guji", roaster="Onyx")
        j = _plan(_csv(["id", "name", "roaster", "kind"], ["", "Guji", "Onyx", "house"]))
        assert "already exists" in j["skipped"][0]["message"]
        assert "archived" not in j["skipped"][0]["message"]

    def test_same_new_row_twice_in_file_skips_second(self, db_session, group, make_coffee):
        j = _plan(_csv(["id", "name", "roaster", "kind"],
                       ["", "Guji", "Onyx", "house"], ["", "GUJI", "onyx", "house"]))
        assert [c["row"] for c in j["creates"]] == [2]
        assert [s["row"] for s in j["skipped"]] == [3]

    def test_importing_same_file_twice_creates_nothing_new(self, db_session, group, make_coffee):
        text = _csv(["id", "name", "roaster", "kind"], ["", "Guji", "Onyx", "house"])
        apply_plan(build_plan(text, ctx["gid"]), ctx["gid"], created_by=None)
        db_session.flush()
        second = build_plan(text, ctx["gid"])
        assert second.creates == [] and len(second.skipped) == 1
        assert apply_plan(second, ctx["gid"], created_by=None) == (0, 0)

    def test_id_row_still_updates(self, db_session, group, make_coffee):
        c = make_coffee(name="Guji", roaster="Onyx", process="washed")
        j = _plan(_csv(["id", "name", "roaster", "process"], [c.id, "Guji", "Onyx", "natural"]))
        assert len(j["updates"]) == 1 and j["skipped"] == []

    def test_skipped_row_changes_the_hash(self, db_session, group, make_coffee):
        text = _csv(["id", "name", "roaster", "kind"], ["", "Guji", "Onyx", "house"])
        before = _plan(text)["plan_hash"]
        make_coffee(name="Guji", roaster="Onyx")
        assert _plan(text)["plan_hash"] != before

    def test_flight_columns_ignored(self, db_session, group, make_coffee):
        header = ["flight", "prep", "position", "blind_label", "id", "name", "kind"]
        j = _plan(_csv(header, ["Day 1", "cupping", "1", "H1", "", "Guji", "house"]))
        assert j["file_errors"] == [] and j["row_errors"] == []
        assert len(j["creates"]) == 1
        assert {f["column"] for f in j["creates"][0]["fields"]} == {"name", "kind"}

    def test_flight_columns_change_nothing_on_update(self, db_session, group, make_coffee):
        c = make_coffee(name="Guji")
        header = ["flight", "prep", "position", "blind_label", "id", "name"]
        j = _plan(_csv(header, ["Day 1", "cupping", "1", "H1", c.id, "Guji"]))
        assert j["updates"] == [] and j["unchanged_count"] == 1

    def test_other_unknown_column_still_file_error(self, db_session, group, make_coffee):
        j = _plan(_csv(["flight", "id", "name", "bogus"], ["Day 1", "", "Guji", "x"]))
        assert any("Unknown column 'bogus'" in e for e in j["file_errors"])
        assert not any("flight" in e for e in j["file_errors"])

    @pytest.mark.parametrize("text, fragment", [
        ("", "empty"),
        ("id,name,kind\n", "no rows"),
        ("name,kind\nGuji,house\n", "'id'"),
        ("id,kind\n,house\n", "'name'"),
        ("id,name,flavor\n,Guji,x\n", "Unknown column 'flavor'"),
        ("id,name,name\n,Guji,Guji\n", "more than once"),
    ])
    def test_file_errors(self, db_session, group, make_coffee, text, fragment):
        plan = _plan(text)
        assert any(fragment in e for e in plan["file_errors"]), plan["file_errors"]
        assert plan["row_errors"] == [] and plan["creates"] == []

    def test_too_many_rows_is_file_error(self, db_session, group, make_coffee):
        text = _csv(["id", "name", "kind"], *[["", f"C{i}", "house"] for i in range(2001)])
        assert any("2000" in e for e in _plan(text)["file_errors"])

    def test_plan_hash_stable_and_sensitive(self, db_session, group, make_coffee):
        c = make_coffee(name="Guji", process="washed")
        text = _csv(["id", "name", "process"], [c.id, "Guji", "natural"])
        first = _plan(text)["plan_hash"]
        assert _plan(text)["plan_hash"] == first
        c.process = "honey"
        db_session.flush()
        assert _plan(text)["plan_hash"] != first

    def test_build_plan_never_writes(self, db_session, group, make_coffee):
        from tasting.models import TastingCoffee
        c = make_coffee(name="Guji")
        build_plan(_csv(["id", "name", "kind"], [c.id, "Renamed", "house"], ["", "New", "house"]), ctx["gid"])
        assert not db_session.new and not db_session.dirty
        assert db_session.query(TastingCoffee).count() == 1
        assert db_session.get(TastingCoffee, c.id).name == "Guji"

    def test_id_beyond_int_range_is_unknown_not_crash(self, db_session, group, make_coffee):
        plan = _plan(_csv(["id", "name"], ["99999999999999999999", "X"]))
        assert plan["row_errors"][0]["message"] == "No coffee with id 99999999999999999999"


# ---------------------------------------------------------------------------
# apply_plan
# ---------------------------------------------------------------------------

from tasting.coffee_csv import apply_plan  # noqa: E402


class TestApplyPlan:
    def test_apply_creates_updates_archives(self, db_session, group, make_coffee):
        from tasting.models import TastingCoffee
        guji = make_coffee(name="Guji", process="washed")
        old = make_coffee(name="Old")
        text = _csv(["id", "name", "kind", "process", "archived"],
                    ["", "Kochere", "cupping_lot", "natural", "no"],
                    [guji.id, "Guji", "house", "natural", "no"],
                    [old.id, "Old", "house", "", "yes"])
        plan = build_plan(text, ctx["gid"])
        assert not plan.has_errors
        assert apply_plan(plan, ctx["gid"], created_by=None) == (1, 2)
        new = db_session.query(TastingCoffee).filter_by(name="Kochere").one()
        assert new.kind == "cupping_lot" and new.process == "natural"
        assert new.group_id == ctx["gid"]
        assert new.archived_at is None
        assert guji.process == "natural" and guji.archived_at is None
        assert old.archived_at is not None

    def test_apply_create_archived(self, db_session, group, make_coffee):
        from tasting.models import TastingCoffee
        plan = build_plan(_csv(["id", "name", "kind", "archived"], ["", "Gone", "house", "yes"]), ctx["gid"])
        apply_plan(plan, ctx["gid"], created_by=None)
        assert db_session.query(TastingCoffee).filter_by(name="Gone").one().archived_at is not None

    def test_apply_clears_fields(self, db_session, group, make_coffee):
        c = make_coffee(name="Guji", origin="Ethiopia", notes="bag", roaster="Onyx")
        plan = build_plan(_csv(["id", "name", "origin", "notes", "roaster"], [c.id, "Guji", "", "", ""]), ctx["gid"])
        apply_plan(plan, ctx["gid"], created_by=None)
        assert c.origin is None and c.notes == "" and c.roaster == ""

    def test_apply_refuses_plan_with_errors(self, db_session, group, make_coffee):
        plan = build_plan(_csv(["id", "name"], [999, "X"]), ctx["gid"])
        with pytest.raises(ValueError):
            apply_plan(plan, ctx["gid"], created_by=None)


class TestReviewEdges:
    def test_unicode_digit_id_is_row_error(self, db_session, group, make_coffee):
        plan = _plan(_csv(["id", "name"], ["²", "X"]))
        assert plan["row_errors"][0]["column"] == "id"

    def test_leading_quote_roundtrips(self, db_session, group, make_coffee):
        for notes in ("'=nice", "'plain", "''=x"):
            c = make_coffee(name=f"Q{notes}", notes=notes)
        plan = _plan(export_csv(group.id))
        assert plan["updates"] == [] and plan["row_errors"] == []


class TestGroupScoping:
    def test_stores_column_is_ignored_with_a_warning(self, db_session, group, make_coffee):
        c = make_coffee(name="Guji")
        header = ["id", "name", "stores"]
        plan = build_plan(_csv(header, [c.id, "Guji", "Anywhere|Else"]), group.id)
        assert not plan.has_errors
        assert [w.message for w in plan.warnings] == ["ignored_column: stores"]
        assert plan.to_json()["updates"] == [] and plan.unchanged_count == 1

    def test_another_groups_coffee_id_is_no_coffee(self, db_session, group, make_coffee):
        other = helpers.make_group(db_session, "Elsewhere")
        theirs = helpers.make_coffee(db_session, other, name="Theirs")
        j = _plan(_csv(["id", "name"], [theirs.id, "Renamed"]))
        assert j["row_errors"][0]["message"] == f"No coffee with id {theirs.id}"
        assert j["updates"] == []

    def test_export_and_name_matching_ignore_other_groups(self, db_session, group, make_coffee):
        other = helpers.make_group(db_session, "Elsewhere")
        helpers.make_coffee(db_session, other, name="Guji", roaster="Onyx")
        assert [r["name"] for r in _rows(export_csv(group.id))] == []
        j = _plan(_csv(["id", "name", "roaster", "kind"], ["", "Guji", "Onyx", "house"]))
        assert len(j["creates"]) == 1 and j["skipped"] == []

    def test_created_coffee_belongs_to_the_importing_group(self, db_session, group, make_coffee):
        from tasting.models import TastingCoffee
        plan = build_plan(_csv(["id", "name", "kind"], ["", "Fresh", "house"]), group.id)
        apply_plan(plan, group.id, created_by=None)
        db_session.flush()
        row = db_session.query(TastingCoffee).filter_by(name="Fresh").one()
        assert row.group_id == group.id
