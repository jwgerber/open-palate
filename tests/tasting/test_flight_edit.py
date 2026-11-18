"""PUT /api/tasting/flights/<id>/cups: the host's pre-tasting edit of a blind flight.
Labels stay with slots; any read, a started timer or a closed flight locks it."""
import datetime

import pytest

from extensions import db
from tasting import flights_repository as frepo
from tasting.models import TastingCoffee, TastingFlight, TastingFlightCoffee
from tasting.repository import TasterIdentity
from tests.tasting.helpers import make_tasting
from tests.tasting.world import World


@pytest.fixture
def world(db_session, app):
    return World(app)


@pytest.fixture
def seed(world):
    a = world.coffee(name="Alpha", roaster="Roastery", kind="cupping_lot")
    b = world.coffee(name="Bravo", roaster="Roastery", kind="cupping_lot")
    c = world.coffee(name="Charlie", roaster="Other Roastery", kind="cupping_lot")
    return {"a": a.id, "b": b.id, "c": c.id}


HOST = "editor"


def open_flight(world, ids, who=HOST, blind=True, sheet="advanced"):
    body = {"coffee_ids": ids, "prep": "cupping", "shared": True, "blind": blind, "sheet": sheet}
    r = world.send(who, "post", "/flights", json=body)
    assert r.status_code == 201, r.get_json()
    return r.get_json()["id"]


def custom_flight(world, ids, labels):
    user, member = world.members[HOST]
    who = TasterIdentity(user_id=user.id, member_id=member.id, taster_key=f"user:{user.id}",
                         name="Editor", created_via="account")
    flight = frepo.create_flight(world.group.id, {"coffee_ids": ids, "prep": "cupping", "shared": True,
                                                  "blind": True, "sheet": "advanced"},
                                 who, blind_labels=labels)
    db.session.commit()
    return flight.id


def put(world, fid, body, who=HOST):
    return world.send(who, "put", f"/flights/{fid}/cups", json=body)


def cups_body(*ids, **extra):
    return {"cups": [{"coffee_id": i} for i in ids], **extra}


def key(world, fid, who=HOST):
    r = world.get(who, f"/flights/{fid}/label-key")
    assert r.status_code == 200, r.get_json()
    return [(c["label"], c["coffee_id"]) for c in r.get_json()["cups"]]


class TestEdits:
    def test_reorder_keeps_labels_on_slots(self, world, seed):
        fid = open_flight(world, [seed["a"], seed["b"]])
        r = put(world, fid, cups_body(seed["b"], seed["a"]))
        assert r.status_code == 200, r.get_json()
        assert [(c["label"], c["coffee_id"]) for c in r.get_json()["cups"]] == [
            ("Cup A", seed["b"]), ("Cup B", seed["a"])]
        assert key(world, fid) == [("Cup A", seed["b"]), ("Cup B", seed["a"])]

    def test_swap_of_three(self, world, seed):
        fid = open_flight(world, [seed["a"], seed["b"], seed["c"]])
        assert put(world, fid, cups_body(seed["c"], seed["a"], seed["b"])).status_code == 200
        assert key(world, fid) == [("Cup A", seed["c"]), ("Cup B", seed["a"]), ("Cup C", seed["b"])]

    @pytest.mark.parametrize("drop", ["a", "b", "c"])
    def test_remove_cup_drops_last_label_and_keeps_coffee(self, world, seed, drop):
        ids = [seed["a"], seed["b"], seed["c"]]
        fid = open_flight(world, ids)
        keep = [i for i in ids if i != seed[drop]]
        assert put(world, fid, cups_body(*keep)).status_code == 200
        assert key(world, fid) == [("Cup A", keep[0]), ("Cup B", keep[1])]
        assert db.session.get(TastingCoffee, seed[drop]) is not None

    def test_save_is_committed(self, world, seed):
        fid = open_flight(world, [seed["a"], seed["b"]])
        body = {"cups": [{"coffee_id": seed["b"], "name": "Bravo two"}, {"coffee_id": seed["a"]}]}
        assert put(world, fid, body).status_code == 200
        db.session.rollback()
        assert key(world, fid) == [("Cup A", seed["b"]), ("Cup B", seed["a"])]
        assert db.session.get(TastingCoffee, seed["b"]).name == "Bravo two"

    def test_add_takes_next_letter_and_null_labels_count_as_lettered(self, world, seed):
        fid = open_flight(world, [seed["a"], seed["b"]])
        for row in TastingFlightCoffee.query.filter_by(flight_id=fid):
            row.blind_label = None
        db.session.commit()
        assert put(world, fid, cups_body(seed["b"], seed["a"], seed["c"])).status_code == 200
        assert key(world, fid) == [("Cup A", seed["b"]), ("Cup B", seed["a"]), ("Cup C", seed["c"])]

    def test_custom_labels(self, world, seed):
        fid = custom_flight(world, [seed["a"], seed["b"]], ["H1", "H2"])
        body = cups_body(seed["a"], seed["b"], seed["c"])
        assert put(world, fid, body).status_code == 400
        assert put(world, fid, {**body, "new_labels": ["H3"]}).status_code == 200
        assert key(world, fid)[-1] == ("Cup H3", seed["c"])
        assert put(world, fid, cups_body(seed["b"], seed["a"])).status_code == 200
        assert key(world, fid) == [("Cup H1", seed["b"]), ("Cup H2", seed["a"])]

    def test_window_and_identity_unchanged(self, world, seed):
        fid = open_flight(world, [seed["a"], seed["b"]])
        f = db.session.get(TastingFlight, fid)
        before = (f.closes_at, f.opened_at, f.host_user_id, f.host_member_id, f.name, f.is_open)
        assert put(world, fid, cups_body(seed["b"], seed["c"])).status_code == 200
        db.session.expire_all()
        f = db.session.get(TastingFlight, fid)
        assert (f.closes_at, f.opened_at, f.host_user_id, f.host_member_id, f.name, f.is_open) == before

    def test_flight_dict_still_blind_after_edit(self, world, seed):
        fid = open_flight(world, [seed["a"], seed["b"]])
        assert put(world, fid, cups_body(seed["b"], seed["a"], seed["c"])).status_code == 200
        cups = world.get(HOST, f"/flights/{fid}").get_json()["cups"]
        assert [c["label"] for c in cups] == ["Cup A", "Cup B", "Cup C"]
        assert all(c["coffee_id"] is None and c["name"] is None and c["kind"] is None for c in cups)

    def test_archived_new_coffee_400_archived_existing_ok(self, world, seed):
        fid = open_flight(world, [seed["a"], seed["b"]])
        db.session.get(TastingCoffee, seed["b"]).archived_at = datetime.datetime(2026, 1, 1)
        db.session.get(TastingCoffee, seed["c"]).archived_at = datetime.datetime(2026, 1, 1)
        db.session.commit()
        assert put(world, fid, cups_body(seed["a"], seed["b"], seed["c"])).status_code == 400
        assert put(world, fid, cups_body(seed["b"], seed["a"])).status_code == 200

    def test_cap_is_26_cups(self, world, seed):
        more = [world.coffee(name=f"Extra {i}", roaster="Roastery").id for i in range(25)]
        fid = open_flight(world, [seed["a"]])
        ids = [seed["a"], *more]
        assert put(world, fid, cups_body(*ids)).status_code == 200
        assert key(world, fid)[-1][0] == "Cup Z"
        assert put(world, fid, cups_body(*ids, seed["b"])).status_code == 400

    def test_another_groups_coffee_is_404(self, world, seed):
        theirs = world.coffee(world.other, name="Theirs")
        fid = open_flight(world, [seed["a"]])
        r = put(world, fid, cups_body(seed["a"], theirs.id))
        assert r.status_code == 404 and r.get_json()["error"] == "Coffee not found"
        assert key(world, fid) == [("Cup A", seed["a"])]


class TestRename:
    def rename(self, world, fid, cid, name, *others):
        return put(world, fid, {"cups": [{"coffee_id": cid, "name": name}, *[{"coffee_id": o} for o in others]]})

    def test_rename_changes_coffee(self, world, seed):
        fid = open_flight(world, [seed["a"], seed["b"]])
        r = self.rename(world, fid, seed["a"], "  Alpha Lot 2 ", seed["b"])
        assert r.status_code == 200 and r.get_json()["cups"][0]["name"] == "Alpha Lot 2"

    def test_collisions(self, world, seed):
        fid = open_flight(world, [seed["a"], seed["b"]])
        assert self.rename(world, fid, seed["a"], "bravo", seed["b"]).status_code == 400
        assert self.rename(world, fid, seed["a"], "ALPHA", seed["b"]).status_code == 200
        assert self.rename(world, fid, seed["a"], "Charlie", seed["b"]).status_code == 200   # other roaster
        r = put(world, fid, {"cups": [{"coffee_id": seed["a"], "name": "Same"},
                                      {"coffee_id": seed["b"], "name": "same"}]})
        assert r.status_code == 400
        r = put(world, fid, {"cups": [{"coffee_id": seed["a"], "name": "Bravo"},
                                      {"coffee_id": seed["b"], "name": "Alpha"}]})
        assert r.status_code == 200

    def test_another_groups_coffee_does_not_collide(self, world, seed):
        world.coffee(world.other, name="Bravo Two", roaster="Roastery")
        fid = open_flight(world, [seed["a"]])
        assert self.rename(world, fid, seed["a"], "Bravo Two").status_code == 200

    @pytest.mark.parametrize("name", ["", "   ", None, 5, "x" * 256])
    def test_rename_blank_or_not_text_400(self, world, seed, name):
        fid = open_flight(world, [seed["a"]])
        assert self.rename(world, fid, seed["a"], name).status_code == 400

    def test_name_on_added_cup_400(self, world, seed):
        fid = open_flight(world, [seed["a"]])
        r = put(world, fid, {"cups": [{"coffee_id": seed["a"]}, {"coffee_id": seed["b"], "name": "New"}]})
        assert r.status_code == 400 and db.session.get(TastingCoffee, seed["b"]).name == "Bravo"


class TestValidation:
    @pytest.mark.parametrize("body", [
        {}, {"cups": []}, {"cups": "x"}, {"cups": [1]}, {"cups": [{}]},
        {"cups": [{"coffee_id": True}]}, {"cups": [{"coffee_id": "1"}]}, {"cups": [{"coffee_id": 2 ** 40}]},
    ])
    def test_junk_bodies_400(self, world, seed, body):
        fid = open_flight(world, [seed["a"]])
        assert put(world, fid, body).status_code == 400
        assert key(world, fid) == [("Cup A", seed["a"])]

    def test_unknown_coffee_is_404(self, world, seed):
        fid = open_flight(world, [seed["a"]])
        assert put(world, fid, cups_body(999999)).status_code == 404

    def test_repeats_and_labels(self, world, seed):
        fid = open_flight(world, [seed["a"]])
        assert put(world, fid, cups_body(seed["a"], seed["a"])).status_code == 400
        assert put(world, fid, cups_body(seed["a"], seed["b"], new_labels=["Z"])).status_code == 400
        assert put(world, fid, cups_body(seed["a"], seed["b"], new_labels=[])).status_code == 200

    @pytest.mark.parametrize("labels", [["H3", "H4"], ["ABCDE"], ["H-1"], [5], "H3", ["h1"], ["H2"]])
    def test_bad_new_labels_400(self, world, seed, labels):
        fid = custom_flight(world, [seed["a"], seed["b"]], ["H1", "H2"])
        assert put(world, fid, cups_body(seed["a"], seed["b"], seed["c"], new_labels=labels)).status_code == 400
        assert len(key(world, fid)) == 2

    def test_bad_labels_keep_a_valid_rename_from_being_written(self, world, seed):
        fid = custom_flight(world, [seed["a"], seed["b"]], ["H1", "H2"])
        r = put(world, fid, {"cups": [{"coffee_id": seed["a"], "name": "Renamed"}, {"coffee_id": seed["b"]},
                                      {"coffee_id": seed["c"]}], "new_labels": ["bad-label"]})
        assert r.status_code == 400
        db.session.expire_all()
        assert db.session.get(TastingCoffee, seed["a"]).name == "Alpha"


class TestLock:
    def assert_locked(self, world, fid, seed):
        r = put(world, fid, {"cups": [{"coffee_id": seed["a"], "name": "Changed"}, {"coffee_id": seed["b"]}]})
        assert r.status_code == 409 and r.get_json()["error"] == "flight_locked" and r.get_json()["message"]
        db.session.expire_all()
        assert db.session.get(TastingCoffee, seed["a"]).name == "Alpha"

    def test_locked_by_live_or_paper_read(self, world, seed):
        for via in ("account", "paper"):
            fid = open_flight(world, [seed["a"], seed["b"]])
            make_tasting(db.session, db.session.get(TastingFlight, fid), db.session.get(TastingCoffee, seed["a"]),
                         adv=8.0, created_via=via, taster_key=f"paper:name:{via}")
            db.session.commit()
            self.assert_locked(world, fid, seed)

    def test_locked_by_timer_or_close(self, world, seed):
        fid = open_flight(world, [seed["a"], seed["b"]])
        assert world.send(HOST, "post", f"/flights/{fid}/timer").status_code == 200
        self.assert_locked(world, fid, seed)
        fid = open_flight(world, [seed["a"], seed["b"]])
        assert world.close(fid, HOST).status_code == 200
        self.assert_locked(world, fid, seed)
        fid = open_flight(world, [seed["a"], seed["b"]])
        db.session.get(TastingFlight, fid).closes_at = datetime.datetime(2020, 1, 1)
        db.session.commit()
        self.assert_locked(world, fid, seed)


class TestGate:
    def test_non_host_403(self, world, seed):
        fid = open_flight(world, [seed["a"], seed["b"]])
        assert put(world, fid, cups_body(seed["b"], seed["a"]), who="admin").status_code == 403
        assert key(world, fid) == [("Cup A", seed["a"]), ("Cup B", seed["b"])]

    def test_device_403_at_the_decorator_even_as_the_host(self, world, seed):
        mid = world.member_id("member")
        fid = world.open_flight([world.coffee(name="X"), world.coffee(name="Y")], who="device", pick=mid,
                                blind=True, sheet="advanced")
        r = put(world, fid, {"cups": [], "member_id": mid}, who="device")
        assert r.status_code == 403 and r.get_json() == {"error": "forbidden"}

    def test_member_host_may_reorder_not_rename(self, world, seed):
        fid = open_flight(world, [seed["a"], seed["b"]], who="member")
        assert put(world, fid, cups_body(seed["b"], seed["a"]), who="member").status_code == 200
        r = put(world, fid, {"cups": [{"coffee_id": seed["a"], "name": "Nope"}, {"coffee_id": seed["b"]}]},
                who="member")
        assert r.status_code == 403 and db.session.get(TastingCoffee, seed["a"]).name == "Alpha"

    def test_sighted_409_basic_blind_ok_missing_404(self, world, seed):
        fid = open_flight(world, [seed["a"]], blind=False)
        r = put(world, fid, cups_body(seed["a"]))
        assert r.status_code == 409 and r.get_json()["error"] == "not_blind"
        fid = open_flight(world, [seed["a"], seed["b"]], sheet=None)
        assert put(world, fid, cups_body(seed["b"], seed["a"])).status_code == 200
        assert put(world, 999999, cups_body(seed["a"])).status_code == 404
