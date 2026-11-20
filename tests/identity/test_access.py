"""Access layer: session -> Actor, levels, and the device member pick.

Routes here are test-only stubs registered on a throwaway blueprint, so the
level mapping is exercised without depending on the tasting routes (Task 7).
"""
from datetime import timedelta

import pytest
from flask import Blueprint, Response, jsonify, request
from freezegun import freeze_time

from extensions import db
from identity.access import actor_for_pick, current_actor, current_user, require
from identity.models import Group, Member
from identity.sessions import SESSION_COOKIE, start_device_session
from tests.identity.helpers import csrf, make_group, make_member, sign_in
from utils import utc_now

LEVELS = ("member", "self", "device", "manage", "admin")
KINDS = ("user-member", "user-editor", "user-admin", "device", "none")

# Expected status per level, in KINDS order: straight from the brief's mapping.
MATRIX = {
    "member": (200, 200, 200, 200, 401),
    "self": (200, 200, 200, 403, 401),
    "device": (403, 403, 403, 200, 401),
    "manage": (403, 200, 200, 403, 401),
    "admin": (403, 403, 200, 403, 401),
}


def _actor_json():
    a = current_actor()
    return jsonify({"kind": a.kind, "group_id": a.group_id, "user_id": a.user_id,
                    "member_id": a.member_id, "role": a.role,
                    "display_name": a.display_name})


def _stub_blueprint() -> Blueprint:
    bp = Blueprint("access_stub", __name__, url_prefix="/api/_stub")
    for level in LEVELS:
        bp.add_url_rule(f"/{level}", f"level_{level}", require(level)(_actor_json))

    @bp.get("/signed-in")
    @require("signed_in")
    def signed_in_route():
        return jsonify({"user_id": current_user().id})

    @bp.get("/palate")
    @require("self")
    def palate():
        return jsonify({"palate": "secret"})

    @bp.get("/flights/<int:flight_id>/label-key")
    @require("self")
    def label_key(flight_id: int):
        return jsonify({"flight": flight_id, "labels": {"A": "secret"}})

    @bp.post("/pick")
    @require("device")
    def pick():
        a = actor_for_pick(request.get_json()["member_id"])
        return jsonify({"kind": a.kind, "group_id": a.group_id, "user_id": a.user_id,
                        "member_id": a.member_id, "role": a.role,
                        "display_name": a.display_name})

    @bp.post("/write")
    @require("member")
    def write():
        db.session.add(Group(name="written", timezone="UTC"))
        db.session.commit()
        return jsonify({"ok": True})
    return bp


@pytest.fixture
def stub_app(app):
    app.register_blueprint(_stub_blueprint())
    return app


def device_client(app, group):
    client = app.test_client()
    set_cookie = start_device_session(group.id)
    response = set_cookie(Response())
    db.session.commit()
    raw = response.headers.get_all("Set-Cookie")[0].split(";")[0].split("=", 1)[1]
    client.set_cookie(SESSION_COOKIE, raw)
    return client


@pytest.fixture
def clients(stub_app, db_session):
    group = make_group()
    out = {}
    for kind in KINDS[:3]:
        role = kind.split("-")[1]
        user, _ = make_member(group, f"{role}@cafe.com", role)
        client = stub_app.test_client()
        sign_in(client, user)
        out[kind] = client
    out["device"] = device_client(stub_app, group)
    out["none"] = stub_app.test_client()
    return group, out


@pytest.mark.parametrize("level", LEVELS)
def test_level_matrix(clients, level):
    _, by_kind = clients
    got = {kind: by_kind[kind].get(f"/api/_stub/{level}").status_code for kind in KINDS}
    assert got == dict(zip(KINDS, MATRIX[level]))


def test_denials_carry_error_codes(clients):
    _, by_kind = clients
    none = by_kind["none"].get("/api/_stub/member")
    assert none.get_json() == {"error": "unauthorized"}
    denied = by_kind["user-member"].get("/api/_stub/admin")
    assert denied.get_json() == {"error": "forbidden"}


def test_user_actor_fields(clients):
    group, by_kind = clients
    body = by_kind["user-editor"].get("/api/_stub/member").get_json()
    member = db.session.execute(
        db.select(Member).where(Member.email == "editor@cafe.com")).scalar_one()
    assert body == {"kind": "user", "group_id": group.id, "user_id": member.user_id,
                    "member_id": member.id, "role": "editor",
                    "display_name": member.display_name}


def test_device_actor_fields(clients):
    group, by_kind = clients
    body = by_kind["device"].get("/api/_stub/member").get_json()
    assert body["kind"] == "device" and body["group_id"] == group.id
    assert body["user_id"] is None and body["member_id"] is None and body["role"] is None


def test_device_cannot_read_palate_or_label_key(clients):
    # Re-pointed at the real palate and label-key routes in Task 7b.
    _, by_kind = clients
    tablet = by_kind["device"]
    for path in ("/api/_stub/palate", "/api/_stub/flights/1/label-key"):
        response = tablet.get(path)
        assert response.status_code == 403
        assert "secret" not in response.get_data(as_text=True)
    assert by_kind["user-member"].get("/api/_stub/palate").status_code == 200


def test_user_without_member_row_gets_no_group(stub_app, db_session):
    from identity.models import User
    user = User(email="lone@cafe.com", display_name="lone")
    db.session.add(user)
    db.session.commit()
    client = stub_app.test_client()
    sign_in(client, user)
    response = client.get("/api/_stub/member")
    assert response.status_code == 403 and response.get_json() == {"error": "no_group"}


def test_inactive_member_gets_no_access(stub_app, db_session):
    group = make_group()
    user, _ = make_member(group, "off@cafe.com", "admin", active=False)
    client = stub_app.test_client()
    sign_in(client, user)
    for level in LEVELS:
        response = client.get(f"/api/_stub/{level}")
        assert response.status_code == 403, level
    assert client.get("/api/_stub/member").get_json() == {"error": "no_group"}


def _two_group_user(email="two@cafe.com"):
    group_a, group_b = make_group("A"), make_group("B")
    user, _ = make_member(group_a, email, "member")
    db.session.add(Member(group_id=group_b.id, display_name="two", email=email,
                          user_id=user.id, role="admin"))
    db.session.commit()
    return group_a, group_b, user


def test_two_groups_no_header_400(stub_app, db_session):
    _, _, user = _two_group_user()
    client = stub_app.test_client()
    sign_in(client, user)
    response = client.get("/api/_stub/member")
    assert response.status_code == 400 and response.get_json() == {"error": "group_required"}


def test_header_picks_group(stub_app, db_session):
    group_a, group_b, user = _two_group_user()
    client = stub_app.test_client()
    sign_in(client, user)
    body = client.get("/api/_stub/admin", headers={"X-Group": str(group_b.id)})
    assert body.status_code == 200 and body.get_json()["group_id"] == group_b.id
    denied = client.get("/api/_stub/admin", headers={"X-Group": str(group_a.id)})
    assert denied.status_code == 403 and denied.get_json() == {"error": "forbidden"}


def test_header_with_single_group_ok(stub_app, db_session):
    group = make_group()
    user, _ = make_member(group, "one@cafe.com", "member")
    client = stub_app.test_client()
    sign_in(client, user)
    body = client.get("/api/_stub/member", headers={"X-Group": str(group.id)})
    assert body.status_code == 200 and body.get_json()["group_id"] == group.id


def test_header_not_member_404(stub_app, db_session):
    group = make_group("Mine")
    other = make_group("Other")
    user, _ = make_member(group, "me@cafe.com", "admin")
    client = stub_app.test_client()
    sign_in(client, user)
    response = client.get("/api/_stub/member", headers={"X-Group": str(other.id)})
    assert response.status_code == 404 and response.get_json() == {"error": "group_not_found"}


def test_header_inactive_row_404(stub_app, db_session):
    group, off = make_group("Mine"), make_group("Off")
    user, _ = make_member(group, "me@cafe.com", "admin")
    db.session.add(Member(group_id=off.id, display_name="me", email="me@cafe.com",
                          user_id=user.id, role="admin", active=False))
    db.session.commit()
    client = stub_app.test_client()
    sign_in(client, user)
    response = client.get("/api/_stub/member", headers={"X-Group": str(off.id)})
    assert response.status_code == 404 and response.get_json() == {"error": "group_not_found"}


@pytest.mark.parametrize("value", ["abc", "", "99999999999", "-1", "0x1", " 1", "1.0", "\u0661"])
def test_bad_header_values_404(stub_app, db_session, value):
    group = make_group()
    user, _ = make_member(group, "me@cafe.com", "admin")
    client = stub_app.test_client()
    sign_in(client, user)
    response = client.get("/api/_stub/member", headers={"X-Group": value})
    assert response.status_code == 404 and response.get_json() == {"error": "group_not_found"}


def test_device_header_same_group_ok(clients):
    group, by_kind = clients
    response = by_kind["device"].get("/api/_stub/member", headers={"X-Group": str(group.id)})
    assert response.status_code == 200 and response.get_json()["kind"] == "device"


def test_device_header_other_group_404(clients):
    _, by_kind = clients
    other = make_group("Other")
    for value in (str(other.id), "abc", ""):
        response = by_kind["device"].get("/api/_stub/member", headers={"X-Group": value})
        assert response.status_code == 404 and response.get_json() == {"error": "group_not_found"}


def test_signed_in_no_group_ok(stub_app, db_session):
    from identity.models import User
    user = User(email="lone@cafe.com", display_name="lone")
    db.session.add(user)
    db.session.commit()
    client = stub_app.test_client()
    sign_in(client, user)
    response = client.get("/api/_stub/signed-in")
    assert response.status_code == 200 and response.get_json() == {"user_id": user.id}


def test_signed_in_ignores_group_header(stub_app, db_session):
    group = make_group()
    user, _ = make_member(group, "me@cafe.com", "member")
    client = stub_app.test_client()
    sign_in(client, user)
    response = client.get("/api/_stub/signed-in", headers={"X-Group": "abc"})
    assert response.status_code == 200


def test_signed_in_refuses_device(clients):
    _, by_kind = clients
    device = by_kind["device"].get("/api/_stub/signed-in")
    assert device.status_code == 403 and device.get_json() == {"error": "forbidden"}
    none = by_kind["none"].get("/api/_stub/signed-in")
    assert none.status_code == 401 and none.get_json() == {"error": "unauthorized"}


def test_current_user_outside_signed_in_raises(stub_app):
    with stub_app.test_request_context("/"):
        with pytest.raises(RuntimeError):
            current_user()


def test_inactive_second_membership_is_not_ambiguous(stub_app, db_session):
    first, second = make_group("A"), make_group("B")
    user, _ = make_member(first, "two@cafe.com", "editor")
    db.session.add(Member(group_id=second.id, display_name="two", email="two@cafe.com",
                          user_id=user.id, role="admin", active=False))
    db.session.commit()
    client = stub_app.test_client()
    sign_in(client, user)
    body = client.get("/api/_stub/member").get_json()
    assert body["group_id"] == first.id and body["role"] == "editor"
    assert client.get("/api/_stub/admin").status_code == 403


def _pick(client, member_id):
    return client.post("/api/_stub/pick", json={"member_id": member_id}, headers=csrf(client))


def test_actor_for_pick(clients):
    group, by_kind = clients
    tablet = by_kind["device"]
    member = db.session.execute(
        db.select(Member).where(Member.email == "member@cafe.com")).scalar_one()
    response = _pick(tablet, member.id)
    assert response.status_code == 200
    assert response.get_json() == {"kind": "device", "group_id": group.id,
                                   "user_id": member.user_id, "member_id": member.id,
                                   "role": None, "display_name": member.display_name}


def test_actor_for_pick_roster_only_member(clients):
    group, by_kind = clients
    row = Member(group_id=group.id, display_name="Walk-in", role="member")
    db.session.add(row)
    db.session.commit()
    body = _pick(by_kind["device"], row.id).get_json()
    assert body["member_id"] == row.id and body["user_id"] is None


def test_actor_for_pick_inactive_422(clients):
    group, by_kind = clients
    row = Member(group_id=group.id, display_name="Gone", role="member", active=False)
    db.session.add(row)
    db.session.commit()
    response = _pick(by_kind["device"], row.id)
    assert response.status_code == 422 and response.get_json() == {"error": "member_inactive"}


def test_actor_for_pick_other_group_404(clients):
    _, by_kind = clients
    other = make_group("Other")
    _, stranger = make_member(other, "x@else.com", "member")
    response = _pick(by_kind["device"], stranger.id)
    assert response.status_code == 404 and response.get_json() == {"error": "not_found"}
    assert _pick(by_kind["device"], 999999).status_code == 404
    assert _pick(by_kind["device"], "1").status_code == 404
    assert _pick(by_kind["device"], 2 ** 40).status_code == 404


def test_actor_does_not_leak_between_requests(clients):
    # One app context spans every request here (db_session): a g-cached actor
    # would make the second client inherit the first one's identity.
    _, by_kind = clients
    assert by_kind["user-admin"].get("/api/_stub/admin").status_code == 200
    assert by_kind["user-member"].get("/api/_stub/admin").status_code == 403
    assert by_kind["none"].get("/api/_stub/member").status_code == 401


def test_session_resolved_before_route_writes(clients):
    # The rolling bump commits on its own connection; it must happen before the
    # route stages a write, or SQLite would lock against itself.
    _, by_kind = clients
    client = by_kind["user-member"]
    headers = csrf(client)
    with freeze_time(utc_now() + timedelta(hours=2)):
        response = client.post("/api/_stub/write", json={}, headers=headers)
    assert response.status_code == 200


def test_current_actor_outside_require_raises(stub_app):
    with stub_app.test_request_context("/"):
        with pytest.raises(RuntimeError):
            current_actor()


def test_unknown_level_rejected():
    with pytest.raises(ValueError):
        require("owner")
