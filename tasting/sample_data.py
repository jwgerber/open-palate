"""Sample data for a new group: a few invented coffees, three sample tasters and one
closed shared flight, so the Coffees and palate pages have something to show.

Everything goes through the real repository validation, so a sample read obeys every
rule a real read does. Every row is flagged ``is_sample`` (a flight's tastings belong
to the flight) so ``remove_sample_data`` can take it all back out.
"""
from extensions import db
from identity.access import Actor
from identity.models import Member
from tasting import flights_repository as flights
from tasting import repository as repo
from tasting.models import Tasting, TastingCoffee, TastingFlight, TastingFlightCoffee

SAMPLE_MEMBERS = ("Sample · Robin", "Sample · Sam", "Sample · Jo")

# Roasters are invented. Flavors are lexicon path keys (strength 2 = picked).
COFFEES = (
    {"name": "Morning Ridge", "roaster": "Tallgrass Roasting Co.", "origin": "Ethiopia", "region": "Guji",
     "process": "washed", "roast_level": "light", "kind": "external",
     "notes": "Floral and bright; a good first cup for a flight."},
    {"name": "Bramble Lane", "roaster": "Harbor Fern Coffee", "origin": "Kenya", "region": "Nyeri",
     "process": "washed", "roast_level": "light", "kind": "external",
     "notes": "Juicy and sparkling, with a berry-like acidity."},
    {"name": "Low Tide", "roaster": "Tallgrass Roasting Co.", "origin": "Colombia", "region": "Huila",
     "process": "honey", "roast_level": "medium", "kind": "external",
     "notes": "Round and sweet, easy to drink."},
    {"name": "Cinder Hill", "roaster": "Quarry & Kettle", "origin": "Brazil", "region": "Cerrado",
     "process": "natural", "roast_level": "med_dark", "kind": "external",
     "notes": "Chocolatey and low in acidity."},
    {"name": "Paper Lantern", "roaster": "Harbor Fern Coffee", "origin": "Guatemala", "region": "Huehuetenango",
     "process": "washed", "roast_level": "medium", "kind": "external",
     "notes": "Not in the sample flight, so its page shows no averages yet."},
)
FLIGHT_COFFEES = 4

# READS[cup][taster] = (acidity, sweetness, body, balance, overall, flavors)
READS = (
    ((5, 3, 2, 4, 4, ("Floral>Floral>jasmine", "Fruity>Citrus>lemon")),
     (4, 3, 2, 4, 5, ("Floral>Floral>jasmine", "Fruity>Citrus>orange")),
     (5, 2, 2, 3, 4, ("Fruity>Citrus>lemon", "Sweet>Brown sugar>honey"))),
    ((5, 4, 3, 4, 5, ("Fruity>Berry>blueberry", "Fruity>Other fruit>cherry")),
     (5, 3, 3, 4, 4, ("Fruity>Berry>blueberry", "Sweet>Brown sugar>honey")),
     (4, 4, 3, 5, 5, ("Fruity>Berry>blueberry", "Fruity>Other fruit>peach"))),
    ((3, 4, 4, 4, 4, ("Sweet>Brown sugar>honey", "Fruity>Other fruit>peach")),
     (3, 5, 4, 4, 4, ("Sweet>Brown sugar>honey", "Nutty / Cocoa>Nutty>hazelnut")),
     (2, 4, 4, 3, 3, ("Sweet>Brown sugar>honey", "Nutty / Cocoa>Cocoa>milk chocolate"))),
    ((2, 3, 5, 3, 3, ("Nutty / Cocoa>Cocoa>dark chocolate", "Nutty / Cocoa>Nutty>almond")),
     (2, 3, 5, 4, 3, ("Nutty / Cocoa>Cocoa>dark chocolate", "Nutty / Cocoa>Cocoa>milk chocolate")),
     (1, 2, 5, 3, 2, ("Nutty / Cocoa>Cocoa>dark chocolate", "Nutty / Cocoa>Nutty>hazelnut"))),
)


class SampleDataError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def has_sample_data(group_id: int) -> bool:
    for model in (Member, TastingCoffee, TastingFlight):
        if db.session.execute(db.select(model.id).where(
                model.group_id == group_id, model.is_sample.is_(True)).limit(1)).first():
            return True
    return False


def _has_any_coffee(group_id: int) -> bool:
    return db.session.execute(
        db.select(TastingCoffee.id).where(TastingCoffee.group_id == group_id).limit(1)).first() is not None


def _add_members(group_id: int) -> list:
    members = [Member(group_id=group_id, display_name=name, role="member", is_sample=True)
               for name in SAMPLE_MEMBERS]
    db.session.add_all(members)
    db.session.flush()
    return members


def _sample_taster(member: Member) -> repo.TasterIdentity:
    return repo.TasterIdentity(user_id=None, member_id=member.id, taster_key=f"member:{member.id}",
                               name=member.display_name, created_via="device")


def _add_flight(group_id: int, admin: Actor, coffees: list, members: list) -> TastingFlight:
    cups = coffees[:FLIGHT_COFFEES]
    flight = flights.create_flight(
        group_id, {"coffee_ids": [c.id for c in cups], "prep": "cupping", "shared": True,
                   "blind": True, "name": "Sample flight"}, repo.TasterIdentity.from_actor(admin))
    flight.is_sample = True
    for t, member in enumerate(members):
        entries = [{"position": i + 1, "acidity": r[t][0], "sweetness": r[t][1], "body": r[t][2],
                    "balance": r[t][3], "overall": r[t][4], "tags": {k: 2 for k in r[t][5]}}
                   for i, r in enumerate(READS)]
        flights.log_tastings(flight, entries, _sample_taster(member))
    flights.close_flight(flight)
    return flight


def _still_used(coffee_id: int) -> bool:
    """Any read or any flight cup (a real open flight may hold it unread) keeps a coffee."""
    return any(db.session.execute(db.select(m.coffee_id).where(m.coffee_id == coffee_id).limit(1)).first()
               for m in (Tasting, TastingFlightCoffee))


def load_sample_data(group_id: int, admin: Actor) -> dict:
    """Add the sample set in the caller's transaction (flushes, never commits), so a
    failure leaves nothing behind once the caller rolls back."""
    if has_sample_data(group_id):
        raise SampleDataError("already_loaded")
    if _has_any_coffee(group_id):
        raise SampleDataError("not_empty")
    coffees = []
    for data in COFFEES:
        coffee = repo.create_coffee(group_id, data, created_by=admin.user_id)
        coffee.is_sample = True
        coffees.append(coffee)
    members = _add_members(group_id)
    _add_flight(group_id, admin, coffees, members)
    return {"coffees": len(coffees), "members": len(members), "flights": 1}


def remove_sample_data(group_id: int) -> dict:
    """Delete sample flights (with their reads), then sample members, then sample
    coffees. A sample coffee a real tasting still points at is kept and unflagged."""
    removed = {"flights": 0, "members": 0, "coffees": 0}
    for flight in db.session.execute(db.select(TastingFlight).where(
            TastingFlight.group_id == group_id, TastingFlight.is_sample.is_(True))).scalars().all():
        flights.delete_flight(flight)
        removed["flights"] += 1
    for member in db.session.execute(db.select(Member).where(
            Member.group_id == group_id, Member.is_sample.is_(True))).scalars().all():
        db.session.delete(member)
        removed["members"] += 1
    db.session.flush()
    kept = 0
    for coffee in db.session.execute(db.select(TastingCoffee).where(
            TastingCoffee.group_id == group_id, TastingCoffee.is_sample.is_(True))).scalars().all():
        if _still_used(coffee.id):
            coffee.is_sample = False
            kept += 1
        else:
            db.session.delete(coffee)
            removed["coffees"] += 1
    db.session.flush()
    return {**removed, "kept_coffees": kept}
