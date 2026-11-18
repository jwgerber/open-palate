"""/api/tasting flight routes: solo and shared flights, the reveal, deletes,
the shared device, the palate, advanced cuppings (summary, CSV, timer, label key),
paper entry and group scoping."""
import datetime

import pytest

from extensions import db
from identity.models import Member
from tasting.enums import ADV_CATEGORIES
from tasting.models import Tasting, TastingFlight
from tests.tasting.helpers import make_flight, make_tasting
from tests.tasting.world import World, adv_entry, entry


@pytest.fixture
def world(db_session, app):
    return World(app)


@pytest.fixture
def cs(world):
    return {"guji": world.coffee(name="Guji Shakiso", roaster="Barrington"),
            "winter": world.coffee(name="Winter Blend", roaster="Barrington"),
            "lot": world.coffee(name="Huila Lot 3", roaster="Roastery", kind="cupping_lot")}


class TestSoloFlights:
    def test_validation(self, world, cs):
        g, w = cs["guji"].id, cs["winter"].id

        def bad(body, field):
            r = world.send("member", "post", "/flights", json=body)
            assert r.status_code == 400, r.get_json()
            assert r.get_json()["field"] == field, r.get_json()

        bad({"prep": "drip", "entries": []}, "coffee_ids")
        bad({"coffee_ids": [g, g], "prep": "drip"}, "coffee_ids")
        bad({"coffee_ids": [g], "prep": "aeropress"}, "prep")
        bad({"coffee_ids": [g], "prep": "drip"}, "entries")
        bad({"coffee_ids": [g, w], "prep": "drip", "entries": [entry(g)]}, "entries")
        bad({"coffee_ids": [g], "prep": "drip", "entries": [{"coffee_id": g}]}, "overall")
        bad({"coffee_ids": [g], "prep": "drip", "entries": [entry(g, overall=6)]}, "overall")
        bad({"coffee_ids": [g], "prep": "drip", "entries": [entry(g, acidity=0)]}, "acidity")
        bad({"coffee_ids": [g], "prep": "drip", "entries": [entry(g, tags={"blueberry": 2})]}, "entries")
        bad({"coffee_ids": [g], "prep": "drip", "entries": [entry(g, tags={"Fruity": 1})]}, "entries")
        six = {k: 2 for k in ("Fruity", "Floral", "Sweet", "Spices", "Roasted", "Other")}
        bad({"coffee_ids": [g], "prep": "drip", "entries": [entry(g, tags=six)]}, "entries")
        both = {"Fruity": 2, "Fruity>Berry>blueberry": 3}
        bad({"coffee_ids": [g], "prep": "drip", "entries": [entry(g, tags=both)]}, "entries")
        bad({"coffee_ids": [g], "prep": "drip", "entries": [entry(g, defects=["burnt"])]}, "entries")
        bad({"coffee_ids": [g], "prep": "drip", "entries": [entry(g)], "blind": True}, "blind")

    def test_unknown_coffee_ids_are_404(self, world, cs):
        for ids in ([999999], [2 ** 40]):
            r = world.solo([cs["guji"]], coffee_ids=ids)
            assert r.status_code == 404 and r.get_json()["error"] == "Coffee not found"

    def test_archived_coffee_cannot_be_logged_by_id(self, world, cs):
        assert world.send("editor", "post", f"/coffees/{cs['guji'].id}/archive").status_code == 200
        r = world.solo([cs["guji"]])
        assert r.status_code == 400 and r.get_json()["field"] == "coffee_ids"

    def test_logs_and_closes_in_one_write(self, world, cs, db_session):
        g, w = cs["guji"].id, cs["winter"].id
        r = world.solo([cs["winter"], cs["guji"]], prep="cupping", entries=[
            entry(w, 3, sweetness=4, tags={"Sweet>Brown sugar>caramelized": 3}),
            entry(g, 5, tags={"Fruity>Berry>blueberry": 3, "Floral": 2}, note="wow", defects=["papery"])])
        assert r.status_code == 201, r.get_json()
        body = r.get_json()
        assert body["is_open"] is False and body["is_shared"] is False
        assert [c["label"] for c in body["cups"]] == ["Winter Blend", "Guji Shakiso"]
        assert body["you_logged"] is True and body["is_host"] is True
        reveal = body["reveal"]
        assert reveal["cups"][1]["consensus"] is None and reveal["cups"][1]["n"] == 1
        yours = reveal["cups"][1]["yours"]
        assert yours["overall"] == 5 and yours["note"] == "wow" and yours["defects"] == ["papery"]
        assert yours["sentence"] == "Mostly blueberry, with a hint of Floral."
        flight = db_session.get(TastingFlight, body["id"])
        assert flight.closed_at is not None and flight.host_name == "Member"
        assert flight.group_id == world.group.id
        rows = db_session.query(Tasting).filter_by(flight_id=flight.id).all()
        uid, mid = world.user_id("member"), world.member_id("member")
        assert {(t.taster_key, t.user_id, t.member_id, t.created_via) for t in rows} == \
            {(f"user:{uid}", uid, mid, "account")}

    def test_recent_flights_are_mine_only_and_scoreless(self, world, cs):
        world.solo([cs["guji"]], who="editor")
        world.solo([cs["guji"], cs["winter"]])
        flights = world.get("member", "/flights/recent").get_json()["flights"]
        assert len(flights) == 1
        assert flights[0]["title"] == "Guji Shakiso · Winter Blend" and flights[0]["cup_count"] == 2
        assert "reveal" not in flights[0] and "overall" not in str(flights[0])


class TestSharedFlights:
    def _open(self, world, cs, blind=True, who="member"):
        r = world.send(who, "post", "/flights", json={
            "coffee_ids": [cs["lot"].id, cs["guji"].id], "prep": "cupping", "shared": True,
            "blind": blind, "name": "Samples"})
        assert r.status_code == 201, r.get_json()
        return r.get_json()

    def test_open_shared_blind_flight(self, world, cs):
        body = self._open(world, cs)
        assert body["is_open"] and body["is_shared"] and body["is_blind"] and "reveal" not in body
        assert [c["label"] for c in body["cups"]] == ["Cup A", "Cup B"]
        cup = body["cups"][0]
        assert cup["name"] is None and cup["coffee_id"] is None and cup["kind"] is None and cup["blind"]
        opened, closes = (datetime.datetime.fromisoformat(body[k]) for k in ("opened_at", "closes_at"))
        assert closes - opened == datetime.timedelta(hours=24)
        uid = world.user_id("member")
        assert body["roster"] == [{"taster_key": f"user:{uid}", "name": "Member", "is_host": True,
                                   "status": "tasting"}]

    def test_entries_refused_on_shared_create(self, world, cs):
        r = world.send("member", "post", "/flights", json={"coffee_ids": [cs["guji"].id], "prep": "drip",
                                                            "shared": True, "entries": [entry(cs["guji"].id)]})
        assert r.status_code == 400 and r.get_json()["field"] == "entries"

    def test_join_log_wait_close_reveal(self, world, cs):
        fid = self._open(world, cs)["id"]
        world.person("joiner", name="Sam")
        f = world.get("joiner", f"/flights/{fid}").get_json()
        assert f["is_host"] is False and f["cups"][0]["label"] == "Cup A"
        r = world.log(fid, [{"position": 1, "overall": 4, "tags": {"Fruity>Berry>blueberry": 3}},
                            {"position": 2, "overall": 2}], who="joiner")
        assert r.status_code == 201 and r.get_json()["you_logged"] and r.get_json()["logged_count"] == 1
        r = world.log(fid, [entry(cs["lot"].id), entry(cs["guji"].id)], who="joiner")
        assert r.status_code == 409 and r.get_json()["error"] == "already_logged"
        r = world.get("joiner", f"/flights/{fid}/reveal")
        assert r.status_code == 409 and r.get_json()["error"] == "flight_open"
        assert world.close(fid, "joiner").status_code == 403
        f = world.get("member", f"/flights/{fid}").get_json()
        assert f["cups"][0]["label"] == "Cup A"                     # the host is blind too
        assert [(x["name"], x["status"]) for x in f["roster"]] == [("Member", "tasting"), ("Sam", "logged")]
        assert world.log(fid, [entry(cs["lot"].id, 5, tags={"Fruity>Berry>blueberry": 2}),
                               entry(cs["guji"].id, 3)]).status_code == 201
        r = world.close(fid)
        assert r.status_code == 200 and r.get_json()["is_open"] is False
        assert [c["label"] for c in r.get_json()["cups"]] == ["Huila Lot 3", "Guji Shakiso"]
        cups = world.get("member", f"/flights/{fid}/reveal").get_json()["cups"]
        assert cups[0]["n"] == 2 and cups[0]["consensus"] is None and cups[0]["yours"]["overall"] == 5
        assert cups[0]["descriptors"] == [{"term": "Fruity>Berry>blueberry", "label": "blueberry",
                                           "family": "fruity", "kind": "yours", "pct": None}]
        world.person("late")
        r = world.log(fid, [entry(cs["lot"].id), entry(cs["guji"].id)], who="late")
        assert r.status_code == 409 and r.get_json()["error"] == "flight_closed"

    def test_reveal_409_while_open(self, world, cs):
        fid = self._open(world, cs, blind=False)["id"]
        world.log(fid, [entry(cs["lot"].id), entry(cs["guji"].id)])
        for who in ("member", "editor", "admin"):
            r = world.get(who, f"/flights/{fid}/reveal")
            assert r.status_code == 409 and r.get_json() == {
                "error": "flight_open", "message": "The reveal waits until the flight is closed"}
        r = world.get("device", f"/flights/{fid}/reveal?member_id={world.member_id('member')}")
        assert r.status_code == 409

    def test_reveal_shows_consensus_and_verdict_at_three(self, world, cs):
        fid = self._open(world, cs, blind=False)["id"]
        lot, guji = cs["lot"].id, cs["guji"].id
        for who in ("editor", "admin"):
            world.log(fid, [entry(lot, 5, tags={"Fruity>Berry>blueberry": 2}), entry(guji, 4)], who=who)
        world.log(fid, [entry(lot, 2, tags={"Floral": 2}), entry(guji, 4)])
        world.close(fid)
        cups = world.get("member", f"/flights/{fid}/reveal").get_json()["cups"]
        assert cups[0]["consensus"] == {"n": 3, "avg_overall": 4.0, "spread": 1.4, "histogram": [0, 1, 0, 0, 2]}
        assert cups[0]["verdict"].startswith("You were harder on it than most")
        assert [(d["label"], d["kind"], d["pct"]) for d in cups[0]["descriptors"]] == [
            ("Floral", "yours", None), ("blueberry", "others", 67)]
        assert cups[1]["verdict"] == "You landed with the room."

    def test_only_admin_may_close_any_flight(self, world, cs):
        fid = self._open(world, cs)["id"]
        assert world.close(fid, "editor").status_code == 403
        r = world.send("admin", "post", f"/flights/{fid}/close", json=[1, 2, 3])
        assert r.status_code == 400 and r.get_json()["field"] == "body"
        assert world.close(fid, "admin").status_code == 200
        assert world.close(fid, "admin").get_json()["error"] == "flight_closed"

    def test_auto_close_24h_and_48h_csv(self, world, cs, db_session):
        typed = self._open(world, cs)["id"]
        text = "flight,prep,roaster,name\nUp,cupping,Barrington,Guji Shakiso\n"
        up = _flight_import(world, text, '["Up"]').get_json()["flights"][0]["id"]
        for fid, hours in ((typed, 24), (up, 48)):
            f = db_session.get(TastingFlight, fid)
            assert f.closes_at - f.opened_at == datetime.timedelta(hours=hours)
            f.opened_at -= datetime.timedelta(hours=hours) - datetime.timedelta(minutes=1)
            f.closes_at -= datetime.timedelta(hours=hours) - datetime.timedelta(minutes=1)
            db_session.commit()
            assert world.get("member", f"/flights/{fid}").get_json()["is_open"] is True
            f.opened_at -= datetime.timedelta(minutes=2)
            f.closes_at -= datetime.timedelta(minutes=2)
            db_session.commit()
            body = world.get("member", f"/flights/{fid}").get_json()
            assert body["is_open"] is False and body["closed_at"] == f.closes_at.isoformat()
            assert body["cups"][0]["name"] is not None                        # names show after close
            db_session.expire_all()
            assert db_session.get(TastingFlight, fid).is_open is False      # the lazy close was committed

    def test_missing_flight_404s(self, world):
        assert world.get("member", "/flights/999999").status_code == 404
        assert world.log(999999, []).status_code == 404


class TestDeviceDoor:
    def test_device_must_pick_a_member(self, world, cs):
        r = world.solo([cs["guji"]], who="device")
        assert r.status_code == 400 and r.get_json()["field"] == "member_id"
        assert world.get("device", "/flights/recent").status_code == 400

    def test_device_write_stamps_member_and_linked_user(self, world, cs, db_session):
        mid, uid = world.member_id("member"), world.user_id("member")
        r = world.solo([cs["guji"]], who="device", pick=mid)
        assert r.status_code == 201, r.get_json()
        assert r.get_json()["created_via"] == "device" and r.get_json()["host_name"] == "Member"
        t = db_session.query(Tasting).one()
        assert (t.taster_key, t.member_id, t.user_id, t.created_via) == (f"member:{mid}", mid, uid, "device")
        f = db_session.get(TastingFlight, r.get_json()["id"])
        assert (f.host_member_id, f.host_user_id) == (mid, None)

    def test_a_person_may_not_pick(self, world, cs):
        r = world.solo([cs["guji"]], pick=world.member_id("editor"))
        assert r.status_code == 400 and r.get_json()["field"] == "member_id"

    def test_picks_outside_the_group_or_inactive(self, world, cs, db_session):
        assert world.solo([cs["guji"]], who="device", pick=world.member_id("outsider")).status_code == 404
        gone = world.roster_only("Gone")
        gone.active = False
        db_session.commit()
        r = world.solo([cs["guji"]], who="device", pick=gone.id)
        assert r.status_code == 422 and r.get_json()["error"] == "member_inactive"

    def test_device_then_phone_same_cup_conflicts(self, world, cs):
        fid = world.open_flight([cs["lot"], cs["guji"]], who="editor", prep="drip")
        mid = world.member_id("member")
        assert world.log(fid, [entry(cs["lot"].id), entry(cs["guji"].id)], who="device", pick=mid).status_code == 201
        assert world.get("member", f"/flights/{fid}").get_json()["you_logged"] is True
        r = world.log(fid, [entry(cs["lot"].id), entry(cs["guji"].id)])
        assert r.status_code == 409 and r.get_json()["error"] == "already_logged"

    def test_unique_index_race_maps_to_409(self, world, cs, monkeypatch):
        """Two taps racing past the Python check: the partial index answers 409."""
        from tasting import flights_repository as frepo
        fid = world.open_flight([cs["guji"]], who="editor", prep="drip")
        assert world.log(fid, [entry(cs["guji"].id)]).status_code == 201
        monkeypatch.setattr(frepo, "_already_logged", lambda flight, who: False)
        r = world.log(fid, [entry(cs["guji"].id)], who="device", pick=world.member_id("member"))
        assert r.status_code == 409 and r.get_json()["error"] == "already_logged"

    def test_device_reads_reveal_without_naming_anyone(self, world, cs):
        fid = world.solo([cs["guji"]], who="device", pick=world.member_id("member")).get_json()["id"]
        r = world.get("device", f"/flights/{fid}/reveal")
        assert r.status_code == 200 and all(c["yours"] is None for c in r.get_json()["cups"])
        r = world.get("device", f"/flights/{fid}/reveal?member_id={world.member_id('member')}")
        assert r.get_json()["cups"][0]["yours"]["overall"] == 4

    def test_device_may_not_delete(self, world, cs):
        mid = world.member_id("member")
        fid = world.solo([cs["guji"]], who="device", pick=mid).get_json()["id"]
        r = world.send("device", "delete", f"/flights/{fid}/tastings?member_id={mid}")
        assert r.status_code == 403 and "own phone" in r.get_json()["error"]
        assert world.send("device", "delete", f"/flights/{fid}?member_id={mid}").status_code == 403
        r = world.send("member", "delete", f"/flights/{fid}/tastings")
        assert r.status_code == 200 and r.get_json()["flight_deleted"] is True

    def test_device_recent_is_the_picked_members_device_flights(self, world, cs):
        world.solo([cs["guji"]], who="device", pick=world.member_id("member"))
        world.solo([cs["winter"]], who="device", pick=world.member_id("editor"))
        world.solo([cs["lot"]])          # the member's own phone flight
        r = world.get("device", f"/flights/recent?member_id={world.member_id('member')}")
        assert [f["title"] for f in r.get_json()["flights"]] == ["Guji Shakiso"]
        mine = world.get("member", "/flights/recent").get_json()["flights"]
        assert sorted(f["title"] for f in mine) == ["Guji Shakiso", "Huila Lot 3"]

    def test_device_host_powers_follow_the_member(self, world, cs):
        mid = world.member_id("member")
        fid = world.open_flight([cs["lot"], cs["guji"]], who="device", pick=mid, blind=True, sheet="advanced")
        assert world.close(fid, "device", pick=world.member_id("editor")).status_code == 403
        r = world.send("device", "post", f"/flights/{fid}/timer", json={"member_id": mid})
        assert r.status_code == 200 and r.get_json()["is_host"] is True
        # The linked account is the host on the account door: label key and close.
        assert world.get("member", f"/flights/{fid}/label-key").status_code == 200
        assert world.close(fid, "member").status_code == 200


class TestDelete:
    def _shared(self, world, cs):
        return world.open_flight([cs["guji"]], prep="cupping")

    def test_own_solo_flight_goes_entirely(self, world, cs):
        fid = world.solo([cs["guji"]]).get_json()["id"]
        r = world.send("member", "delete", f"/flights/{fid}/tastings")
        assert r.status_code == 200 and r.get_json() == {"deleted": 1, "flight_deleted": True}
        assert world.get("member", f"/flights/{fid}").status_code == 404
        assert world.send("member", "delete", f"/flights/{fid}/tastings").status_code == 404

    def test_joiner_removes_only_their_read_and_may_log_again(self, world, cs):
        g = cs["guji"].id
        fid = self._shared(world, cs)
        world.log(fid, [entry(g, 5)])
        assert world.log(fid, [entry(g, 2)], who="editor").status_code == 201
        r = world.send("editor", "delete", f"/flights/{fid}/tastings")
        assert r.get_json() == {"deleted": 1, "flight_deleted": False}
        f = world.get("editor", f"/flights/{fid}").get_json()
        assert f["logged_count"] == 1 and f["you_logged"] is False
        assert world.log(fid, [entry(g, 3)], who="editor").status_code == 201

    def test_revealed_read_needs_manage(self, world, cs):
        g = cs["guji"].id
        fid = self._shared(world, cs)
        world.person("joiner")
        world.log(fid, [entry(g, 3)])
        world.log(fid, [entry(g, 3)], who="joiner")
        world.close(fid)
        r = world.send("joiner", "delete", f"/flights/{fid}/tastings")
        assert r.status_code == 403 and "revealed" in r.get_json()["error"]
        key = f"user:{world.user_id('joiner')}"
        r = world.send("member", "delete", f"/flights/{fid}/tastings?taster_key={key}")
        assert r.status_code == 403 and "someone else" in r.get_json()["error"]
        assert world.send("editor", "delete", f"/flights/{fid}/tastings?taster_key={key}").status_code == 200

    def test_own_read_through_the_other_door_is_still_own(self, world, cs):
        mid = world.member_id("member")
        fid = world.solo([cs["guji"]], who="device", pick=mid).get_json()["id"]
        r = world.send("member", "delete", f"/flights/{fid}/tastings?taster_key=member:{mid}")
        assert r.status_code == 200 and r.get_json()["flight_deleted"] is True

    def test_whole_flight_host_only_while_nobody_else_logged(self, world, cs):
        fid = self._shared(world, cs)
        world.log(fid, [entry(cs["guji"].id, 2)], who="admin")
        r = world.send("member", "delete", f"/flights/{fid}")
        assert r.status_code == 403 and "Only the host" in r.get_json()["error"]
        r = world.send("editor", "delete", f"/flights/{fid}")
        assert r.status_code == 200 and r.get_json() == {"deleted": 1, "flight_deleted": True}
        fid2 = self._shared(world, cs)
        assert world.send("member", "delete", f"/flights/{fid2}").status_code == 200


class TestPalate:
    def test_floor(self, world):
        assert world.get("device", "/palate").status_code == 403
        assert world.anon.get("/api/tasting/palate").status_code == 401
        body = world.get("member", "/palate").get_json()
        assert body["tastings"] == 0 and body["bias"] is None and len(body["gap_series"]) == 6
        assert body["cupping"]["reads"] == 0

    def test_leave_one_out_bias_counts_device_reads_as_people(self, world, cs):
        g = cs["guji"]
        for who, ov in (("editor", 3), ("admin", 3), ("member", 5)):
            world.solo([g], who=who, entries=[entry(g.id, ov, tags={"Fruity>Berry>blueberry": 2, "Floral": 2})])
        world.solo([cs["winter"]])
        world.solo([g], who="device", pick=world.member_id("member"), entries=[entry(g.id, 3)])
        body = world.get("member", "/palate").get_json()
        assert body["tastings"] == 3 and body["coffees"] == 2
        assert body["terms_used"] == 2 and body["specific_terms"] == 1
        assert body["bias"] == 1.0 and body["bias_coffees"] == 1
        row = {c["name"]: c for c in body["coffees_tasted"]}["Guji Shakiso"]
        assert (row["yours"], row["theirs"], row["reads"]) == (4.0, 3.0, 2)

    def test_palate_includes_device_reads_after_link(self, world, cs, db_session):
        rowan = world.roster_only("Rowan")
        world.solo([cs["guji"]], who="device", pick=rowan.id, entries=[entry(cs["guji"].id, 5)])
        user, member = world.person("rowan-phone")
        # Linking: the account takes over the roster row the device picked.
        db_session.delete(member)
        db_session.flush()
        db_session.get(Member, rowan.id).user_id = user.id
        db_session.commit()
        body = world.get("rowan-phone", "/palate").get_json()
        assert body["tastings"] == 1 and body["coffees_tasted"][0]["name"] == "Guji Shakiso"


class TestInactiveMemberReadsKept:
    def test_inactive_member_not_pickable_reads_kept(self, world, cs, db_session):
        rowan = world.roster_only("Rowan")
        fid = world.open_flight([cs["guji"]], who="editor", prep="cupping", sheet="advanced")
        assert world.log(fid, [dict(adv_entry(), coffee_id=cs["guji"].id)], who="device",
                         pick=rowan.id).status_code == 201
        db_session.get(Member, rowan.id).active = False
        db_session.commit()
        assert world.log(fid, [dict(adv_entry(), coffee_id=cs["guji"].id)], who="device",
                         pick=rowan.id).status_code == 422
        world.close(fid, "editor")
        body = world.get("editor", f"/flights/{fid}/summary").get_json()
        assert [r["taster_name"] for r in body["coffees"][0]["reads"]] == ["Rowan"]
        assert world.get("editor", f"/flights/{fid}").get_json()["roster"][-1]["name"] == "Rowan"


class TestAdvancedRoutes:
    def test_create_log_and_no_scores_on_the_wire(self, world, cs):
        fid = world.open_flight([cs["guji"], cs["lot"]], sheet="advanced")
        r = world.log(fid, [dict(adv_entry(), coffee_id=cs["guji"].id)])
        assert r.status_code == 201
        for resp in (r, world.get("member", f"/flights/{fid}")):
            text = resp.get_data(as_text=True)
            assert resp.get_json()["sheet"] == "advanced" and resp.get_json()["adv_step"] == 0.5
            assert "bar_vote" not in text and "adv_aroma" not in text

    def test_bad_bodies(self, world, cs):
        fid = world.open_flight([cs["guji"]], sheet="advanced")
        assert world.log(fid, [entry(cs["guji"].id)]).status_code == 400
        body = {"coffee_ids": [cs["guji"].id], "prep": "cupping", "sheet": "advanced"}
        assert world.send("member", "post", "/flights", json=body).status_code == 400
        inf = '{"entries": [{"coffee_id": %d, "aroma": Infinity}]}' % cs["guji"].id
        r = world.send("member", "post", f"/flights/{fid}/tastings", data=inf, content_type="application/json")
        assert r.status_code == 400

    def test_reveal_is_use_summary(self, world, cs, db_session):
        f = make_flight(db_session, world.group, [cs["guji"]], sheet="advanced", adv_step=0.5,
                        prep="cupping", is_open=False)
        db_session.commit()
        r = world.get("member", f"/flights/{f.id}/reveal")
        assert r.status_code == 409 and r.get_json()["error"] == "use_summary"


class TestSummaryAndExport:
    @pytest.fixture
    def cup(self, world, cs, db_session):
        uid, mid = world.user_id("member"), world.member_id("member")
        f = make_flight(db_session, world.group, [cs["guji"]], sheet="advanced", adv_step=0.5, prep="cupping",
                        host_user_id=uid, host_member_id=mid, host_name="Member", is_open=False)
        world.read(f, cs["guji"], "member", adv=8.0)
        world.read(f, cs["guji"], "editor", adv=8.0, adv_acidity=7.0)
        world.read(f, cs["guji"], "admin", adv=8.0)
        db_session.commit()
        return f

    def test_account_host_and_managers_see_names(self, world, cup):
        for who in ("member", "editor", "admin"):
            body = world.get(who, f"/flights/{cup.id}/summary").get_json()
            assert body["named"] is True and body["coffees"][0]["dq"][0]["by"] == "Editor", who

    def test_non_host_member_and_device_get_no_names(self, world, cup):
        world.person("plain")
        world.read(cup, cup.coffees[0].coffee, "plain", adv=8.5)
        db.session.commit()
        for who, qs in (("plain", ""), ("device", f"?member_id={world.member_id('member')}")):
            body = world.get(who, f"/flights/{cup.id}/summary{qs}").get_json()
            assert body["named"] is False and body["coffees"][0]["reads"] is None, who
            assert "Editor" not in str(body["coffees"]) and body["yours"], who

    def test_open_is_409_and_basic_is_404(self, world, cs, db_session):
        f = make_flight(db_session, world.group, [cs["guji"]], sheet="advanced", adv_step=0.5, prep="cupping",
                        closes_at=datetime.datetime(2999, 1, 1))
        basic = make_flight(db_session, world.group, [cs["guji"]], is_open=False)
        db_session.commit()
        r = world.get("editor", f"/flights/{f.id}/summary")
        assert r.status_code == 409 and r.get_json()["error"] == "flight_open"
        assert world.get("editor", f"/flights/{f.id}/export.csv").status_code == 409
        assert world.get("member", f"/flights/{f.id}/export.csv").status_code == 403
        assert world.get("editor", f"/flights/{basic.id}/summary").status_code == 404
        assert world.get("editor", f"/flights/{basic.id}/export.csv").status_code == 404

    def test_export(self, world, cup):
        r = world.get("editor", f"/flights/{cup.id}/export.csv")
        assert r.status_code == 200 and r.mimetype == "text/csv"
        assert r.headers["Content-Disposition"] == f'attachment; filename="cupping-2026-09-10-{cup.id}.csv"'
        assert r.get_data(as_text=True).startswith("flight_name,")
        assert world.get("member", f"/flights/{cup.id}/export.csv").status_code == 200   # the host
        world.person("plain")
        r = world.get("plain", f"/flights/{cup.id}/export.csv")
        assert r.status_code == 403 and r.get_json()["error"] == "Only the host or a manager can export this cupping"
        assert world.get("device", f"/flights/{cup.id}/export.csv?member_id={world.member_id('member')}"
                         ).status_code == 403

    def test_export_lazy_expiry_is_committed(self, world, cs, db_session):
        f = make_flight(db_session, world.group, [cs["guji"]], sheet="advanced", adv_step=0.5, prep="cupping")
        world.read(f, cs["guji"], "member", adv=8.0)
        db_session.commit()
        assert world.get("editor", f"/flights/{f.id}/export.csv").status_code == 200
        db_session.expire_all()
        assert db_session.get(TastingFlight, f.id).is_open is False


class TestTimer:
    def test_host_or_manage(self, world, cs):
        fid = world.open_flight([cs["guji"], cs["lot"]], sheet="advanced")
        r = world.send("member", "post", f"/flights/{fid}/timer")
        assert r.status_code == 200 and r.get_json()["adv_pass"] == 0 and r.get_json()["timer_elapsed_s"] == 0
        world.person("plain")
        r = world.send("plain", "post", f"/flights/{fid}/timer")
        assert r.status_code == 403 and r.get_json() == {"error": "Only the host or an editor can run the timer"}
        assert world.send("editor", "post", f"/flights/{fid}/timer").status_code == 200

    def test_basic_missing_and_closed(self, world, cs):
        basic = world.open_flight([cs["guji"]])
        assert world.send("member", "post", f"/flights/{basic}/timer").status_code == 404
        assert world.send("member", "post", f"/flights/{basic}/pass", json={"pass": 1}).status_code == 404
        assert world.send("member", "post", "/flights/999999/timer").status_code == 404
        fid = world.open_flight([cs["guji"]], sheet="advanced")
        world.close(fid)
        r = world.send("member", "post", f"/flights/{fid}/timer")
        assert r.status_code == 409 and r.get_json()["error"] == "flight_closed"

    def test_pass_flow_and_validation(self, world, cs):
        fid = world.open_flight([cs["guji"]], sheet="advanced")
        r = world.send("member", "post", f"/flights/{fid}/pass", json={"pass": 1})
        assert r.status_code == 409 and r.get_json()["error"] == "timer_not_started"
        world.send("member", "post", f"/flights/{fid}/timer")
        for bad in ("2", 0, 4, True, None, 1.5):
            r = world.send("member", "post", f"/flights/{fid}/pass", json={"pass": bad})
            assert r.status_code == 400 and r.get_json()["field"] == "pass", bad
        for _ in range(2):
            r = world.send("member", "post", f"/flights/{fid}/pass", json={"pass": 2})
            assert r.status_code == 200 and r.get_json()["adv_pass"] == 2


class TestLabelKey:
    def test_host_gets_the_key_and_flight_stays_blind(self, world, cs):
        fid = world.open_flight([cs["lot"], cs["guji"]], blind=True, sheet="advanced")
        r = world.get("member", f"/flights/{fid}/label-key")
        assert r.status_code == 200
        cups = r.get_json()["cups"]
        assert [(c["position"], c["label"], c["coffee_id"]) for c in cups] == [
            (1, "Cup A", cs["lot"].id), (2, "Cup B", cs["guji"].id)]
        assert set(cups[0]) == {"position", "label", "coffee_id", "name", "roaster", "origin"}
        j = world.get("member", f"/flights/{fid}").get_data(as_text=True)
        assert "Huila" not in j and "Guji" not in j

    def test_refusals(self, world, cs):
        fid = world.open_flight([cs["lot"]], blind=True, sheet="advanced")
        r = world.get("editor", f"/flights/{fid}/label-key")
        assert r.status_code == 403 and r.get_json() == {"error": "Only the host can see the label key"}
        sighted = world.open_flight([cs["lot"]], sheet="advanced")
        r = world.get("member", f"/flights/{sighted}/label-key")
        assert r.status_code == 409 and r.get_json()["error"] == "not_blind"
        assert world.get("member", "/flights/999999/label-key").status_code == 404

    def test_device_cannot_read_palate_or_label_key(self, world, cs):
        mid = world.member_id("member")
        fid = world.open_flight([cs["lot"]], who="device", pick=mid, blind=True, sheet="advanced")
        for path in (f"/flights/{fid}/label-key?member_id={mid}", f"/palate?member_id={mid}"):
            r = world.get("device", path)
            assert r.status_code == 403 and r.get_json() == {"error": "forbidden"}, path
        r = world.send("device", "put", f"/flights/{fid}/cups", json={"cups": [{"coffee_id": cs["lot"].id}],
                                                                       "member_id": mid})
        assert r.status_code == 403


class TestPaperEntry:
    def _open(self, world, cs, who="member", pick=None, blind=False):
        return world.open_flight([cs["guji"], cs["lot"]], who=who, pick=pick, blind=blind, sheet="advanced")

    @staticmethod
    def _entries():
        return [dict(adv_entry(vote="maybe"), position=p) for p in (1, 2)]

    def _paper(self, world, fid, who="editor", **body):
        body.setdefault("entries", self._entries())
        return world.send(who, "post", f"/flights/{fid}/paper", json=body)

    def test_editor_enters_guest_sheet_on_open_blind_flight(self, world, cs, db_session):
        fid = self._open(world, cs, blind=True)
        r = self._paper(world, fid, guest_name="  Sam  ")
        assert r.status_code == 201, r.get_json()
        assert r.get_json() == {"taster_key": "paper:name:sam", "taster_name": "Sam", "count": 2}
        rows = db_session.query(Tasting).filter_by(flight_id=fid).all()
        assert {(t.created_via, t.user_id, t.entered_by_user_id) for t in rows} == \
            {("paper", None, world.user_id("editor"))}
        assert all(c["coffee_id"] is None for c in world.get("editor", f"/flights/{fid}").get_json()["cups"])

    def test_after_close_and_summary_has_it(self, world, cs):
        fid = self._open(world, cs)
        world.close(fid)
        assert self._paper(world, fid, guest_name="Sam").status_code == 201
        assert "Sam" in str(world.get("editor", f"/flights/{fid}/summary").get_json()["coffees"])

    def test_the_account_host_may_enter_a_sheet(self, world, cs):
        fid = self._open(world, cs)
        assert self._paper(world, fid, "member", guest_name="Sam").status_code == 201

    def test_a_non_host_member_is_refused(self, world, cs):
        fid = self._open(world, cs)
        world.person("plain")
        r = self._paper(world, fid, "plain", guest_name="Sam")
        assert r.status_code == 403 and r.get_json() == {"error": "Only the host or an editor can enter a paper sheet"}

    def test_device_host_enters_a_members_sheet(self, world, cs, db_session):
        host, rowan = world.member_id("member"), world.roster_only("Rowan")
        fid = self._open(world, cs, who="device", pick=host)
        r = self._paper(world, fid, "device", member_id=host, taster_member_id=rowan.id)
        assert r.status_code == 201, r.get_json()
        assert r.get_json()["taster_key"] == f"paper:member:{rowan.id}" and r.get_json()["taster_name"] == "Rowan"
        rows = db_session.query(Tasting).filter_by(flight_id=fid).all()
        assert {(t.member_id, t.user_id, t.entered_by_user_id) for t in rows} == {(rowan.id, None, None)}
        r = self._paper(world, fid, "device", member_id=world.member_id("editor"), guest_name="Sam")
        assert r.status_code == 403

    def test_body_validation(self, world, cs, db_session):
        fid = self._open(world, cs)
        rowan = world.roster_only("Rowan")
        for body in ({}, {"taster_member_id": rowan.id, "guest_name": "Sam"}):
            r = self._paper(world, fid, **body)
            assert r.status_code == 400 and r.get_json()["field"] == "taster", body
        for bad in (True, "12", 1.5, 2 ** 40):
            r = self._paper(world, fid, taster_member_id=bad)
            assert r.status_code == 400 and r.get_json()["field"] == "taster_member_id", bad
        assert self._paper(world, fid, taster_member_id=world.member_id("outsider")).status_code == 404
        rowan.active = False
        db_session.commit()
        assert self._paper(world, fid, taster_member_id=rowan.id).status_code == 422
        for bad in ("   ", "x" * 121, 7):
            r = self._paper(world, fid, guest_name=bad)
            assert r.status_code == 400 and r.get_json()["field"] == "guest_name", bad
        r = self._paper(world, fid, guest_name="Sam", entries=[{"position": 1, "overall": 4}])
        assert r.status_code == 400 and r.get_json()["field"] == "entries"

    def test_double_post_is_409_with_the_name(self, world, cs):
        fid = self._open(world, cs)
        rowan = world.roster_only("Rowan")
        assert self._paper(world, fid, taster_member_id=rowan.id).status_code == 201
        r = self._paper(world, fid, taster_member_id=rowan.id)
        assert r.status_code == 409 and r.get_json() == {
            "error": "already_logged", "message": "Rowan already has a read in this cupping"}

    def test_basic_and_missing_flights_404(self, world, cs):
        basic = world.open_flight([cs["guji"]])
        assert self._paper(world, basic, guest_name="Sam").status_code == 404
        assert self._paper(world, 999999, guest_name="Sam").status_code == 404

    def test_paper_deletes(self, world, cs):
        fid = self._open(world, cs)
        assert self._paper(world, fid, guest_name="Sam").status_code == 201
        world.close(fid)
        world.person("plain")
        url = f"/flights/{fid}/tastings?taster_key=paper:name:sam"
        assert world.send("plain", "delete", url).status_code == 403
        r = world.send("member", "delete", url)                 # the account host, after close
        assert r.status_code == 200 and r.get_json()["deleted"] == 2

    def test_paper_clause_does_not_reach_live_reads(self, world, cs):
        fid = self._open(world, cs)
        world.person("plain")
        assert world.log(fid, self._entries(), who="plain").status_code == 201
        r = world.send("member", "delete", f"/flights/{fid}/tastings?taster_key=user:{world.user_id('plain')}")
        assert r.status_code == 403 and "someone else's" in r.get_json()["error"]


class TestGroupScoping:
    def test_flight_in_other_group_404(self, world, db_session):
        theirs = world.coffee(world.other, name="Theirs")
        f = make_flight(db_session, world.other, [theirs], sheet="advanced", adv_step=0.5, prep="cupping",
                        is_open=False)
        make_tasting(db_session, f, theirs, adv=8.0, taster_key="user:x")
        db_session.commit()
        fid = f.id
        for who in ("member", "editor", "admin", "device"):
            for path in ("", "/reveal", "/summary", "/export.csv", "/label-key"):
                assert world.get(who, f"/flights/{fid}{path}").status_code in (403, 404), (who, path)
                if who != "device":
                    assert world.get(who, f"/flights/{fid}{path}").status_code == 404, (who, path)
        for method, path, body in (("post", "/tastings", {"entries": [adv_entry()]}),
                                   ("post", "/close", {}), ("post", "/timer", {}),
                                   ("post", "/pass", {"pass": 1}), ("post", "/paper", {"guest_name": "S"}),
                                   ("put", "/cups", {"cups": [{"coffee_id": theirs.id}]}),
                                   ("delete", "/tastings?taster_key=user:x", None), ("delete", "", None)):
            r = world.send("admin", method, f"/flights/{fid}{path}", json=body)
            assert r.status_code == 404, (method, path, r.get_json())
        db_session.expire_all()
        assert db_session.query(Tasting).filter_by(flight_id=fid).count() == 1

    def test_flight_cannot_be_created_with_another_groups_coffee(self, world, cs, db_session):
        theirs = world.coffee(world.other, name="Theirs")
        for body in ({"coffee_ids": [cs["guji"].id, theirs.id], "prep": "drip", "shared": True},
                     {"coffee_ids": [theirs.id], "prep": "drip", "entries": [entry(theirs.id)]}):
            r = world.send("member", "post", "/flights", json=body)
            assert r.status_code == 404 and r.get_json()["error"] == "Coffee not found"
        assert db_session.query(TastingFlight).count() == 0

    def test_outsider_lists_none_of_this_groups_flights(self, world, cs):
        world.open_flight([cs["guji"]], who="admin")
        assert world.get("outsider", "/flights/recent").get_json()["flights"] == []


F_PREVIEW = "/flights/import/preview"
F_APPLY = "/flights/import"


def _upload(world, url, text, who="editor", filename="flights.csv", **form):
    import io
    data = {"file": (io.BytesIO(text.encode()), filename), **form}
    return world.send(who, "post", url, data=data, content_type="multipart/form-data")


def _flight_import(world, text, flights, who="editor", **form):
    plan_hash = _upload(world, F_PREVIEW, text, who).get_json()["plan_hash"]
    form.setdefault("plan_hash", plan_hash)
    return _upload(world, F_APPLY, text, who, flights=flights, **form)


class TestFlightCsvRoutes:
    TEXT = ("flight,prep,position,blind_label,roaster,name\n"
            "Day 1,cupping,1,,Barrington,Guji Shakiso\nDay 1,cupping,2,,Barrington,Winter Blend\n")

    def test_floor_both_sides(self, world, cs):
        for who in ("member", "device"):
            assert _upload(world, F_PREVIEW, self.TEXT, who).status_code == 403
            assert _upload(world, F_APPLY, self.TEXT, who, plan_hash="x", flights='["Day 1"]').status_code == 403
        assert _upload(world, F_PREVIEW, self.TEXT).status_code == 200

    def test_preview_then_apply_and_label_key(self, world, cs, db_session):
        r = _upload(world, F_PREVIEW, self.TEXT)
        assert "Guji" not in r.get_data(as_text=True) and db_session.query(TastingFlight).count() == 0
        r = _flight_import(world, self.TEXT, '["Day 1"]')
        assert r.status_code == 201
        [f] = r.get_json()["flights"]
        assert set(f) == {"id", "name", "prep", "sheet", "cup_count", "closes_at"}
        assert f["cup_count"] == 2 and f["sheet"] == "advanced" and "Guji" not in r.get_data(as_text=True)
        assert world.get("editor", f"/flights/{f['id']}/label-key").status_code == 200
        assert world.get("admin", f"/flights/{f['id']}/label-key").status_code == 403
        cups = world.get("editor", f"/flights/{f['id']}").get_json()["cups"]
        assert all(c["coffee_id"] is None for c in cups)

    def test_hash_rules(self, world, cs, db_session):
        r = _upload(world, F_APPLY, self.TEXT, flights='["Day 1"]')
        assert r.status_code == 400 and r.get_json()["field"] == "plan_hash"
        h = _upload(world, F_PREVIEW, self.TEXT).get_json()["plan_hash"]
        r = _upload(world, F_APPLY, self.TEXT.replace(",2,", ",3,"), plan_hash=h, flights='["Day 1"]')
        assert r.status_code == 409 and r.get_json()["error"] == "plan_stale"
        assert _upload(world, F_APPLY, self.TEXT, plan_hash=h, flights='["Day 1"]').status_code == 201
        assert _upload(world, F_APPLY, self.TEXT, plan_hash=h, flights='["Day 1"]').status_code == 409

    @pytest.mark.parametrize("flights", ["[]", "not json", '"Day 1"', "[1]", '["Nope"]', '["day 1"]'])
    def test_bad_flights_field_400(self, world, cs, flights, db_session):
        assert _flight_import(world, self.TEXT, flights).status_code == 400
        assert db_session.query(TastingFlight).count() == 0

    def test_errors_and_rollback(self, world, cs, db_session, monkeypatch):
        bad = self.TEXT + "Bad,cupping,1,,Barrington,No Such Coffee\n"
        r = _flight_import(world, bad, '["Day 1","Bad"]')
        assert r.status_code == 422 and r.get_json()["row_errors"]
        assert _flight_import(world, bad, '["Day 1"]').status_code == 201
        from tasting import flights_repository as frepo
        real, calls = frepo.create_flight, []

        def flaky(*a, **kw):
            calls.append(1)
            if len(calls) == 2:
                raise RuntimeError("boom")
            return real(*a, **kw)
        monkeypatch.setattr(frepo, "create_flight", flaky)
        text = "flight,prep,roaster,name,kind\nD1,cupping,Fresh Co,Alpha,house\nD2,cupping,Fresh Co,Beta,house\n"
        before = db_session.query(TastingFlight).count()
        r = _flight_import(world, text, '["D1","D2"]')
        assert r.status_code == 500 and db_session.query(TastingFlight).count() == before
        from tasting.models import TastingCoffee
        assert db_session.query(TastingCoffee).filter_by(roaster="Fresh Co").count() == 0

    def test_post_flights_ignores_labels_and_window_in_body(self, world, cs):
        r = world.send("editor", "post", "/flights", json={
            "coffee_ids": [cs["guji"].id, cs["winter"].id], "prep": "drip", "shared": True, "blind": True,
            "blind_labels": ["Z1", "Z2"], "window": 999})
        body = world.get("editor", f"/flights/{r.get_json()['id']}").get_json()
        assert [c["label"] for c in body["cups"]] == ["Cup A", "Cup B"]
        opened, closes = (datetime.datetime.fromisoformat(body[k]) for k in ("opened_at", "closes_at"))
        assert closes - opened == datetime.timedelta(hours=24)


def test_advanced_categories_are_the_sheet():
    assert len(ADV_CATEGORIES) == 10
