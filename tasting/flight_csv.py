"""Flight CSV upload: turn one file into a plan for several blind cupping flights.

`build_plan` reads the file against the group's coffee catalog and never writes. The plan
is the only thing a preview may show, and it never carries the key: cup-level data
(coffee ids, names, blind labels) stays in the private `_cups`, which `to_json`
omits, so the preview never says which cup is which, even to the editor uploading.
Everything is scoped to one group: another group's coffee is "No coffee with id"
or "No coffee named", and a flight name counts as existing only in this group.
"""
import hashlib
import json
import random
import re
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from typing import Optional

from extensions import db
from tasting import flights_repository as frepo
from tasting import repository as trepo
from tasting.coffee_csv import CellError, RowWarning, _is_id, _parse_cell, _read_rows, _unescape, coffee_key
from tasting.enums import PREPS
from tasting.models import TastingCoffee, TastingFlight
from utils import is_pg_int, utc_now

MAX_CUPS = 26
MAX_ROWS = 2000
NAME_LIMIT = 255
REQUIRED = ("flight", "prep", "name")
# The coffee export columns a new coffee is made from. `id` and `archived` are
# not: an id names an existing coffee, and archiving is set in Coffees.
NEW_COFFEE_COLUMNS = ("name", "roaster", "kind", "origin", "region", "variety", "altitude",
                      "lot_code", "process", "roast_level", "notes")
_LABEL = re.compile(r"[A-Za-z0-9]{1,4}")


@dataclass
class RowError:
    row: Optional[int]          # CSV line number (header = 1)
    column: Optional[str]
    message: str
    flight: Optional[str] = None


@dataclass
class FlightPreview:
    name: str
    prep: str
    sheet: str                  # "advanced" | "basic"
    cup_count: int
    custom_labels: bool
    existing_count: int         # flights with this exact name, any status
    new_coffee_count: int = 0   # rows that will create a coffee
    error_count: int = 0


@dataclass
class FlightPlan:
    file_errors: list
    row_errors: list
    warnings: list
    flights: list
    plan_hash: str
    # Private: flight name -> [(position, coffee_id or None, label or None, new_coffee or None)],
    # by position. new_coffee is the body for create_coffee when coffee_id is None.
    _cups: dict = field(default_factory=dict, repr=False)

    @property
    def has_errors(self) -> bool:
        return bool(self.file_errors or self.row_errors)

    @property
    def file_blocked(self) -> bool:
        """A file error stops everything; row errors only stop the flight they sit in."""
        return bool(self.file_errors)

    def flight_has_errors(self, name: str) -> bool:
        return any(e.flight == name for e in self.row_errors)

    def to_json(self) -> dict:
        return {
            "file_errors": list(self.file_errors),
            "row_errors": [asdict(e) for e in self.row_errors],
            "warnings": [asdict(w) for w in self.warnings],
            "flights": [asdict(f) for f in self.flights],
            "plan_hash": self.plan_hash,
        }


def _hash(flights: list, cups: dict) -> str:
    """Covers every cup (position, coffee id, label, new-coffee values) and, per flight,
    its prep, existing-name count and error count. Not which flights are ticked or shuffle."""
    canonical = json.dumps(
        [[f.name, f.prep, f.existing_count, f.error_count, [list(c) for c in cups.get(f.name, [])]]
         for f in flights],
        sort_keys=True, separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def _file_error_plan(*messages: str) -> FlightPlan:
    return FlightPlan(list(messages), [], [], [], _hash([], {}))


def _cell(cells: list, idx: Optional[int]) -> str:
    """One cell, un-escaped the way the Coffees export escaped it, then stripped."""
    return _unescape(cells[idx]).strip() if idx is not None and idx < len(cells) else ""


class _Catalog:
    """The group's coffee catalog, loaded once for the whole file."""

    def __init__(self, group_id: int):
        self.by_id, self.by_name = {}, defaultdict(list)
        for c in db.session.execute(
                db.select(TastingCoffee).where(TastingCoffee.group_id == group_id)).scalars():
            self.by_id[c.id] = c
            self.by_name[coffee_key(c.name, c.roaster)].append(c)

    def by_id_or_error(self, raw_id: str):
        """(coffee, None) or (None, message) for a filled id cell."""
        if not _is_id(raw_id) or not is_pg_int(int(raw_id)) or int(raw_id) not in self.by_id:
            return None, f"No coffee with id {raw_id}"
        coffee = self.by_id[int(raw_id)]
        if coffee.archived_at is not None:
            return None, f"Coffee {raw_id} is archived"
        return coffee, None

    def by_roaster_and_name(self, roaster: str, name: str):
        """(coffee, None, False), (None, message, False), or (None, message, True) when
        nothing matches at all, the only case that may become a new coffee."""
        matches = self.by_name.get(coffee_key(name, roaster), [])
        label = f"'{name}' from {roaster}" if roaster else f"'{name}'"
        active = [c for c in matches if c.archived_at is None]
        if len(active) == 1:
            return active[0], None, False
        if len(active) > 1:
            return None, f"More than one coffee matches {label} — rename or archive the extras", False
        if matches:
            return None, f"{label} is archived", False
        return None, f"No coffee named {label}", True


def _check_labels(rows: list, errors: list, flight: str) -> bool:
    """Labels are all or none per flight. Returns True when the flight is custom-labelled."""
    filled = [r for r in rows if r["label"]]
    if not filled:
        return False
    seen = set()
    for r in rows:
        if not r["label"]:
            errors.append(RowError(r["line"], "blind_label",
                                   "Every cup in this flight needs a label, or none of them", flight))
        elif not _LABEL.fullmatch(r["label"]):
            errors.append(RowError(r["line"], "blind_label",
                                   f"'{r['label']}' must be 1-4 letters or digits", flight))
        elif r["label"].casefold() in seen:
            errors.append(RowError(r["line"], "blind_label",
                                   f"Label '{r['label']}' is used twice in this flight", flight))
        else:
            seen.add(r["label"].casefold())
    return len(filled) == len(rows)


def _new_coffee(raw: dict, line: int, flight: str, errors: list) -> Optional[dict]:
    """Body for a coffee the file introduces, validated like the coffee import; None on error."""
    body, ok = {}, True
    for column in NEW_COFFEE_COLUMNS:
        if column not in raw:
            continue
        try:
            body[column] = _parse_cell(column, raw[column])
        except CellError as e:
            errors.append(RowError(line, column, str(e), flight))
            ok = False
    return body if ok else None


def _resolve_row(r: dict, catalog: _Catalog, has_kind: bool, flight: str, errors: list):
    """(coffee, new_coffee_body, dedupe_key); all None when the row is in error."""
    def fail(column, message):
        errors.append(RowError(r["line"], column, message, flight))
        return None, None, None

    if r["id"]:
        coffee, problem = catalog.by_id_or_error(r["id"])
        return (coffee, None, ("id", coffee.id)) if coffee else fail("id", problem)
    if not r["name"]:
        return fail("name", "name is required")
    coffee, problem, unmatched = catalog.by_roaster_and_name(r["roaster"], r["name"])
    if coffee:
        return coffee, None, ("id", coffee.id)
    if not (unmatched and has_kind):
        return fail("name", problem)
    body = _new_coffee(r["raw"], r["line"], flight, errors)
    return (None, body, ("new", *coffee_key(r["name"], r["roaster"]))) if body else (None, None, None)


def _read_flight_rows(rows: list, at: dict, errors: list):
    """(rows by flight, count of rows with no flight)."""
    by_flight, skipped = defaultdict(list), 0
    for line, cells in rows:
        name = _cell(cells, at["flight"])
        if not name:
            skipped += 1
        elif len(name) > NAME_LIMIT:
            errors.append(RowError(line, "flight", f"flight name is too long (max {NAME_LIMIT})"))
        else:
            by_flight[name].append({
                "line": line, "prep": _cell(cells, at["prep"]).lower(),
                "position": _cell(cells, at.get("position")), "label": _cell(cells, at.get("blind_label")),
                "id": _cell(cells, at.get("id")), "roaster": _cell(cells, at.get("roaster")),
                "name": _cell(cells, at["name"]),
                "raw": {c: cells[i] if i < len(cells) else ""
                        for c, i in at.items() if c in NEW_COFFEE_COLUMNS},
            })
    return by_flight, skipped


def _position(r: dict, n: int, has_positions: bool, seen: set, errors: list, flight: str) -> Optional[int]:
    """The cup's position, or None after recording an error. Blank everywhere = file order."""
    if not has_positions:
        return n
    pos = r["position"]
    if not pos:
        errors.append(RowError(r["line"], "position",
                               "Every cup in this flight needs a position, or none of them", flight))
    elif not (pos.isascii() and pos.isdigit() and int(pos) >= 1):
        errors.append(RowError(r["line"], "position", f"'{pos}' must be a whole number, 1 or more", flight))
    elif int(pos) in seen:
        errors.append(RowError(r["line"], "position", f"Position {pos} is used twice in this flight", flight))
    else:
        seen.add(int(pos))
        return int(pos)
    return None


def build_plan(csv_text: str, group_id: int) -> FlightPlan:
    """Read a coffee export file (plus `flight` and `prep`) against the group. Never writes."""
    loaded = _read_rows(csv_text)
    if isinstance(loaded, str):
        return _file_error_plan(loaded)
    header, rows = loaded
    header = [h.casefold() for h in header]
    file_errors = [f"The file has no '{c}' column" for c in REQUIRED if c not in header]
    file_errors += [f"Column '{h}' appears more than once"
                    for h in sorted({h for h in header if h and header.count(h) > 1})]
    if len(rows) > MAX_ROWS:
        file_errors.append(f"The file has {len(rows)} rows; the limit is {MAX_ROWS}")
    if file_errors:
        return _file_error_plan(*file_errors)

    at = {h: header.index(h) for h in (*REQUIRED, "id", "position", "blind_label", "roaster",
                                       *NEW_COFFEE_COLUMNS) if h in header}
    catalog = _Catalog(group_id)
    errors, warnings = [], []
    by_flight, skipped = _read_flight_rows(rows, at, errors)
    if not by_flight:
        if errors:
            return FlightPlan([], errors, [], [], _hash([], {}))
        return _file_error_plan("No row has a flight")
    if skipped:
        message = ("1 row has no flight and was skipped" if skipped == 1
                   else f"{skipped} rows have no flight and were skipped")
        warnings.append(RowWarning(None, message))

    existing = defaultdict(int)
    for (n,) in db.session.execute(db.select(TastingFlight.name).where(
            TastingFlight.group_id == group_id, TastingFlight.name.in_(list(by_flight)))):
        existing[n] += 1

    flights, cups = [], {}
    for name, frows in by_flight.items():
        start = len(errors)
        prep = next((r["prep"] for r in frows if r["prep"] in PREPS), frows[0]["prep"])
        custom = _check_labels(frows, errors, name)
        has_positions = any(r["position"] for r in frows)
        positions, seen_keys, parsed, new_count = set(), set(), [], 0
        for n, r in enumerate(frows, 1):
            if n > MAX_CUPS:
                errors.append(RowError(r["line"], None, f"A flight holds at most {MAX_CUPS} cups", name))
            if r["prep"] not in PREPS:
                errors.append(RowError(r["line"], "prep",
                                       f"'{r['prep']}' is not one of {', '.join(PREPS)}", name))
            elif r["prep"] != prep:
                errors.append(RowError(r["line"], "prep", f"Every row of '{name}' must have the same prep", name))
            pos = _position(r, n, has_positions, positions, errors, name)
            coffee, new, dedupe = _resolve_row(r, catalog, "kind" in at, name, errors)
            if dedupe in seen_keys:
                errors.append(RowError(r["line"], "id" if r["id"] else "name",
                                       f"'{r['id'] or r['name']}' appears more than once in this flight", name))
                continue
            if dedupe:
                seen_keys.add(dedupe)
            if pos is not None and (coffee or new):
                parsed.append((pos, coffee.id if coffee else None, r["label"] if custom else None, new))
                new_count += new is not None
        cups[name] = sorted(parsed, key=lambda c: c[0])
        flights.append(FlightPreview(name, prep, "advanced" if prep == "cupping" else "basic", len(frows),
                                     custom, existing[name], new_count, len(errors) - start))
        if existing[name]:
            warnings.append(RowWarning(frows[0]["line"], f"{existing[name]} flight(s) named '{name}' "
                                                         "already exist — uploading creates another"))

    errors.sort(key=lambda e: e.row)
    warnings.sort(key=lambda w: (w.row is not None, w.row or 0))   # file-wide notes first
    return FlightPlan([], errors, warnings, flights, _hash(flights, cups), cups)


def _new_coffee_key(body: dict) -> tuple:
    """The plan's own dedupe key for a new coffee (see `_resolve_row`)."""
    return ("new", *coffee_key(body["name"], body.get("roaster")))


def apply_plan(plan: FlightPlan, group_id: int, names: list, who, *, created_by=None,
               shuffle: bool = True, rng=None) -> list:
    """Create the coffees the ticked flights introduce, then one open shared blind flight
    (48 hours) per ticked flight. Never commits, so one failure rolls the whole call back.

    Only ticked flights' coffees are made. A new coffee in two ticked flights is made once,
    from its first row; an existing coffee is never touched. A file's own labels stay with
    their coffee and the flight is never shuffled; otherwise the pour order is shuffled
    (when asked) before A, B, C are dealt, so the sheet order carries no hint of file order."""
    ticked = [f for f in plan.flights if f.name in names]
    if plan.file_blocked or any(plan.flight_has_errors(f.name) for f in ticked):
        raise ValueError("a plan with errors cannot be applied")
    rng = rng or random.SystemRandom()
    now = utc_now()
    created, made = {}, []
    for f in ticked:
        ids = []
        for _, coffee_id, _, new in plan._cups[f.name]:
            if coffee_id is None:
                key = _new_coffee_key(new)
                if key not in created:
                    created[key] = trepo.create_coffee(group_id, new, created_by).id
                coffee_id = created[key]
            ids.append(coffee_id)
        labels = [label for _, _, label, _ in plan._cups[f.name]] if f.custom_labels else None
        if labels is None and shuffle:
            rng.shuffle(ids)
        made.append(frepo.create_flight(
            group_id, {"coffee_ids": ids, "prep": f.prep, "sheet": f.sheet, "name": f.name,
                       "shared": True, "blind": True},
            who, now=now, blind_labels=labels, window=frepo.UPLOADED_FLIGHT_WINDOW))
    return made
