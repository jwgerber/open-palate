from datetime import timedelta

from freezegun import freeze_time

from extensions import db
from identity.models import DeviceCode, Session
from tests.identity.helpers import csrf, device_sessions, make_group, make_member, sign_in
from utils import utc_now


def new_code(admin_client, headers) -> dict:
    response = admin_client.post("/api/group/device-codes", json={}, headers=headers)
    assert response.status_code == 201
    return response.get_json()


def enter(client, code):
    return client.post("/api/device/enter", json={"code": code}, headers=csrf(client))


def test_device_code_single_use(app, db_session):
    group = make_group()
    admin, _ = make_member(group, "admin@cafe.com", "admin")
    admin_client = app.test_client()
    body = new_code(admin_client, sign_in(admin_client, admin))
    assert len(body["code"]) == 8
    assert set(body["code"]) <= set("ABCDEFGHJKMNPQRSTUVWXYZ23456789")
    row = db_session.get(DeviceCode, body["id"])
    assert row.code_hash != body["code"] and body["code"] not in row.code_hash
    assert row.expires_at - utc_now() > timedelta(days=6, hours=23)

    tablet = app.test_client()
    first = enter(tablet, body["code"].lower())  # case-insensitive entry
    assert first.status_code == 200
    cookie = tablet.get_cookie("tasting_session")
    assert cookie is not None
    session = db_session.execute(db.select(Session).where(Session.kind == "device")).scalar_one()
    assert session.device_group_id == group.id and session.device_code_id == body["id"]
    assert session.expires_at - utc_now() > timedelta(days=364)

    other = app.test_client()
    assert enter(other, body["code"]).status_code == 400
    assert other.get_cookie("tasting_session") is None
    assert len(device_sessions()) == 1


def test_unknown_expired_and_revoked_codes_rejected(app, db_session):
    group = make_group()
    admin, _ = make_member(group, "admin@cafe.com", "admin")
    admin_client = app.test_client()
    headers = sign_in(admin_client, admin)
    assert enter(app.test_client(), "ZZZZZZZZ").status_code == 400
    assert enter(app.test_client(), None).status_code == 400

    expired = new_code(admin_client, headers)
    with freeze_time(utc_now() + timedelta(days=7, seconds=5)):
        assert enter(app.test_client(), expired["code"]).status_code == 400

    revoked = new_code(admin_client, headers)
    assert admin_client.delete(f"/api/group/device-codes/{revoked['id']}",
                               headers=headers).status_code == 200
    assert enter(app.test_client(), revoked["code"]).status_code == 400


def test_revoking_code_ends_device_sessions(app, db_session):
    group = make_group()
    admin, _ = make_member(group, "admin@cafe.com", "admin")
    admin_client = app.test_client()
    headers = sign_in(admin_client, admin)
    body = new_code(admin_client, headers)
    keep = new_code(admin_client, headers)
    tablet, kept_tablet = app.test_client(), app.test_client()
    assert enter(tablet, body["code"]).status_code == 200
    assert enter(kept_tablet, keep["code"]).status_code == 200
    assert tablet.get("/api/device/members").status_code == 200

    assert admin_client.delete(f"/api/group/device-codes/{body['id']}",
                               headers=headers).status_code == 200
    assert tablet.get("/api/device/members").status_code == 401
    assert kept_tablet.get("/api/device/members").status_code == 200
    assert all(s.revoked_at for s in device_sessions(body["id"]))
    assert not any(s.revoked_at for s in device_sessions(keep["id"]))


def test_revoke_other_groups_code_404(app, db_session):
    group, other = make_group("A"), make_group("B")
    admin, _ = make_member(group, "admin@cafe.com", "admin")
    other_admin, _ = make_member(other, "oadmin@cafe.com", "admin")
    other_client = app.test_client()
    code = new_code(other_client, sign_in(other_client, other_admin))
    client = app.test_client()
    headers = sign_in(client, admin)
    assert client.delete(f"/api/group/device-codes/{code['id']}", headers=headers).status_code == 404


def test_inactive_member_not_pickable_reads_kept(app, db_session):
    # The "reads kept" half lands with the tasting read paths (Task 7b).
    group, other = make_group(), make_group("Other")
    admin, _ = make_member(group, "admin@cafe.com", "admin", name="Zed")
    _, gone = make_member(group, "gone@cafe.com", "member", name="Amy", active=False)
    make_member(group, "bob@cafe.com", "member", name="bob")
    make_member(other, "x@else.com", "member", name="Elsewhere")
    admin_client = app.test_client()
    body = new_code(admin_client, sign_in(admin_client, admin))
    tablet = app.test_client()
    assert tablet.get("/api/device/members").status_code == 401
    enter(tablet, body["code"])
    listing = tablet.get("/api/device/members").get_json()
    assert [m["display_name"] for m in listing] == ["bob", "Zed"]
    assert set(listing[0]) == {"id", "display_name"}
    assert gone.id not in [m["id"] for m in listing]
