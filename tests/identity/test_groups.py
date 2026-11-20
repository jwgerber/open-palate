"""Teams, personal spaces and the owner's install routes."""
from flask import Response

from extensions import db
from identity.models import Group, Member, User
from identity.sessions import SESSION_COOKIE, start_device_session
from tests.identity.helpers import csrf, make_group, make_member, sign_in


TEAM_ONLY_ENDPOINTS = {
    "admin.list_members", "admin.add_member", "admin.patch_member", "admin.copy_signin_link",
    "admin.list_device_codes", "admin.create_device_code", "admin.revoke_device_code",
    "admin.post_sample_data", "admin.delete_sample_data",
}


def make_owner(email="owner@cafe.com") -> User:
    user = User(email=email, display_name="Owner", is_owner=True)
    db.session.add(user)
    db.session.commit()
    return user


def owner_client(app):
    owner = make_owner()
    client = app.test_client()
    return owner, client, sign_in(client, owner)


def device_client(app, group):
    client = app.test_client()
    response = start_device_session(group.id)(Response())
    db.session.commit()
    raw = response.headers.get_all("Set-Cookie")[0].split(";")[0].split("=", 1)[1]
    client.set_cookie(SESSION_COOKIE, raw)
    return client, csrf(client)


def test_owner_makes_team_and_is_admin(app, db_session):
    owner, client, headers = owner_client(app)
    resp = client.post("/api/groups", json={"name": " Roastery ", "timezone": "America/Chicago"},
                       headers=headers)
    assert resp.status_code == 201
    body = resp.get_json()
    assert body == {"id": body["id"], "name": "Roastery", "timezone": "America/Chicago",
                    "role": "admin", "is_personal": False}
    member = db.session.execute(db.select(Member).where(Member.group_id == body["id"])).scalar_one()
    assert member.user_id == owner.id and member.role == "admin"
    assert member.display_name == "Owner" and member.active


def test_non_owner_cannot_make_team_403(app, db_session):
    make_owner()
    user, _ = make_member(make_group(), "a@cafe.com", "admin")
    client = app.test_client()
    headers = sign_in(client, user)
    resp = client.post("/api/groups", json={"name": "X", "timezone": "UTC"}, headers=headers)
    assert resp.status_code == 403 and resp.get_json()["error"] == "forbidden"


def test_make_team_refused_while_setup_needed_409(app, db_session):
    user = User(email="a@cafe.com", display_name="A")
    db.session.add(user)
    db.session.commit()
    client = app.test_client()
    headers = sign_in(client, user)
    resp = client.post("/api/groups", json={"name": "X", "timezone": "UTC"}, headers=headers)
    assert resp.status_code == 409 and resp.get_json()["error"] == "setup_needed"


def test_make_team_validates_name_and_timezone(app, db_session):
    _, client, headers = owner_client(app)
    for name in ("", "   ", "x" * 121, None, 5):
        resp = client.post("/api/groups", json={"name": name, "timezone": "UTC"}, headers=headers)
        assert resp.status_code == 400 and resp.get_json()["field"] == "name"
    resp = client.post("/api/groups", json={"name": "Ok", "timezone": "Mars/Base"}, headers=headers)
    assert resp.status_code == 422 and resp.get_json()["error"] == "bad_timezone"


def test_personal_space_created_once(app, db_session):
    make_group()  # a team exists, so setup is done
    user = User(email="p@cafe.com", display_name="Pat")
    db.session.add(user)
    db.session.commit()
    client = app.test_client()
    headers = sign_in(client, user)
    first = client.post("/api/groups/personal", json={}, headers=headers)
    assert first.status_code == 201
    body = first.get_json()
    assert body["is_personal"] is True and body["name"] == "My tastings" and body["role"] == "admin"
    second = client.post("/api/groups/personal", json={}, headers=headers)
    assert second.status_code == 200 and second.get_json()["id"] == body["id"]
    group = db.session.get(Group, body["id"])
    assert group.personal_user_id == user.id
    rows = db.session.execute(db.select(Member).where(Member.group_id == group.id)).scalars().all()
    assert len(rows) == 1 and rows[0].user_id == user.id and rows[0].role == "admin"


def test_personal_space_uses_first_group_timezone(app, db_session):
    user, _ = make_member(make_group(timezone="Europe/Paris"), "p@cafe.com")
    client = app.test_client()
    headers = sign_in(client, user)
    body = client.post("/api/groups/personal", json={}, headers=headers).get_json()
    assert body["timezone"] == "Europe/Paris"


def test_personal_space_refused_while_setup_needed(app, db_session):
    user = User(email="p@cafe.com", display_name="Pat")
    db.session.add(user)
    db.session.commit()
    client = app.test_client()
    resp = client.post("/api/groups/personal", json={}, headers=sign_in(client, user))
    assert resp.status_code == 409 and resp.get_json()["error"] == "setup_needed"


def test_personal_space_works_with_no_groups(app, db_session):
    """An owner exists, no team yet: personal spaces are allowed."""
    make_owner()
    user = User(email="p@cafe.com", display_name="Pat")
    db.session.add(user)
    db.session.commit()
    client = app.test_client()
    resp = client.post("/api/groups/personal", json={}, headers=sign_in(client, user))
    assert resp.status_code == 201 and resp.get_json()["timezone"] == "UTC"


def test_personal_space_has_no_roster_or_codes(app, db_session):
    make_group()
    user = User(email="p@cafe.com", display_name="Pat")
    db.session.add(user)
    db.session.commit()
    client = app.test_client()
    headers = sign_in(client, user)
    pid = client.post("/api/groups/personal", json={}, headers=headers).get_json()["id"]
    scoped = {**headers, "X-Group": str(pid)}
    team_only_rules = [r for r in app.url_map.iter_rules() if r.endpoint in TEAM_ONLY_ENDPOINTS]
    calls = [(r, m) for r in team_only_rules for m in r.methods - {"HEAD", "OPTIONS"}]
    assert len(calls) == 9
    for rule, method in calls:
        path = rule.rule.replace("<int:member_id>", "1").replace("<int:code_id>", "1")
        body = {"json": {"display_name": "x"}} if method in ("POST", "PATCH") else {}
        resp = getattr(client, method.lower())(path, headers=scoped, **body)
        assert resp.status_code == 404, f"{method} {rule.rule}: {resp.status_code}"
    assert client.get("/api/group", headers=scoped).status_code == 200


def test_device_enter_refuses_personal_group_code(app, db_session):
    from identity.accounts import new_device_code
    from identity.models import DeviceCode
    from identity.tokens import hash_token
    from utils import utc_now
    from datetime import timedelta
    user = User(email="p@cafe.com", display_name="Pat")
    db.session.add(user)
    db.session.flush()
    group = Group(name="My tastings", is_personal=True, personal_user_id=user.id)
    db.session.add(group)
    db.session.flush()
    code = new_device_code()
    db.session.add(DeviceCode(group_id=group.id, code_hash=hash_token(code), created_by=user.id,
                              expires_at=utc_now() + timedelta(hours=1)))
    db.session.commit()
    client = app.test_client()
    resp = client.post("/api/device/enter", json={"code": code}, headers=csrf(client))
    assert resp.status_code == 404 and resp.get_json()["error"] == "not_found"


def test_owner_routes_refuse_non_owner_403(app, db_session):
    make_owner()
    user, _ = make_member(make_group(), "a@cafe.com", "admin")
    client = app.test_client()
    headers = sign_in(client, user)
    assert client.get("/api/install", headers=headers).status_code == 403
    assert client.patch("/api/install", json={"public_url": None}, headers=headers).status_code == 403
    assert client.get("/api/install/groups", headers=headers).status_code == 403


def test_owner_routes_refuse_device_403(app, db_session):
    client, headers = device_client(app, make_group())
    assert client.get("/api/install", headers=headers).status_code == 403
    assert client.get("/api/install/groups", headers=headers).status_code == 403
    assert client.post("/api/groups", json={"name": "X", "timezone": "UTC"},
                       headers=headers).status_code == 403
    assert client.post("/api/groups/personal", json={}, headers=headers).status_code == 403


def test_install_groups_lists_names_and_counts_only(app, db_session):
    owner, client, headers = owner_client(app)
    team = make_group("Roastery")
    make_member(team, "a@cafe.com")
    make_member(team, "b@cafe.com", active=False)
    db.session.add(Member(group_id=team.id, display_name="Sample", role="member", is_sample=True))
    personal = Group(name="My tastings", is_personal=True, personal_user_id=owner.id)
    db.session.add(personal)
    db.session.commit()
    resp = client.get("/api/install/groups", headers=headers)
    assert resp.status_code == 200
    assert resp.get_json() == [{"id": team.id, "name": "Roastery", "member_count": 1}]


def test_owner_without_membership_gets_404_inside_group(app, db_session):
    _, client, headers = owner_client(app)
    other = make_group("B")
    resp = client.get("/api/group", headers={**headers, "X-Group": str(other.id)})
    assert resp.status_code == 404


def test_get_install_reports_url_and_address(app, db_session):
    _, client, headers = owner_client(app)
    assert client.get("/api/install", headers=headers).get_json() == {
        "public_url": None, "address": "http://localhost"}


def test_patch_install_rejects_bad_urls(app, db_session):
    _, client, headers = owner_client(app)
    for bad in ("ftp://x", "http://", "http://x/path", "http://x?q=1", "http://x#f", 5, ""):
        resp = client.patch("/api/install", json={"public_url": bad}, headers=headers)
        assert resp.status_code == 400 and resp.get_json()["field"] == "public_url", bad
    resp = client.patch("/api/install", json={"public_url": "http://192.168.1.40:8000/"},
                        headers=headers)
    assert resp.status_code == 200
    assert resp.get_json() == {"public_url": "http://192.168.1.40:8000",
                               "address": "http://192.168.1.40:8000"}
    assert client.get("/api/install", headers=headers).get_json()["public_url"] == \
        "http://192.168.1.40:8000"
    cleared = client.patch("/api/install", json={"public_url": None}, headers=headers)
    assert cleared.get_json() == {"public_url": None, "address": "http://localhost"}


def test_patch_install_rejects_overlong_url(app, db_session):
    _, client, headers = owner_client(app)
    too_long = "https://" + "a" * 250 + ".com"
    resp = client.patch("/api/install", json={"public_url": too_long}, headers=headers)
    assert resp.status_code == 400 and resp.get_json()["field"] == "public_url"
    edge = "https://" + "a" * 60 + "." + "b" * 60 + "." + "c" * 60 + "." + "d" * 60 + ".com"
    assert len(edge) <= 255
    ok = client.patch("/api/install", json={"public_url": edge}, headers=headers)
    assert ok.status_code == 200


def test_patch_install_rejects_bad_hostnames(app, db_session):
    _, client, headers = owner_client(app)
    for bad in ("http://a b.com", "http://a_b.com", "http://a..com", "http://.a.com",
                "http://a.com.", "http://-a.com", "http://[zz]", "http://ex%41mple.com",
                "http://a,b.com", "http://é.com"):
        resp = client.patch("/api/install", json={"public_url": bad}, headers=headers)
        assert resp.status_code == 400 and resp.get_json()["field"] == "public_url", bad
    for good in ("http://localhost:8000", "https://tasting.example.com", "http://10.0.0.5",
                 "http://[::1]:8000", "http://My-Host.local"):
        resp = client.patch("/api/install", json={"public_url": good}, headers=headers)
        assert resp.status_code == 200, good
