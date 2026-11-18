"""/api/tasting coffee routes, the coffee CSV routes, coffee sessions and /content."""
import datetime
import io

import pytest
from flask import Response

from extensions import db
from identity.models import Group
from identity.sessions import SESSION_COOKIE, start_device_session
from tasting.models import TastingCoffee
from tests.identity.helpers import csrf, make_group, make_member, sign_in
from tests.tasting.helpers import make_coffee, make_flight, make_tasting
from utils import utc_now

BASE = "/api/tasting"


class World:
    """One group, a client per kind of session, and a second group."""

    def __init__(self, app, tz="UTC"):
        self.app = app
        self.group = make_group("Cafe", tz)
        self.other = make_group("Elsewhere")
        self.members = {}
        self.clients = {}
        self.headers = {}
        for role in ("member", "editor", "admin"):
            user, member = make_member(self.group, f"{role}@cafe.example", role, name=role.title())
            self.members[role] = (user, member)
            client = app.test_client()
            self.headers[role] = sign_in(client, user)
            self.clients[role] = client
        self.device = self._device_client()
        self.headers["device"] = csrf(self.device)
        self.clients["device"] = self.device
        self.anon = app.test_client()

    def _device_client(self):
        client = self.app.test_client()
        response = start_device_session(self.group.id)(Response())
        db.session.commit()
        raw = response.headers.get_all("Set-Cookie")[0].split(";")[0].split("=", 1)[1]
        client.set_cookie(SESSION_COOKIE, raw)
        return client

    def get(self, who, path, **kw):
        return self.clients[who].get(BASE + path, **kw)

    def send(self, who, method, path, **kw):
        headers = {**self.headers[who], **kw.pop("headers", {})}
        return getattr(self.clients[who], method)(BASE + path, headers=headers, **kw)

    def coffee(self, group=None, **kw):
        coffee = make_coffee(db.session, group or self.group, **kw)
        db.session.commit()
        return coffee

    def read(self, flight, coffee, role="member", **kw):
        """A basic or advanced read by the group member with this role."""
        user, member = self.members[role]
        return make_tasting(db.session, flight, coffee, user_id=user.id, member_id=member.id,
                            taster_key=f"user:{user.id}", taster_name=member.display_name, **kw)


@pytest.fixture
def world(db_session, app):
    return World(app)


@pytest.fixture
def guji(world):
    return world.coffee(name="Guji Shakiso", roaster="Barrington")


class TestFloors:
    def test_signed_out_is_401(self, world):
        assert world.anon.get(f"{BASE}/coffees").status_code == 401
        assert world.anon.get("/api/content").status_code == 401

    def test_member_level_reads_for_everyone_in(self, world):
        for who in ("member", "editor", "admin", "device"):
            assert world.get(who, "/coffees").status_code == 200, who

    def test_manage_floor_both_sides(self, world, guji):
        url = f"/coffees/{guji.id}"
        for who in ("member", "device"):
            assert world.send(who, "patch", url, json={"origin": "Ethiopia"}).status_code == 403
            assert world.send(who, "post", url + "/archive").status_code == 403
            assert world.send(who, "post", url + "/unarchive").status_code == 403
            assert world.get(who, "/coffees/export.csv").status_code == 403
        r = world.send("editor", "patch", url, json={"origin": "Ethiopia"})
        assert r.status_code == 200 and r.get_json()["origin"] == "Ethiopia"
        r = world.send("editor", "post", url + "/archive")
        assert r.status_code == 200 and r.get_json()["archived_at"]
        r = world.send("admin", "post", url + "/unarchive")
        assert r.status_code == 200 and r.get_json()["archived_at"] is None

    def test_writes_need_the_csrf_header(self, world, guji):
        r = world.clients["editor"].post(f"{BASE}/coffees/{guji.id}/archive")
        assert r.status_code == 403

    def test_anyone_can_add_a_coffee(self, world):
        for who in ("member", "device"):
            r = world.send(who, "post", "/coffees", json={"name": f"Kirinyaga {who}", "roaster": "Roastery",
                                                           "kind": "cupping_lot"})
            assert r.status_code == 201 and r.get_json()["kind"] == "cupping_lot"

    def test_created_by_is_the_account_never_a_device(self, world, db_session):
        r = world.send("member", "post", "/coffees", json={"name": "Mine", "kind": "house"})
        r2 = world.send("device", "post", "/coffees", json={"name": "Tablet's", "kind": "house"})
        db_session.expire_all()
        assert db_session.get(TastingCoffee, r.get_json()["id"]).created_by == world.members["member"][0].id
        assert db_session.get(TastingCoffee, r2.get_json()["id"]).created_by is None


class TestGroupScoping:
    def test_coffee_in_other_group_404(self, world):
        theirs = world.coffee(world.other, name="Theirs")
        url = f"/coffees/{theirs.id}"
        for who in ("member", "editor", "admin", "device"):
            assert world.get(who, url).status_code == 404, who
            assert world.get(who, url + "/sessions").status_code == 404, who
        for path, method in ((url, "patch"), (url + "/archive", "post"), (url + "/unarchive", "post")):
            r = world.send("admin", method, path, json={} if method == "patch" else None)
            assert r.status_code == 404, path
        db.session.expire_all()
        assert db.session.get(TastingCoffee, theirs.id).archived_at is None

    def test_other_groups_coffees_never_listed_or_matched(self, world, guji):
        world.coffee(world.other, name="Guji Elsewhere", roaster="Elsewhere Roasters")
        body = world.get("member", "/coffees").get_json()
        assert [c["name"] for c in body["coffees"]] == ["Guji Shakiso"]
        assert body["roasters"] == ["Barrington"]
        hit = world.get("member", "/coffees/match?q=guji").get_json()["match"]
        assert hit["id"] == guji.id

    def test_created_coffee_lands_in_the_callers_group(self, world, db_session):
        r = world.send("member", "post", "/coffees", json={"name": "Here", "kind": "house"})
        db_session.expire_all()
        assert db_session.get(TastingCoffee, r.get_json()["id"]).group_id == world.group.id


class TestCoffees:
    def test_create_validation(self, world):
        r = world.send("member", "post", "/coffees", json={"roaster": "x", "kind": "house"})
        assert r.status_code == 400 and r.get_json()["field"] == "name"
        r = world.send("member", "post", "/coffees", json={"name": "X", "kind": "blend"})
        assert r.status_code == 400 and r.get_json()["field"] == "kind"
        r = world.send("member", "post", "/coffees", json="nope")
        assert r.status_code == 400 and r.get_json()["field"] == "body"

    def test_list_carries_counts_but_no_scores_under_threshold(self, world, guji):
        winter = world.coffee(name="Winter Blend", roaster="George Howell")
        flight = make_flight(db.session, world.group, [guji], is_open=False)
        world.read(flight, guji, "member", overall=2)
        db.session.commit()
        body = world.get("member", "/coffees?mine=1").get_json()
        rows = {c["name"]: c for c in body["coffees"]}
        assert rows["Guji Shakiso"]["n"] == 1
        assert rows["Guji Shakiso"]["avg_overall"] is None and rows["Guji Shakiso"]["top_terms"] == []
        assert rows["Guji Shakiso"]["tasted_by_me"] is True
        assert rows["Winter Blend"]["tasted_by_me"] is False
        assert body["roasters"] == ["Barrington", "George Howell"]
        for row in rows.values():
            assert "tastings" not in row and "overall" not in row
        assert world.get("editor", "/coffees?mine=1").get_json()["coffees"][0]["tasted_by_me"] is False
        assert winter.id

    def test_list_shows_consensus_at_three(self, world, guji):
        flight = make_flight(db.session, world.group, [guji], is_open=False, is_shared=True)
        for role, overall in (("member", 4), ("editor", 5), ("admin", 3)):
            t = world.read(flight, guji, role, overall=overall)
            from tasting.models import TastingTag
            t.tags.append(TastingTag(term="Fruity>Berry>blueberry", strength=3))
        db.session.commit()
        row = next(c for c in world.get("member", "/coffees").get_json()["coffees"] if c["id"] == guji.id)
        assert row["n"] == 3 and row["avg_overall"] == 4.0 and row["spread"] == 0.8
        assert row["top_terms"][0]["label"] == "blueberry" and row["top_terms"][0]["pct"] == 100

    def test_archived_hidden_by_default(self, world, guji):
        world.send("editor", "post", f"/coffees/{guji.id}/archive")
        names = {c["name"] for c in world.get("member", "/coffees").get_json()["coffees"]}
        assert "Guji Shakiso" not in names
        names = {c["name"] for c in world.get("member", "/coffees?include_archived=1").get_json()["coffees"]}
        assert "Guji Shakiso" in names
        world.send("editor", "post", f"/coffees/{guji.id}/unarchive")
        names = {c["name"] for c in world.get("member", "/coffees").get_json()["coffees"]}
        assert "Guji Shakiso" in names

    def test_match(self, world, guji):
        assert world.get("member", "/coffees/match?q=gu").get_json()["match"] is None
        hit = world.get("member", "/coffees/match?q=guji%20shak").get_json()["match"]
        assert hit["name"] == "Guji Shakiso" and hit["n"] == 0
        assert world.get("member", "/coffees/match?q=zzzzqqq").get_json()["match"] is None

    def test_detail_threshold_gates_scores(self, world, guji):
        flight = make_flight(db.session, world.group, [guji], is_open=False, is_shared=True)
        t = world.read(flight, guji, "member", overall=5, acidity=4)
        from tasting.models import TastingTag
        t.tags.append(TastingTag(term="Fruity>Citrus>lemon", strength=2))
        db.session.commit()
        d = world.get("editor", f"/coffees/{guji.id}").get_json()
        assert d["n"] == 1 and d["consensus"] is None and "tastings" not in d and d["yours"] is None
        # One's own read is always visible to oneself, threshold or not.
        mine = world.get("member", f"/coffees/{guji.id}").get_json()["yours"]
        assert mine["overall"] == 5 and mine["acidity"] == 4 and mine["sweetness"] is None
        assert mine["tags"] == {"Fruity>Citrus>lemon": 2} and mine["sentence"] == "Notes of lemon."
        assert mine["reads"] == 1
        for role in ("editor", "admin"):
            world.read(flight, guji, role, overall=3, acidity=2)
        db.session.commit()
        d = world.get("device", f"/coffees/{guji.id}").get_json()
        assert d["consensus"]["n"] == 3 and d["consensus"]["histogram"] == [0, 0, 2, 0, 1]
        assert d["consensus"]["profile"]["acidity"]["word"] == "bright"
        assert d["consensus"]["profile"]["body"] is None

    def test_update_details(self, world):
        lot = world.coffee(name="Huila Sample 3", kind="cupping_lot")
        url = f"/coffees/{lot.id}"
        r = world.send("editor", "patch", url, json={"process": "steamed"})
        assert r.status_code == 400 and r.get_json()["field"] == "process"
        r = world.send("editor", "patch", url, json={
            "process": "washed", "roast_level": "light", "kind": "house",
            "notes": "On the bag.", "altitude": "1,900 m"})
        d = r.get_json()
        assert d["process"] == "washed" and d["kind"] == "house"
        assert d["notes"] == "On the bag." and d["altitude"] == "1,900 m"
        assert world.send("editor", "patch", "/coffees/999999", json={}).status_code == 404


class TestIdentityOnReads:
    def test_a_person_may_not_name_someone_else(self, world, guji):
        member_id = world.members["editor"][1].id
        r = world.get("member", f"/coffees/{guji.id}?member_id={member_id}")
        assert r.status_code == 400 and r.get_json()["field"] == "member_id"

    def test_a_device_pick_marks_that_members_reads(self, world, guji):
        flight = make_flight(db.session, world.group, [guji], is_open=False)
        world.read(flight, guji, "member", overall=4)
        db.session.commit()
        member_id = world.members["member"][1].id
        rows = world.get("device", f"/coffees?mine=1&member_id={member_id}").get_json()["coffees"]
        assert rows[0]["tasted_by_me"] is True
        rows = world.get("device", "/coffees?mine=1").get_json()["coffees"]
        assert rows[0]["tasted_by_me"] is False

    def test_a_pick_from_another_group_is_404(self, world, guji):
        _, theirs = make_member(world.other, "x@else.example")
        r = world.get("device", f"/coffees/{guji.id}?member_id={theirs.id}")
        assert r.status_code == 404

    def test_an_inactive_pick_is_422(self, world, guji):
        _, gone = make_member(world.group, "gone@cafe.example", active=False)
        r = world.get("device", f"/coffees/{guji.id}?member_id={gone.id}")
        assert r.status_code == 422


class TestOpenFlightsStayDark:
    """Anti-goal: nothing on the coffee pages moves while a blind flight is open."""

    def _snapshot(self, world, coffee):
        row = next(c for c in world.get("member", "/coffees").get_json()["coffees"] if c["id"] == coffee.id)
        detail = world.get("editor", f"/coffees/{coffee.id}").get_json()
        keys = ("n", "basic_n", "avg_overall", "spread", "top_terms", "last_tasted_at", "tasted_by_me")
        return {k: row[k] for k in keys}, {k: detail.get(k) for k in ("n", "consensus", "yours")}

    def test_open_blind_flight_changes_nothing_until_closed(self, world, guji):
        from tasting.models import TastingFlight, TastingTag
        before = self._snapshot(world, guji)
        assert before[0]["n"] == 0
        now = utc_now()
        flight = make_flight(db.session, world.group, [guji], is_shared=True, is_blind=True,
                             is_open=True, opened_at=now, closes_at=now + datetime.timedelta(hours=24))
        for role, overall in (("member", 5), ("editor", 4), ("admin", 3)):
            t = world.read(flight, guji, role, overall=overall)
            t.tags.append(TastingTag(term="Fruity>Berry>blueberry", strength=3))
        db.session.commit()
        assert self._snapshot(world, guji) == before
        assert world.get("member", "/coffees/match?q=guji").get_json()["match"]["n"] == 0
        db.session.expire_all()
        db.session.get(TastingFlight, flight.id).is_open = False
        db.session.get(TastingFlight, flight.id).closed_at = utc_now()
        db.session.commit()
        after_list, after_detail = self._snapshot(world, guji)
        assert after_list["n"] == 3 and after_list["avg_overall"] == 4.0
        assert after_list["last_tasted_at"] is not None
        assert after_detail["n"] == 3 and after_detail["consensus"]["n"] == 3
        assert world.get("member", "/coffees/match?q=guji").get_json()["match"]["n"] == 3

    def test_flight_past_its_close_time_counts_as_closed(self, world, guji):
        past = utc_now() - datetime.timedelta(hours=30)
        flight = make_flight(db.session, world.group, [guji], is_shared=True, is_open=True,
                             opened_at=past, closes_at=past + datetime.timedelta(hours=24))
        world.read(flight, guji, "member", overall=4)
        db.session.commit()
        assert self._snapshot(world, guji)[0]["n"] == 1


class TestStrictMemberId:
    @pytest.mark.parametrize("raw", ["abc", "1.5", "-1", "0", "", "99999999999999999999", "%C2%B2"])
    def test_malformed_member_id_is_400(self, world, guji, raw):
        for path in (f"/coffees/{guji.id}", f"/coffees/{guji.id}/sessions", "/coffees?mine=1"):
            sep = "&" if "?" in path else "?"
            r = world.get("device", f"{path}{sep}member_id={raw}")
            assert r.status_code == 400, (path, raw)
            assert r.get_json() == {"error": "bad_member_id", "field": "member_id"}

    def test_absent_member_id_is_fine(self, world, guji):
        assert world.get("device", f"/coffees/{guji.id}").status_code == 200


class TestContent:
    def test_content_with_etag_and_304(self, world):
        r = world.clients["member"].get("/api/content")
        assert r.status_code == 200
        body = r.get_json()
        assert set(body) == {"lexicon", "forms"}
        assert body["lexicon"]["tree"][0]["label"] == "Fruity"
        etag = r.headers["ETag"]
        again = world.clients["member"].get("/api/content", headers={"If-None-Match": etag})
        assert again.status_code == 304
        assert world.clients["device"].get("/api/content").status_code == 200


EXPORT, PREVIEW, APPLY = "/coffees/export.csv", "/coffees/import/preview", "/coffees/import"


def _upload(world, who, path, text, filename="coffees.csv", **form):
    data = {"file": (io.BytesIO(text if isinstance(text, bytes) else text.encode()), filename), **form}
    return world.send(who, "post", path, data=data, content_type="multipart/form-data")


class TestCoffeeCsv:
    @pytest.fixture
    def lot(self, world, guji):
        return world.coffee(name="Huila Sample 3", roaster="George Howell", kind="cupping_lot")

    def _edited_export(self, world):
        text = world.get("editor", EXPORT).get_data(as_text=True)
        return text.replace("Huila Sample 3", "Huila Sample 4")

    def test_floor_both_sides(self, world, lot):
        for who in ("member", "device"):
            assert world.get(who, EXPORT).status_code == 403
            assert _upload(world, who, PREVIEW, "id,name\n").status_code == 403
            assert _upload(world, who, APPLY, "id,name\n", plan_hash="x").status_code == 403
        assert world.get("editor", EXPORT).status_code == 200
        assert _upload(world, "editor", PREVIEW, "id,name\n").status_code == 200

    def test_export_download(self, world, lot):
        r = world.get("editor", EXPORT)
        assert r.mimetype == "text/csv"
        assert 'filename="coffees-' in r.headers["Content-Disposition"]
        assert r.get_data(as_text=True).splitlines()[0].startswith("id,name,roaster,kind")

    def test_export_filename_uses_the_group_day(self, db_session, app):
        from freezegun import freeze_time
        w = World(app, tz="America/Los_Angeles")
        with freeze_time("2026-09-10 06:30:00"):
            r = w.get("editor", EXPORT)
        assert 'filename="coffees-2026-09-09.csv"' in r.headers["Content-Disposition"]

    def test_preview_then_apply(self, world, lot, db_session):
        text = self._edited_export(world)
        body = _upload(world, "editor", PREVIEW, text).get_json()
        assert len(body["updates"]) == 1 and body["creates"] == []
        r = _upload(world, "editor", APPLY, text, plan_hash=body["plan_hash"])
        assert r.status_code == 200
        assert r.get_json() == {"created": 0, "updated": 1, "unchanged": 1, "skipped": 0}
        db_session.expire_all()
        assert db_session.get(TastingCoffee, lot.id).name == "Huila Sample 4"

    def test_apply_stale_hash_409_writes_nothing(self, world, lot, db_session):
        text = self._edited_export(world)
        plan_hash = _upload(world, "editor", PREVIEW, text).get_json()["plan_hash"]
        assert world.send("editor", "patch", f"/coffees/{lot.id}", json={"name": "Patched"}).status_code == 200
        r = _upload(world, "editor", APPLY, text, plan_hash=plan_hash)
        assert r.status_code == 409 and r.get_json()["error"] == "plan_stale"
        db_session.expire_all()
        assert db_session.get(TastingCoffee, lot.id).name == "Patched"

    def test_apply_with_errors_422(self, world):
        r = _upload(world, "editor", APPLY, "id,name\n999999,X\n", plan_hash="x")
        assert r.status_code == 422 and r.get_json()["row_errors"]

    def test_missing_hash_400(self, world):
        r = _upload(world, "editor", APPLY, "id,name\n,X\n")
        assert r.status_code == 400 and r.get_json()["field"] == "plan_hash"

    def test_non_csv_400(self, world):
        assert _upload(world, "editor", PREVIEW, "id,name\n", filename="coffees.xlsx").status_code == 400
        assert _upload(world, "editor", PREVIEW, b"\xff\xfe\x00bad", filename="c.csv").status_code == 400
        assert world.send("editor", "post", PREVIEW).status_code == 400

    def test_oversize_413(self, world):
        assert _upload(world, "editor", PREVIEW, "x" * (5 * 1024 * 1024 + 1)).status_code == 413

    def test_replayed_apply_does_not_duplicate_creates(self, world, db_session):
        text = "id,name,kind\n,Kochere,cupping_lot\n"
        plan_hash = _upload(world, "editor", PREVIEW, text).get_json()["plan_hash"]
        assert _upload(world, "editor", APPLY, text, plan_hash=plan_hash).status_code == 200
        again = _upload(world, "editor", APPLY, text, plan_hash=plan_hash)
        assert again.status_code == 409 and again.get_json()["error"] == "plan_stale"
        assert db_session.query(TastingCoffee).filter_by(name="Kochere").count() == 1

    def test_created_coffees_belong_to_the_importing_group(self, world, db_session):
        text = "id,name,kind\n,Kochere,cupping_lot\n"
        plan_hash = _upload(world, "editor", PREVIEW, text).get_json()["plan_hash"]
        _upload(world, "editor", APPLY, text, plan_hash=plan_hash)
        row = db_session.query(TastingCoffee).filter_by(name="Kochere").one()
        assert row.group_id == world.group.id
        assert row.created_by == world.members["editor"][0].id

    def test_another_groups_id_is_an_error_row(self, world):
        theirs = world.coffee(world.other, name="Theirs")
        r = _upload(world, "editor", APPLY, f"id,name\n{theirs.id},Hijack\n", plan_hash="x")
        assert r.status_code == 422
        assert r.get_json()["row_errors"][0]["message"] == f"No coffee with id {theirs.id}"

    def test_stores_header_is_ignored_with_a_warning(self, world, lot):
        text = f"id,name,stores\n{lot.id},Huila Sample 3,North\n"
        body = _upload(world, "editor", PREVIEW, text).get_json()
        assert body["row_errors"] == [] and body["file_errors"] == []
        assert [w["message"] for w in body["warnings"]] == ["ignored_column: stores"]

    def test_existing_coffee_is_skipped_not_duplicated(self, world, lot, db_session):
        text = "id,name,roaster,kind\n,Huila Sample 3,George Howell,cupping_lot\n"
        body = _upload(world, "editor", PREVIEW, text).get_json()
        assert body["creates"] == [] and len(body["skipped"]) == 1
        r = _upload(world, "editor", APPLY, text, plan_hash=body["plan_hash"])
        assert r.get_json() == {"created": 0, "updated": 0, "unchanged": 0, "skipped": 1}
        assert db_session.query(TastingCoffee).filter_by(name="Huila Sample 3").count() == 1


class TestCoffeeSessionsRoute:
    def _url(self, coffee, qs=""):
        return f"/coffees/{coffee.id}/sessions{qs}"

    def _adv_room(self, world, coffee, **flight_kw):
        flight = make_flight(db.session, world.group, [coffee], sheet="advanced", adv_step=0.5,
                             prep="cupping", is_shared=True, is_open=False, **flight_kw)
        for role in ("member", "editor", "admin"):
            world.read(flight, coffee, role, adv=8.0)
        make_tasting(db.session, flight, coffee, adv=8.0, user_id=None, taster_key="paper:name:pat",
                     taster_name="Pat", created_via="paper")
        db.session.commit()
        return flight

    def test_member_gets_room_not_reads(self, world, guji):
        flight = self._adv_room(world, guji)
        s = world.get("member", self._url(guji)).get_json()["sessions"]
        assert [x["flight_id"] for x in s] == [flight.id]
        assert s[0]["room"] is not None and s[0]["reads"] is None and s[0]["yours"] is not None

    def test_editor_gets_reads(self, world, guji):
        self._adv_room(world, guji)
        s = world.get("editor", self._url(guji)).get_json()["sessions"]
        assert len(s[0]["reads"]) == 4 and s[0]["yours"] is not None

    def test_account_host_gets_reads(self, world, guji):
        user, member = world.members["member"]
        self._adv_room(world, guji, host_user_id=user.id, host_member_id=member.id)
        s = world.get("member", self._url(guji)).get_json()["sessions"]
        assert len(s[0]["reads"]) == 4 and s[0]["reads"][0]["is_you"] is True

    def test_device_hosted_flight_belongs_to_the_members_account(self, world, guji):
        """A device host is the picked member (host_user_id NULL); host powers then
        belong to that member's account too (spec, Identity and access). Another
        member's account is not the host."""
        _, member = world.members["member"]
        self._adv_room(world, guji, host_user_id=None, host_member_id=member.id, created_via="device")
        s = world.get("member", self._url(guji)).get_json()["sessions"]
        assert s[0]["reads"] is not None and len(s[0]["reads"]) == 4
        user, _ = make_member(world.group, "plain@cafe.example")
        client = world.app.test_client()
        sign_in(client, user)
        s = client.get(BASE + self._url(guji)).get_json()["sessions"]
        assert s[0]["reads"] is None

    def test_device_pick_gets_no_yours_no_reads(self, world, guji):
        """A linked member picked on the device carries a user id; it must still
        read as the room, never as that person."""
        user, member = world.members["member"]
        self._adv_room(world, guji, host_user_id=user.id, host_member_id=member.id)
        r = world.get("device", self._url(guji, f"?member_id={member.id}"))
        assert r.status_code == 200
        s = r.get_json()["sessions"][0]
        assert s["yours"] is None and s["reads"] is None and s["room"] is not None

    def test_editor_lists_others_solo(self, world, guji):
        flight = make_flight(db.session, world.group, [guji], is_open=False)
        world.read(flight, guji, "member")
        db.session.commit()
        assert [x["flight_id"] for x in world.get("editor", self._url(guji)).get_json()["sessions"]] == [flight.id]

    def test_member_does_not_list_others_solo(self, world, guji):
        flight = make_flight(db.session, world.group, [guji], is_open=False)
        world.read(flight, guji, "member")
        db.session.commit()
        assert world.get("editor", self._url(guji, "?sheet=advanced")).get_json()["sessions"] == []
        other = world.get("admin", self._url(guji))
        assert [x["flight_id"] for x in other.get_json()["sessions"]] == [flight.id]
        # a plain member who did not read it sees nothing
        user, member = make_member(world.group, "plain@cafe.example")
        client = world.app.test_client()
        sign_in(client, user)
        assert client.get(BASE + self._url(guji)).get_json()["sessions"] == []

    def test_bad_sheet_400(self, world, guji):
        r = world.get("member", self._url(guji, "?sheet=nope"))
        assert r.status_code == 400 and r.get_json()["field"] == "sheet"

    def test_unknown_coffee_404(self, world):
        r = world.get("member", "/coffees/999999/sessions")
        assert r.status_code == 404 and r.get_json() == {"error": "Coffee not found"}

    def test_malformed_before_reads_as_first_page(self, world, guji):
        self._adv_room(world, guji)
        r = world.get("editor", self._url(guji, "?before=abc"))
        assert r.status_code == 200 and len(r.get_json()["sessions"]) == 1

    def test_sessions_bucket_by_group_timezone(self, db_session, app):
        w = World(app, tz="America/Los_Angeles")
        coffee = w.coffee(name="Late Lot")
        opened = datetime.datetime(2026, 9, 10, 6, 30)
        flight = make_flight(db.session, w.group, [coffee], is_open=False, opened_at=opened, closes_at=opened)
        w.read(flight, coffee, "member")
        db.session.commit()
        s = w.get("member", f"/coffees/{coffee.id}/sessions").get_json()["sessions"][0]
        assert s["date"] == "2026-09-09"

    def test_get_coffee_has_your_lean_and_no_tastings(self, world, guji):
        self._adv_room(world, guji)
        d = world.get("member", f"/coffees/{guji.id}").get_json()
        assert "tastings" not in d
        assert d["your_lean"]["advanced"]["total"] == 0.0 and d["your_lean"]["basic"] is None
        member_id = world.members["member"][1].id
        d = world.get("device", f"/coffees/{guji.id}?member_id={member_id}").get_json()
        assert d["your_lean"] is None
        user, _ = make_member(world.group, "new@cafe.example")
        client = world.app.test_client()
        sign_in(client, user)
        d = client.get(f"{BASE}/coffees/{guji.id}").get_json()
        assert d["your_lean"] == {"advanced": None, "basic": None}
