"""The host's edit of a blind flight before anyone has tasted: rename, add, reorder and
remove cups in one save. Labels stay with their slot, so Cup A stays first and the coffee
behind it changes. Never commits. Coffees come from the flight's group only: another
group's id is 404, and a rename is checked against this group's names only.
Import direction: this module -> flight_csv -> flights_repository -> repository."""
from typing import Optional

from extensions import db
from tasting import flights_repository as frepo
from tasting import repository as trepo
from tasting.coffee_csv import coffee_key
from tasting.flight_csv import _LABEL, MAX_CUPS
from tasting.models import TastingCoffee, TastingFlight, TastingFlightCoffee
from tasting.errors import TastingValidationError
from utils import is_pg_int

# Above any real position (the cap is 26), so a reorder can pass through it without
# tripping the non-deferrable unique constraint on (flight_id, position).
_TEMP_POSITION_OFFSET = 1000


def lock_reason(flight: TastingFlight) -> Optional[str]:
    """Why this flight can no longer be edited, or None. Tasters' scores are tied to cup
    positions, so nothing may move once tasting has visibly begun."""
    if not flight.is_open:
        return "This flight is closed, so it can't be edited."
    if flight.tastings:
        return "Someone has already logged a read, so this flight can't be edited."
    if flight.timer_started_at is not None:
        return "The timer has started, so this flight can't be edited."
    return None


def body_has_name(data: dict) -> bool:
    """Whether any cup carries a rename. Runs before validation, so it tolerates junk."""
    cups = data.get("cups")
    return isinstance(cups, list) and any(isinstance(row, dict) and "name" in row for row in cups)


def edit_cups(flight: TastingFlight, data: dict) -> None:
    """Make the flight's cups match `data["cups"]`, the complete new list top to bottom."""
    rows = _cup_rows(data)
    current = {fc.coffee_id: fc for fc in flight.coffees}
    coffees = _coffees_for(flight.group_id, rows, current)
    labels = _slot_labels(flight, len(rows), data.get("new_labels"))
    _apply_renames(flight.group_id, rows, coffees)
    _write_cups(flight, [row["coffee_id"] for row in rows], labels, current)


def _cup_rows(data: dict) -> list:
    rows = data.get("cups")
    if not isinstance(rows, list) or not rows:
        raise TastingValidationError("cups", "cups must be a non-empty list")
    if len(rows) > MAX_CUPS:
        raise TastingValidationError("cups", f"a flight can have at most {MAX_CUPS} cups")
    for row in rows:
        if not isinstance(row, dict) or isinstance(row.get("coffee_id"), bool) \
                or not is_pg_int(row.get("coffee_id")):
            raise TastingValidationError("cups", "each cup needs a coffee_id")
    ids = [row["coffee_id"] for row in rows]
    if len(set(ids)) != len(ids):
        raise TastingValidationError("cups", "a coffee can only be in a flight once")
    return rows


def _coffees_for(group_id: int, rows: list, current: dict) -> dict:
    coffees = frepo.coffees_in_group(group_id, [row["coffee_id"] for row in rows], field="cups")
    for row in rows:
        if row["coffee_id"] in current:
            continue  # A cup already in the flight may have been archived since; it stays.
        if coffees[row["coffee_id"]].archived_at is not None:
            raise TastingValidationError("cups", "that coffee is archived")
        if "name" in row:
            raise TastingValidationError("cups", "rename a coffee after it's in the flight")
    return coffees


def _slot_labels(flight: TastingFlight, count: int, new_labels) -> list:
    """The label for each slot: the current ones cut to `count`, then one per extra slot."""
    cups = sorted(flight.coffees, key=lambda fc: fc.position)
    defaults = [trepo.blind_label(fc.position - 1) for fc in cups]
    existing = [fc.blind_label or default for fc, default in zip(cups, defaults)]
    custom = existing != defaults
    kept = existing[:count]
    extra = count - len(kept)
    new_labels = new_labels if new_labels is not None else []
    if not isinstance(new_labels, list):
        raise TastingValidationError("new_labels", "new_labels must be a list")
    if not custom:
        if new_labels:
            raise TastingValidationError("new_labels", "this flight's labels are lettered automatically")
        return kept + [trepo.blind_label(i) for i in range(len(kept), count)]
    if len(new_labels) != extra:
        raise TastingValidationError("new_labels", f"give exactly {extra} new label(s)")
    seen = {label.casefold() for label in kept}
    for label in new_labels:
        if not isinstance(label, str) or not _LABEL.fullmatch(label):
            raise TastingValidationError("new_labels", "a label is 1-4 letters or digits")
        if label.casefold() in seen:
            raise TastingValidationError("new_labels", f"label {label} is already in this flight")
        seen.add(label.casefold())
    return kept + new_labels


def _apply_renames(group_id: int, rows: list, coffees: dict) -> None:
    renames = {row["coffee_id"]: trepo._str(row, "name", required=True) for row in rows if "name" in row}
    changed = {cid: name for cid, name in renames.items() if name != coffees[cid].name}
    if not changed:
        return
    # Judged on final names, archived coffees included, so two coffees may swap names but
    # no rename can leave two coffees that a later CSV upload would call "ambiguous".
    # A change of capitals alone adds no new clash, even beside an old duplicate.
    final_keys = {}
    for cid, name, roaster in db.session.execute(
            db.select(TastingCoffee.id, TastingCoffee.name, TastingCoffee.roaster)
            .where(TastingCoffee.group_id == group_id)):
        final_keys[cid] = coffee_key(changed.get(cid, name), roaster)
    taken = list(final_keys.values())
    for cid, new_name in changed.items():
        same_key = final_keys[cid] == coffee_key(coffees[cid].name, coffees[cid].roaster)
        if not same_key and taken.count(final_keys[cid]) > 1:
            raise TastingValidationError("cups", f"another coffee is already called {new_name}")
    for cid, name in changed.items():
        trepo.update_coffee(coffees[cid], {"name": name})


def _write_cups(flight: TastingFlight, ids: list, labels: list, current: dict) -> None:
    for coffee_id, fc in current.items():
        if coffee_id not in ids:
            flight.coffees.remove(fc)
    db.session.flush()
    for fc in flight.coffees:
        fc.position += _TEMP_POSITION_OFFSET
    db.session.flush()
    for i, (coffee_id, label) in enumerate(zip(ids, labels)):
        fc = current.get(coffee_id)
        if fc is None:
            flight.coffees.append(TastingFlightCoffee(coffee_id=coffee_id, position=i + 1, blind_label=label))
        else:
            fc.position = i + 1
            fc.blind_label = label
    db.session.flush()
    # The relationship's order_by only applies on load.
    db.session.expire(flight, ["coffees"])
