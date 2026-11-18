"""Load and remove sample data: /api/group/sample-data."""
import pytest

from extensions import db
from identity.models import Member
from tasting import sample_data
from tasting.models import Tasting, TastingCoffee, TastingFlight
from tests.tasting.world import BASE, World, entry

URL = "/api/group/sample-data"


@pytest.fixture
def w(db_session, app):
    return World(app)


def load(w, who="admin"):
    return w.clients[who].post(URL, headers=w.headers[who])


def remove(w, who="admin"):
    return w.clients[who].delete(URL, headers=w.headers[who])


def gid(w):
    return w.group.id


def test_load_adds_the_set(w):
    r = load(w)
    assert r.status_code == 201
    assert r.get_json() == {"coffees": 5, "members": 3, "flights": 1}
    coffees = TastingCoffee.query.filter_by(group_id=gid(w)).all()
    assert len(coffees) == 5 and all(c.is_sample for c in coffees)
    members = Member.query.filter_by(group_id=gid(w), is_sample=True).all()
    assert sorted(m.display_name for m in members) == ["Sample · Jo", "Sample · Robin", "Sample · Sam"]
    assert all(m.email is None and m.user_id is None and m.role == "member" for m in members)
    (flight,) = TastingFlight.query.filter_by(group_id=gid(w)).all()
    assert flight.is_sample and flight.is_shared and flight.is_blind and flight.sheet == "basic"
    assert not flight.is_open and flight.closed_at is not None
    assert flight.host_member_id == w.member_id("admin")
    assert len(flight.coffees) == 4
    assert len(flight.tastings) == 12
    assert {t.member_id for t in flight.tastings} == {m.id for m in members}
    assert all(2 <= len(t.tags) <= 3 for t in flight.tastings)


def test_coffee_pages_show_consensus(w):
    load(w)
    flight = TastingFlight.query.filter_by(group_id=gid(w)).one()
    cid = flight.coffees[0].coffee_id
    body = w.get("admin", f"/coffees/{cid}").get_json()
    assert body["consensus"]["n"] == 3


def test_load_refused_when_not_empty(w):
    w.coffee()
    r = load(w)
    assert r.status_code == 409 and r.get_json()["error"] == "not_empty"


def test_load_refused_when_only_archived_coffees(w):
    import datetime
    w.coffee(archived_at=datetime.datetime(2026, 1, 1))
    r = load(w)
    assert r.status_code == 409 and r.get_json()["error"] == "not_empty"


def test_load_twice_409_already_loaded(w):
    assert load(w).status_code == 201
    r = load(w)
    assert r.status_code == 409 and r.get_json()["error"] == "already_loaded"


def test_group_reports_sample_data(w):
    assert w.clients["admin"].get("/api/group").get_json()["sample_data"] is False
    load(w)
    assert w.clients["admin"].get("/api/group").get_json()["sample_data"] is True
    remove(w)
    assert w.clients["admin"].get("/api/group").get_json()["sample_data"] is False


def test_remove_deletes_only_sample_rows(w):
    load(w)
    real_coffee = w.coffee(name="Real one")
    real_member = w.roster_only("Real Person")
    assert w.solo([real_coffee], who="member").status_code == 201
    r = remove(w)
    assert r.status_code == 200
    assert r.get_json() == {"flights": 1, "members": 3, "coffees": 5, "kept_coffees": 0}
    assert db.session.get(TastingCoffee, real_coffee.id) is not None
    assert db.session.get(Member, real_member.id) is not None
    assert TastingFlight.query.filter_by(is_sample=False).count() == 1
    assert Tasting.query.count() == 1
    assert not TastingFlight.query.filter_by(is_sample=True).count()
    assert not Member.query.filter_by(is_sample=True).count()
    assert not TastingCoffee.query.filter_by(is_sample=True).count()


def test_remove_keeps_sample_coffee_in_a_real_open_flight(w):
    load(w)
    sample = TastingCoffee.query.filter_by(group_id=gid(w)).first()
    sample_id = sample.id
    fid = w.open_flight([sample], who="member")
    out = remove(w).get_json()
    assert out["kept_coffees"] == 1 and out["coffees"] == 4
    assert db.session.get(TastingCoffee, sample_id).is_sample is False
    flight = db.session.get(TastingFlight, fid)
    assert flight is not None and [fc.coffee_id for fc in flight.coffees] == [sample_id]


def test_remove_keeps_sample_coffee_with_a_real_tasting(w):
    load(w)
    sample = TastingCoffee.query.filter_by(group_id=gid(w)).first()
    sample_id = sample.id
    r = w.solo([sample], who="member")
    assert r.status_code == 201, r.get_json()
    out = remove(w).get_json()
    assert out["kept_coffees"] == 1 and out["coffees"] == 4
    kept = db.session.get(TastingCoffee, sample_id)
    assert kept is not None and kept.is_sample is False
    assert Tasting.query.filter_by(coffee_id=sample_id).count() == 1


def test_sample_reads_not_in_palates(w):
    load(w)
    sample = TastingCoffee.query.filter_by(group_id=gid(w)).first()
    assert w.solo([sample], who="member", entries=[entry(sample.id)]).status_code == 201
    admin = w.get("admin", "/palate").get_json()
    assert admin["tastings"] == 0 and admin["coffees_tasted"] == []
    mine = w.get("member", "/palate").get_json()
    assert mine["tastings"] == 1 and mine["coffees"] == 1


def test_remove_when_nothing_loaded_is_a_noop(w):
    assert remove(w).get_json() == {"flights": 0, "members": 0, "coffees": 0, "kept_coffees": 0}


@pytest.mark.parametrize("who", ["editor", "member", "device"])
def test_routes_admin_only(w, who):
    assert load(w, who).status_code == 403
    assert remove(w, who).status_code == 403
    assert not TastingCoffee.query.count()


def test_load_is_atomic(w, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("boom")
    monkeypatch.setattr(sample_data, "_add_flight", boom)
    assert load(w).status_code == 500
    assert not TastingCoffee.query.count()
    assert not Member.query.filter_by(is_sample=True).count()
    assert not TastingFlight.query.count()
