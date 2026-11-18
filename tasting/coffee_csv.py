"""Coffee CSV round trip: export a group's coffees, then re-import an edited copy.

`build_plan` diffs the file against the database and never writes;
`apply_plan` writes the plan and never commits. The apply route rebuilds the plan from the same file and
refuses a `plan_hash` that no longer matches, so a stale preview is never
written.

File rules: a row with an `id` updates that coffee, a blank `id` creates one,
and a coffee left out of the file is untouched. A blank cell clears the field;
a column missing from the header leaves that field alone on every row.

A blank-id row whose name + roaster (ignoring case) already exists, active or
archived, or appeared earlier in the file, is skipped rather than duplicated.
The flight-file columns in `IGNORED_COLUMNS` are accepted and do nothing, and
so is a `stores` column from an older export (warning `ignored_column: stores`).
Everything is scoped to one group: another group's id is "No coffee with id".
"""
import csv
import hashlib
import io
import json
import unicodedata
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

from extensions import db
from tasting.enums import COFFEE_KINDS, PROCESSES, ROASTS
from tasting.models import TastingCoffee
from tasting.repository import COFFEE_TEXT_LIMITS
from utils import _CSV_FORMULA_PREFIXES, csv_safe, is_pg_int

COLUMNS = ("id", "name", "roaster", "kind", "origin", "region", "variety", "altitude",
           "lot_code", "process", "roast_level", "notes", "archived")


def _cell(value) -> str:
    """csv_safe, plus a leading `'` is doubled so `_unescape` can always strip
    exactly one — otherwise a stored `'=x` would come back as `=x`."""
    if value and value[0] == "'":
        return "'" + value
    return csv_safe(value)


def export_csv(group_id: int) -> str:
    coffees = db.session.execute(
        db.select(TastingCoffee).where(TastingCoffee.group_id == group_id)
        .order_by(TastingCoffee.id)).scalars().all()
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(COLUMNS)
    for c in coffees:
        writer.writerow([
            c.id, _cell(c.name), _cell(c.roaster), c.kind,
            _cell(c.origin), _cell(c.region), _cell(c.variety),
            _cell(c.altitude), _cell(c.lot_code), c.process or "", c.roast_level or "",
            _cell(c.notes),
            "yes" if c.archived_at else "no",
        ])
    return out.getvalue()


# ---------------------------------------------------------------------------
# import plan
# ---------------------------------------------------------------------------

MAX_ROWS = 2000
TEXT_LIMITS = {"name": 255, "roaster": 255, "notes": 4000, **dict(COFFEE_TEXT_LIMITS)}
# The flight upload's own columns: a Count Export file carries them, and the
# coffee import accepts that file as-is without reading any of them.
IGNORED_COLUMNS = ("flight", "prep", "position", "blind_label")
# Columns an older export carried that mean nothing here: ignored with a warning.
WARNED_COLUMNS = ("stores",)
ENUMS = {"kind": COFFEE_KINDS, "process": PROCESSES, "roast_level": ROASTS}
# Blank clears these to "" (NOT NULL columns); every other optional field to None.
EMPTY_STRING_FIELDS = {"roaster", "notes"}
_TRUE = {"yes", "true", "1"}
_FALSE = {"no", "false", "0", ""}


class CellError(ValueError):
    pass


@dataclass
class RowError:
    row: Optional[int]          # CSV line number (header = 1); None for file-level
    coffee_id: Optional[int]
    column: Optional[str]
    message: str


@dataclass
class RowWarning:
    row: Optional[int]          # None for a note about the whole file
    message: str


@dataclass
class FieldChange:
    column: str
    old: Any
    new: Any


@dataclass
class CoffeeChange:
    row: int
    coffee_id: Optional[int]    # None = create
    name: str
    fields: list


@dataclass
class SkippedRow:
    row: int
    name: str
    roaster: str
    archived: bool              # the only match in Count is archived
    message: str


@dataclass
class CoffeePlan:
    file_errors: list
    row_errors: list
    warnings: list
    creates: list
    updates: list
    unchanged_count: int
    plan_hash: str
    skipped: list = field(default_factory=list)
    # Private, for apply_plan: row -> body dict shaped for trepo.create_coffee /
    # update_coffee, plus "archived": bool when it changes.
    _parsed: dict = field(default_factory=dict, repr=False)

    @property
    def has_errors(self) -> bool:
        return bool(self.file_errors or self.row_errors)

    def to_json(self) -> dict:
        return {
            "file_errors": list(self.file_errors),
            "row_errors": [asdict(e) for e in self.row_errors],
            "warnings": [asdict(w) for w in self.warnings],
            "creates": [asdict(c) for c in self.creates],
            "updates": [asdict(c) for c in self.updates],
            "unchanged_count": self.unchanged_count,
            "skipped": [asdict(s) for s in self.skipped],
            "plan_hash": self.plan_hash,
        }


def _hash_changes(changes: list, skipped: list = ()) -> str:
    """Skipped rows are hashed too: a create changes what the database holds, so
    replaying the same file and hash turns that row into a skip and is refused
    (409) instead of being applied against a different picture."""
    canonical = json.dumps(
        [[c.row, c.coffee_id, f.column, f.old, f.new] for c in changes for f in c.fields]
        + [[s.row, s.name, s.roaster, s.archived] for s in skipped],
        sort_keys=True, separators=(",", ":"), default=str,
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def _file_error_plan(*messages: str) -> CoffeePlan:
    return CoffeePlan(list(messages), [], [], [], [], 0, _hash_changes([]))


def _unescape(cell: str) -> str:
    """Inverse of `_cell`: strip exactly the one `'` the export added."""
    if len(cell) > 1 and cell[0] == "'" and (cell[1] in _CSV_FORMULA_PREFIXES or cell[1] == "'"):
        return cell[1:]
    return cell


def _read_rows(csv_text: str):
    """(header, [(physical start line, cells)]) or a file-error message. Blank
    records are dropped; the start line keeps multiline cells from shifting
    later row numbers (same approach as payroll/staff_import._read_rows)."""
    reader = csv.reader(io.StringIO(csv_text.lstrip("\ufeff")))
    header = None
    rows = []
    while True:
        before = reader.line_num
        try:
            cells = next(reader)
        except StopIteration:
            break
        except csv.Error as e:
            return f"The file could not be read near line {reader.line_num}: {e}"
        if header is None:
            header = [h.strip() for h in cells]
            continue
        if any(c.strip() for c in cells):
            rows.append((before + 1, cells))
    if not header or not any(header):
        return "The file is empty"
    if not rows:
        return "The file has a header but no rows"
    return header, rows


def _is_id(cell: str) -> bool:
    # ASCII only: str.isdigit() accepts '²', which int() then rejects.
    return cell.isascii() and cell.isdigit()


def _parse_cell(column: str, raw: str) -> Any:
    """Typed value for one cell. Raises CellError with a person-readable message."""
    value = _unescape(raw).strip()
    if column in ENUMS:
        if not value:
            if column == "kind":
                raise CellError("kind is required")
            return None
        code = value.lower()
        if code not in ENUMS[column]:
            raise CellError(f"'{value}' is not one of {', '.join(ENUMS[column])}")
        return code
    if column == "archived":
        low = value.lower()
        if low in _TRUE:
            return True
        if low in _FALSE:
            return False
        raise CellError(f"'{value}' must be yes or no")
    limit = TEXT_LIMITS[column]
    if len(value) > limit:
        raise CellError(f"{column} is too long (max {limit})")
    if column == "name" and not value:
        raise CellError("name is required")
    if not value and column not in EMPTY_STRING_FIELDS:
        return None
    return value


def _current(coffee: TastingCoffee, column: str) -> Any:
    if column == "archived":
        return coffee.archived_at is not None
    return getattr(coffee, column)


def coffee_key(name: Optional[str], roaster: Optional[str] = "") -> tuple:
    """Identity of a coffee by name + roaster: NFC, trimmed, case-folded. One key for the
    coffee import and the flight import, so a decomposed 'Pen\u0303as' is the same coffee."""
    def fold(s):
        return unicodedata.normalize("NFC", s or "").strip().casefold()
    return (fold(name), fold(roaster))


def build_plan(csv_text: str, group_id: int) -> CoffeePlan:
    """Diff a coffee CSV against one group's coffees. Never writes."""
    loaded = _read_rows(csv_text)
    if isinstance(loaded, str):
        return _file_error_plan(loaded)
    header, rows = loaded

    dupes = sorted({h for h in header if h and header.count(h) > 1})
    file_errors = [f"The file has no '{c}' column" for c in ("id", "name") if c not in header]
    file_errors += [f"Blank column header (column {i})" for i, h in enumerate(header, 1) if not h]
    file_errors += [f"Column '{h}' appears more than once" for h in dupes]
    file_errors += [f"Unknown column '{h}'" for h in header
                    if h and h not in COLUMNS and h not in IGNORED_COLUMNS
                    and h not in WARNED_COLUMNS]
    if len(rows) > MAX_ROWS:
        file_errors.append(f"The file has {len(rows)} rows; the limit is {MAX_ROWS}")
    if file_errors:
        return _file_error_plan(*file_errors)

    columns = [c for c in COLUMNS if c in header and c != "id"]
    warnings = [RowWarning(None, f"ignored_column: {h}") for h in header if h in WARNED_COLUMNS]

    raw_ids = {}
    for line, cells in rows:
        cell = cells[header.index("id")].strip() if header.index("id") < len(cells) else ""
        raw_ids[line] = cell
    wanted = [i for i in (int(v) for v in raw_ids.values() if _is_id(v)) if is_pg_int(i)]
    coffees = {c.id: c for c in db.session.execute(
        db.select(TastingCoffee).where(TastingCoffee.group_id == group_id,
                                       TastingCoffee.id.in_(wanted))).scalars().all()} if wanted else {}
    # name + roaster key -> True while every match is archived
    only_archived = {}
    for name, roaster, archived_at in db.session.execute(
            db.select(TastingCoffee.name, TastingCoffee.roaster, TastingCoffee.archived_at)
            .where(TastingCoffee.group_id == group_id)):
        key = coffee_key(name, roaster)
        only_archived[key] = only_archived.get(key, True) and archived_at is not None
    new_keys = set()

    row_errors, creates, updates, skipped = [], [], [], []
    parsed = {}
    seen_ids = set()
    unchanged = 0
    for line, cells in rows:
        raw_id = raw_ids[line]
        coffee = None
        if raw_id:
            if not _is_id(raw_id):
                row_errors.append(RowError(line, None, "id", f"'{raw_id}' is not a coffee id"))
                continue
            coffee_id = int(raw_id)
            if coffee_id in seen_ids:
                row_errors.append(RowError(line, coffee_id, "id", f"id {coffee_id} appears more than once"))
                continue
            seen_ids.add(coffee_id)
            coffee = coffees.get(coffee_id)
            if coffee is None:
                row_errors.append(RowError(line, coffee_id, "id", f"No coffee with id {coffee_id}"))
                continue
        if len(cells) > len(header):
            row_errors.append(RowError(line, coffee.id if coffee else None, None,
                                       "The row has more cells than the header"))
            continue

        values, ok = {}, True
        for column in columns:
            idx = header.index(column)
            try:
                values[column] = _parse_cell(column, cells[idx] if idx < len(cells) else "")
            except CellError as e:
                row_errors.append(RowError(line, coffee.id if coffee else None, column, str(e)))
                ok = False
        if coffee is None and ok:
            key = coffee_key(values["name"], values.get("roaster"))
            if key in only_archived or key in new_keys:
                archived = only_archived.get(key, False)
                skipped.append(SkippedRow(
                    line, values["name"], values.get("roaster") or "", archived,
                    f"'{values['name']}' already exists" + (" (archived)" if archived else "")))
                continue
        if coffee is None and "kind" not in header:
            row_errors.append(RowError(line, None, "kind", "kind is required"))
            ok = False
        if not ok:
            continue

        if coffee is None:
            fields = [FieldChange(c, None, v) for c, v in values.items()
                      if v not in (None, "", False)]
        else:
            fields = [FieldChange(c, _current(coffee, c), v) for c, v in values.items()
                      if v != _current(coffee, c)]

        if coffee is None:
            creates.append(CoffeeChange(line, None, values["name"], fields))
            parsed[line] = dict(values)
            new_keys.add(coffee_key(values["name"], values.get("roaster")))
        elif fields:
            updates.append(CoffeeChange(line, coffee.id, coffee.name, fields))
            parsed[line] = {f.column: f.new for f in fields}
        else:
            unchanged += 1

    return CoffeePlan([], row_errors, warnings, creates, updates, unchanged,
                      _hash_changes(creates + updates, skipped), skipped, parsed)


def apply_plan(plan: CoffeePlan, group_id: int, created_by: Optional[int]) -> tuple:
    """Write a plan's creates and updates. Returns (created, updated); never
    commits — the caller owns the transaction, so any raise rolls it all back."""
    from tasting import repository as trepo

    if plan.has_errors:
        raise ValueError("Cannot apply a plan that has errors")
    coffees = {c.id: c for c in db.session.execute(
        db.select(TastingCoffee).where(TastingCoffee.group_id == group_id,
                                       TastingCoffee.id.in_([u.coffee_id for u in plan.updates]))
    ).scalars().all()} if plan.updates else {}
    for change in plan.creates:
        body = dict(plan._parsed[change.row])
        archived = body.pop("archived", False)
        coffee = trepo.create_coffee(group_id, body, created_by=created_by)
        if archived:
            trepo.set_archived(coffee, True)
    for change in plan.updates:
        body = dict(plan._parsed[change.row])
        coffee = coffees[change.coffee_id]
        if "archived" in body:
            trepo.set_archived(coffee, body.pop("archived"))
        if body:
            trepo.update_coffee(coffee, body)
    return len(plan.creates), len(plan.updates)
