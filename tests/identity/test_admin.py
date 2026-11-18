from extensions import db
from identity.models import Group, Member
from tests.identity.helpers import make_group, make_member, sign_in


def setup_admin(app):
    group = make_group()
    admin, member = make_member(group, "admin@cafe.com", "admin")
    client = app.test_client()
    return group, member, client, sign_in(client, admin)


def test_last_admin_cannot_be_demoted(app, db_session):
    group, me, client, headers = setup_admin(app)
    url = f"/api/group/members/{me.id}"
    for change in ({"role": "editor"}, {"active": False}):
        response = client.patch(url, json=change, headers=headers)
        assert response.status_code == 409
        assert response.get_json()["error"] == "last_admin"
    assert db.session.get(Member, me.id).role == "admin"
    # a second admin may be demoted while one remains; an inactive admin doesn't count
    _, second = make_member(group, "two@cafe.com", "admin")
    _, inactive = make_member(group, "off@cafe.com", "admin", active=False)
    assert client.patch(f"/api/group/members/{second.id}", json={"role": "member"},
                        headers=headers).status_code == 200
    assert client.patch(url, json={"active": False}, headers=headers).status_code == 409
    assert client.patch(url, json={"role": "member"}, headers=headers).status_code == 409
    assert client.patch(f"/api/group/members/{inactive.id}", json={"active": True},
                        headers=headers).status_code == 200
    assert client.patch(url, json={"role": "member"}, headers=headers).status_code == 200


def test_bad_timezone_422(app, db_session):
    group, _, client, headers = setup_admin(app)
    response = client.patch("/api/group", json={"timezone": "Mars/Base"}, headers=headers)
    assert response.status_code == 422
    assert response.get_json()["error"] == "bad_timezone"
    ok = client.patch("/api/group", json={"name": "Roastery", "timezone": "America/New_York"},
                      headers=headers)
    assert ok.status_code == 200
    got = client.get("/api/group").get_json()
    assert got["name"] == "Roastery" and got["timezone"] == "America/New_York"
    assert db.session.get(Group, group.id).timezone == "America/New_York"


def test_member_cannot_reach_admin_routes_403(app, db_session):
    group = make_group()
    for role in ("member", "editor"):
        user, _ = make_member(group, f"{role}@cafe.com", role)
        client = app.test_client()
        headers = sign_in(client, user)
        assert client.get("/api/group").status_code == 403
        assert client.get("/api/group/members").status_code == 403
        assert client.post("/api/group/members", json={"display_name": "X"},
                           headers=headers).status_code == 403
        assert client.post("/api/group/device-codes", json={}, headers=headers).status_code == 403
    assert app.test_client().get("/api/group").status_code == 401


def test_device_session_cannot_reach_admin_routes_403(app, db_session):
    group, _, admin_client, headers = setup_admin(app)
    code = admin_client.post("/api/group/device-codes", json={}, headers=headers).get_json()
    tablet = app.test_client()
    from tests.identity.helpers import csrf
    tablet.post("/api/device/enter", json={"code": code["code"]}, headers=csrf(tablet))
    assert tablet.get("/api/group/members").status_code == 403
    assert tablet.post("/api/group/device-codes", json={}, headers=csrf(tablet)).status_code == 403


def test_member_crud(app, db_session):
    group, _, client, headers = setup_admin(app)
    created = client.post("/api/group/members", headers=headers,
                          json={"display_name": " Ann ", "email": " Ann@Cafe.com ",
                                "role": "editor"})
    assert created.status_code == 201
    body = created.get_json()
    assert body["display_name"] == "Ann" and body["email"] == "ann@cafe.com"
    assert body["role"] == "editor" and body["active"] is True
    dup = client.post("/api/group/members", headers=headers,
                      json={"display_name": "Ann2", "email": "ANN@cafe.com"})
    assert dup.status_code == 409
    assert client.post("/api/group/members", headers=headers,
                       json={"display_name": "B", "role": "boss"}).status_code == 400
    assert client.post("/api/group/members", headers=headers,
                       json={"display_name": ""}).status_code == 400
    patched = client.patch(f"/api/group/members/{body['id']}", headers=headers,
                           json={"display_name": "Anne", "active": False})
    assert patched.get_json()["display_name"] == "Anne" and patched.get_json()["active"] is False
    names = [m["display_name"] for m in client.get("/api/group/members").get_json()]
    assert names == sorted(names, key=str.lower) and "Anne" in names


def test_other_groups_member_404(app, db_session):
    group, _, client, headers = setup_admin(app)
    other = make_group("B")
    _, foreign = make_member(other, "f@else.com", "member")
    assert client.patch(f"/api/group/members/{foreign.id}", json={"active": False},
                        headers=headers).status_code == 404
    assert db.session.get(Member, foreign.id).active is True
