"""Builders for tasting tests."""
import datetime
import uuid

from identity.models import Group, Member, User
from tasting.enums import ADV_CATEGORIES


def make_group(db_session, name="Cafe"):
    group = Group(name=name)
    db_session.add(group)
    db_session.flush()
    return group


def make_user(db_session, email=None):
    user = User(email=email or f"u{uuid.uuid4().hex[:8]}@example.com", display_name="Taster")
    db_session.add(user)
    db_session.flush()
    return user


def make_member(db_session, group, name="Kelley", **kw):
    member = Member(group_id=group.id, display_name=name, role=kw.pop("role", "member"), **kw)
    db_session.add(member)
    db_session.flush()
    return member


def make_coffee(db_session, group, name=None, roaster="Roaster", kind="house", **kw):
    from tasting.models import TastingCoffee
    coffee = TastingCoffee(group_id=group.id, name=name or f"Coffee {uuid.uuid4().hex[:6]}",
                           roaster=roaster, kind=kind, **kw)
    db_session.add(coffee)
    db_session.flush()
    return coffee


def make_flight(db_session, group, coffees, **kw):
    from tasting.models import TastingFlight, TastingFlightCoffee
    now = datetime.datetime(2026, 9, 10, 14, 0, 0)
    defaults = dict(group_id=group.id, prep="drip", host_name="Kelley",
                    opened_at=now, closes_at=now + datetime.timedelta(hours=24))
    defaults.update(kw)
    flight = TastingFlight(**defaults)
    for i, coffee in enumerate(coffees, start=1):
        flight.coffees.append(TastingFlightCoffee(coffee_id=coffee.id, position=i))
    db_session.add(flight)
    db_session.flush()
    return flight


def make_tasting(db_session, flight, coffee, adv=None, **kw):
    """`adv=<score>` makes an advanced read: every category at that score, no Overall."""
    from tasting.models import Tasting
    if adv is not None:
        kw = {"sheet": "advanced", "overall": None, "bar_vote": kw.pop("bar_vote", "yes"),
              **{f"adv_{c}": adv for c in ADV_CATEGORIES}, **kw}
    defaults = dict(flight_id=flight.id, coffee_id=coffee.id,
                    taster_key=f"user:{uuid.uuid4().hex[:6]}", taster_name="Kelley", overall=4)
    defaults.update(kw)
    if adv is not None:
        defaults["overall"] = kw.get("overall")
    tasting = Tasting(**defaults)
    db_session.add(tasting)
    db_session.flush()
    return tasting
