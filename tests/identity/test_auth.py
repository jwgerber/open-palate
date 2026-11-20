from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from freezegun import freeze_time

from app import create_app
from extensions import db
from identity import mail
from identity.models import Group, LoginToken, Member, Session, User
from utils import utc_now


@pytest.fixture
def sent(monkeypatch):
    """Capture sign-in emails instead of sending them."""
    outbox = []
    monkeypatch.setattr(mail, "send_signin_email", lambda to, link: outbox.append((to, link)))
    return outbox


def csrf(client) -> dict:
    """Fetch the CSRF cookie (any response sets it) and return the header."""
    client.get("/api/auth/me")
    return {"X-CSRF-Token": client.get_cookie("tasting_csrf").value}


def request_link(client, email, **headers):
    return client.post("/api/auth/request-link", json={"email": email},
                       headers={**csrf(client), **headers})


def token_from(link: str) -> str:
    return parse_qs(urlparse(link).query)["token"][0]


def add_user(email="owner@cafe.com", name="Owner", member=True):
    """A user; by default with an active member row, since a link goes only to those."""
    user = User(email=email, display_name=name)
    db.session.add(user)
    db.session.flush()
    if member:
        group = Group(name=f"Group of {name}")
        db.session.add(group)
        db.session.flush()
        db.session.add(Member(group_id=group.id, user_id=user.id, display_name=name,
                              email=email, role="member"))
    db.session.commit()
    return user


def test_request_link_unknown_email_sends_nothing_same_reply(client, db_session, sent):
    add_user("known@cafe.com")
    unknown = request_link(client, "nobody@cafe.com")
    known = request_link(client, "known@cafe.com")
    assert unknown.status_code == known.status_code == 200
    assert unknown.get_json() == known.get_json() == {"status": "sent"}
    assert [to for to, _ in sent] == ["known@cafe.com"]
    assert db_session.query(User).count() == 1
    assert db_session.query(LoginToken).count() == 1


def test_request_link_signup_creates_user_only_when_allowed(client, app, db_session, sent):
    request_link(client, "new@cafe.com")
    assert sent == []
    app.config["ALLOW_SIGNUP"] = True
    request_link(client, "new@cafe.com")
    assert [to for to, _ in sent] == ["new@cafe.com"]
    assert db_session.query(User).filter_by(email="new@cafe.com").count() == 1


def test_link_single_use_and_15_min_expiry(client, db_session, sent):
    add_user()
    request_link(client, "owner@cafe.com")
    link = sent[-1][1]
    first = client.get(f"/api/auth/consume?token={token_from(link)}")
    assert first.status_code == 302
    assert first.headers["Location"] == "/"
    again = client.get(f"/api/auth/consume?token={token_from(link)}")
    assert again.headers["Location"] == "/signin?error=expired"

    start = utc_now()
    with freeze_time(start):
        request_link(client, "owner@cafe.com")
    late_link = sent[-1][1]
    with freeze_time(start + timedelta(minutes=15, seconds=1)):
        late = client.get(f"/api/auth/consume?token={token_from(late_link)}")
    assert late.headers["Location"] == "/signin?error=expired"
    garbage = client.get("/api/auth/consume?token=not-a-token")
    assert garbage.headers["Location"] == "/signin?error=expired"


def sign_in(client, sent, email="owner@cafe.com"):
    request_link(client, email)
    return client.get(f"/api/auth/consume?token={token_from(sent[-1][1])}")


def test_session_rolls_30_days(client, db_session, sent):
    add_user()
    start = utc_now()
    with freeze_time(start):
        sign_in(client, sent)
        assert client.get("/api/auth/me").status_code == 200
    # Within the hour: no bump.
    with freeze_time(start + timedelta(minutes=30)):
        assert client.get("/api/auth/me").status_code == 200
        row = db_session.query(Session).one()
        db_session.refresh(row)
        assert row.last_seen_at == start
    # Activity at day 29 pushes expiry to day 59.
    with freeze_time(start + timedelta(days=29)):
        resp = client.get("/api/auth/me")
        assert resp.status_code == 200
        assert "tasting_session=" in " ".join(resp.headers.getlist("Set-Cookie"))
    with freeze_time(start + timedelta(days=58)):
        assert client.get("/api/auth/me").status_code == 200
    # 30 idle days later the session is gone.
    with freeze_time(start + timedelta(days=88, seconds=1)):
        assert client.get("/api/auth/me").status_code == 401


def test_idle_session_expires_after_30_days(client, db_session, sent):
    add_user()
    start = utc_now()
    with freeze_time(start):
        sign_in(client, sent)
    with freeze_time(start + timedelta(days=30, seconds=1)):
        assert client.get("/api/auth/me").status_code == 401


def test_logout_revokes_session(client, db_session, sent):
    add_user()
    sign_in(client, sent)
    assert client.post("/api/auth/logout", headers=csrf(client)).status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    assert db_session.query(Session).one().revoked_at is not None


def cookie_attrs(resp, name):
    header = next(h for h in resp.headers.getlist("Set-Cookie") if h.startswith(f"{name}="))
    return [part.strip().lower() for part in header.split(";")]


def test_non_get_without_csrf_header_403(client, db_session, sent):
    add_user()
    client.get("/api/auth/me")  # has the cookie, but sends no header
    missing = client.post("/api/auth/request-link", json={"email": "owner@cafe.com"})
    assert missing.status_code == 403
    assert missing.get_json() == {"error": "csrf"}
    wrong = client.post("/api/auth/request-link", json={"email": "owner@cafe.com"},
                        headers={"X-CSRF-Token": "nope"})
    assert wrong.status_code == 403
    no_cookie = client.application.test_client().post(
        "/api/auth/logout", headers={"X-CSRF-Token": "anything"})
    assert no_cookie.status_code == 403
    assert sent == []
    assert request_link(client, "owner@cafe.com").status_code == 200


def test_email_normalized_on_request_and_member_link(client, db_session, sent):
    group = Group(name="Cafe")
    db_session.add(group)
    db_session.flush()
    db_session.add(Member(group_id=group.id, display_name="Owner", email="Owner@Cafe.com",
                          role="admin"))
    db_session.commit()
    request_link(client, " Owner@Cafe.com")
    request_link(client, "OWNER@cafe.com ")
    assert [to for to, _ in sent] == ["owner@cafe.com", "owner@cafe.com"]
    users = db_session.query(User).all()
    assert [(u.email, u.display_name) for u in users] == [("owner@cafe.com", "Owner")]
    client.get(f"/api/auth/consume?token={token_from(sent[-1][1])}")
    member = db_session.query(Member).one()
    db_session.refresh(member)
    assert member.user_id == users[0].id


def test_inactive_member_email_gets_no_link(client, db_session, sent):
    group = Group(name="Cafe")
    db_session.add(group)
    db_session.flush()
    db_session.add(Member(group_id=group.id, display_name="Gone", email="gone@cafe.com",
                          role="member", active=False))
    db_session.commit()
    request_link(client, "gone@cafe.com")
    assert sent == []
    assert db_session.query(User).count() == 0


def test_request_link_known_user_without_active_member_sends_nothing(client, app, db_session, sent):
    # A user row left behind by a deactivated member, or made some other way, gets no link.
    gone = add_user("gone@cafe.com", "Gone", member=False)
    inactive = add_user("off@cafe.com", "Off")
    db_session.query(Member).filter_by(user_id=inactive.id).update({"active": False})
    db_session.commit()
    for email in ("gone@cafe.com", "off@cafe.com"):
        reply = request_link(client, email)
        assert reply.status_code == 200 and reply.get_json() == {"status": "sent"}
    assert sent == []
    assert db_session.query(LoginToken).count() == 0
    # ...unless sign-up is on, or an active roster row carries the address.
    app.config["ALLOW_SIGNUP"] = True
    request_link(client, "gone@cafe.com")
    assert [to for to, _ in sent] == ["gone@cafe.com"]
    app.config["ALLOW_SIGNUP"] = False
    group = Group(name="Roster")
    db_session.add(group)
    db_session.flush()
    db_session.add(Member(group_id=group.id, display_name="Off", email="off@cafe.com", role="member"))
    db_session.commit()
    request_link(client, "off@cafe.com")
    assert [to for to, _ in sent] == ["gone@cafe.com", "off@cafe.com"]


def test_consume_links_roster_member(client, db_session, sent):
    user = add_user(member=False)
    cafe, other = Group(name="Cafe", timezone="America/Chicago"), Group(name="Other")
    db_session.add_all([cafe, other])
    db_session.flush()
    db_session.add_all([
        Member(group_id=cafe.id, display_name="Owner", email="owner@cafe.com", role="editor"),
        Member(group_id=other.id, display_name="Someone", email="someone@cafe.com",
               role="member"),
    ])
    db_session.commit()
    sign_in(client, sent)
    me = client.get("/api/auth/me").get_json()
    assert me["kind"] == "user"
    assert me["user"]["email"] == "owner@cafe.com"
    assert me["groups"] == [{"id": cafe.id, "name": "Cafe", "role": "editor",
                             "timezone": "America/Chicago", "is_personal": False}]
    assert db_session.query(Member).filter_by(user_id=user.id).count() == 1


def test_me_without_session_401(client):
    assert client.get("/api/auth/me").status_code == 401


def test_signin_link_uses_base_url_not_host_header(app, db_session, sent):
    add_user()
    # The cookie jar is per host, so send the double-submit pair by hand.
    resp = app.test_client(use_cookies=False).post(
        "/api/auth/request-link", json={"email": "owner@cafe.com"},
        headers={"Host": "evil.example", "X-Forwarded-Host": "evil.example",
                 "X-Forwarded-Proto": "https", "Cookie": "tasting_csrf=abc",
                 "X-CSRF-Token": "abc"})
    assert resp.status_code == 200
    assert sent[-1][1].startswith("http://localhost/api/auth/consume?token=")


def test_request_link_rate_limited(client, db_session, sent):
    headers = csrf(client)
    codes = [client.post("/api/auth/request-link", json={"email": "x@cafe.com"},
                         headers=headers).status_code for _ in range(6)]
    assert codes == [200] * 5 + [429]


def test_request_link_rejects_bad_email(client, db_session, sent):
    resp = client.post("/api/auth/request-link", json={"email": "no-at-sign"},
                       headers=csrf(client))
    assert resp.status_code == 400


def make_logging_app(database_url):
    # IN_CONTAINER: the test client is a local peer, which would otherwise be "open"
    # and make these token checks vacuous.
    return create_app({"TESTING": True, "LOG_SETUP_LINK": True, "IN_CONTAINER": True,
                       "SECRET_KEY": "test-secret", "BASE_URL": "http://localhost",
                       "SQLALCHEMY_DATABASE_URI": database_url})


def setup_links(caplog):
    return [r.getMessage() for r in caplog.records
            if r.levelname == "WARNING" and "/setup?token=" in r.getMessage()]


def test_setup_link_wording_depends_on_container(app, database_url, caplog):
    caplog.set_level("WARNING")
    make_logging_app(database_url)
    in_container = setup_links(caplog)[0]
    assert "this machine" not in in_container
    assert "SETUP_PASSWORD" in in_container
    caplog.clear()
    create_app({"TESTING": True, "LOG_SETUP_LINK": True, "IN_CONTAINER": False,
                "SECRET_KEY": "test-secret", "BASE_URL": "http://localhost",
                "SQLALCHEMY_DATABASE_URI": database_url})
    assert "this machine" in setup_links(caplog)[0]


def test_setup_link_wording_when_open_setup_is_off(app, database_url, caplog):
    caplog.set_level("WARNING")
    create_app({"TESTING": True, "LOG_SETUP_LINK": True, "IN_CONTAINER": False, "SETUP_OPEN": False,
                "SECRET_KEY": "test-secret", "BASE_URL": "http://localhost",
                "SQLALCHEMY_DATABASE_URI": database_url})
    message = setup_links(caplog)[0]
    assert "this machine" not in message
    assert "SETUP_PASSWORD" in message


def test_setup_link_logged_until_admin_exists(app, database_url, caplog):
    caplog.set_level("WARNING")
    assert setup_links(caplog) == []  # TESTING apps stay quiet by default
    setup_app = make_logging_app(database_url)
    logged = setup_links(caplog)
    assert len(logged) == 1
    link = logged[0][logged[0].index("http://"):].split()[0]
    assert link.startswith("http://localhost/setup?token=")
    token = token_from(link)

    test_client = setup_app.test_client()
    headers = csrf(test_client)
    bad = test_client.post("/api/auth/setup", headers=headers,
                           json={"token": token + "x", "email": "a@b.co", "display_name": "A"})
    assert bad.status_code == 400
    ok = test_client.post("/api/auth/setup", headers=headers,
                          json={"token": token, "email": " Owner@Cafe.com",
                                "display_name": "Owner"})
    assert ok.status_code == 200
    me = test_client.get("/api/auth/me").get_json()
    assert me["user"]["email"] == "owner@cafe.com"
    assert [(g["name"], g["role"], g["timezone"]) for g in me["groups"]] == [
        ("My café", "admin", "UTC")]

    reuse = test_client.post("/api/auth/setup", headers=headers,
                             json={"token": token, "email": "x@cafe.com", "display_name": "X"})
    assert reuse.status_code == 409

    caplog.clear()
    make_logging_app(database_url)
    assert setup_links(caplog) == []


def test_setup_token_expires_after_15_min(app, database_url, caplog):
    caplog.set_level("WARNING")
    start = utc_now()
    with freeze_time(start):
        setup_app = make_logging_app(database_url)
    message = setup_links(caplog)[0]
    token = token_from(message[message.index("http://"):].split()[0])
    test_client = setup_app.test_client()
    headers = csrf(test_client)
    with freeze_time(start + timedelta(minutes=15, seconds=1)):
        late = test_client.post("/api/auth/setup", headers=headers,
                                json={"token": token, "email": "a@cafe.com",
                                      "display_name": "A"})
    assert late.status_code == 400


# --- Review fixes (R7) ---

def test_request_link_survives_concurrent_user_insert(client, db_session, sent, monkeypatch):
    """A concurrent request created the user between our lookup and insert."""
    from identity import auth_routes
    group = Group(name="Cafe")
    db_session.add(group)
    db_session.flush()
    db_session.add(Member(group_id=group.id, display_name="Owner", email="owner@cafe.com",
                          role="member"))
    add_user()  # the "other request's" row, already committed
    real_find = auth_routes.find_user
    calls = []

    def stale_first_lookup(email):
        calls.append(email)
        return None if len(calls) == 1 else real_find(email)
    monkeypatch.setattr(auth_routes, "find_user", stale_first_lookup)

    resp = request_link(client, "owner@cafe.com")
    assert resp.status_code == 200
    assert resp.get_json() == {"status": "sent"}
    assert [to for to, _ in sent] == ["owner@cafe.com"]
    assert db_session.query(User).count() == 1


def test_current_session_bump_does_not_commit_callers_work(app, db_session):
    from identity.sessions import current_session
    from identity.tokens import new_token
    user = add_user(member=False)
    raw, digest = new_token()
    long_ago = utc_now() - timedelta(hours=2)
    db_session.add(Session(user_id=user.id, kind="user", token_hash=digest,
                           created_at=long_ago, last_seen_at=long_ago,
                           expires_at=long_ago + timedelta(days=30)))
    db_session.commit()

    with app.test_request_context("/", headers={"Cookie": f"tasting_session={raw}"}):
        db_session.add(Group(name="Staged, never committed"))
        row = current_session()
        assert row is not None and row.last_seen_at > long_ago
        db_session.rollback()

    assert db_session.query(Group).count() == 0
    bumped = db_session.query(Session).one()
    db_session.refresh(bumped)
    assert bumped.last_seen_at > long_ago  # the bump itself did persist


def test_consume_revokes_previous_browser_session(client, db_session, sent):
    add_user()
    sign_in(client, sent)
    sign_in(client, sent)
    rows = db_session.query(Session).order_by(Session.id).all()
    assert [r.revoked_at is not None for r in rows] == [True, False]
    assert client.get("/api/auth/me").status_code == 200


def test_setup_revokes_previous_browser_session(app, database_url, caplog, sent):
    caplog.set_level("WARNING")
    setup_app = make_logging_app(database_url)
    message = setup_links(caplog)[0]
    token = token_from(message[message.index("http://"):].split()[0])
    test_client = setup_app.test_client()
    with setup_app.app_context():
        add_user("someone@cafe.com", "Someone", member=False)
    # Sign in as an existing user (no group yet) on this browser first.
    from identity.tokens import new_token
    raw, digest = new_token()
    with setup_app.app_context():
        user = db.session.query(User).one()
        db.session.add(LoginToken(user_id=user.id, token_hash=digest, purpose="signin",
                                  expires_at=utc_now() + timedelta(minutes=15)))
        db.session.commit()
    test_client.get(f"/api/auth/consume?token={raw}")
    resp = test_client.post("/api/auth/setup", headers=csrf(test_client),
                            json={"token": token, "email": "owner@cafe.com",
                                  "display_name": "Owner"})
    assert resp.status_code == 200
    with setup_app.app_context():
        rows = db.session.query(Session).order_by(Session.id).all()
        assert [r.revoked_at is not None for r in rows] == [True, False]


def test_consume_does_not_link_inactive_member(client, db_session, sent):
    add_user()   # active in some other group, so a link is sent
    group = Group(name="Cafe")
    db_session.add(group)
    db_session.flush()
    db_session.add(Member(group_id=group.id, display_name="Owner", email="owner@cafe.com",
                          role="member", active=False))
    db_session.commit()
    sign_in(client, sent)
    member = db_session.query(Member).filter_by(display_name="Owner", active=False).one()
    db_session.refresh(member)
    assert member.user_id is None


def test_access_log_redacts_signin_token(app, caplog):
    import logging
    from identity.log_redact import RedactTokenFilter
    record = logging.LogRecord("werkzeug", logging.INFO, __file__, 1, '"%s" %s %s',
                               ("GET /api/auth/consume?token=s3cr3t-Tok_en&x=1 HTTP/1.1",
                                "302", "-"), None)
    assert RedactTokenFilter().filter(record) is True
    assert "s3cr3t" not in record.getMessage()
    assert "/api/auth/consume?token=[redacted]&x=1" in record.getMessage()

    caplog.set_level("INFO", logger="werkzeug")
    logging.getLogger("werkzeug").info('"%s" %s %s',
                                       "GET /api/auth/consume?token=abc123 HTTP/1.1", "302", "-")
    assert "abc123" not in caplog.text
    assert "token=[redacted]" in caplog.text


def open_setup(app, database_url):
    setup_app = create_app({"TESTING": True, "SECRET_KEY": "test-secret",
                            "BASE_URL": "http://localhost", "SETUP_OPEN": True,
                            "SQLALCHEMY_DATABASE_URI": database_url})
    client = setup_app.test_client()
    return setup_app, client, csrf(client)


SETUP_BODY = {"email": "boss@example.com", "display_name": "Boss"}


def test_setup_sets_owner(app, database_url):
    setup_app, client, headers = open_setup(app, database_url)
    assert client.post("/api/auth/setup", json=SETUP_BODY, headers=headers).status_code == 200
    with setup_app.app_context():
        assert db.session.query(User).one().is_owner is True


def test_setup_status_after_owner(app, database_url):
    setup_app, client, headers = open_setup(app, database_url)
    assert client.get("/api/auth/setup-status").get_json()["needed"] is True
    client.post("/api/auth/setup", json=SETUP_BODY, headers=headers)
    assert client.get("/api/auth/setup-status").get_json() == {"needed": False, "email": False}


def test_setup_needed_false_with_group_but_no_owner(app, database_url):
    setup_app, client, headers = open_setup(app, database_url)
    with setup_app.app_context():
        db.session.add(Group(name="Old", timezone="UTC"))
        db.session.commit()
    assert client.get("/api/auth/setup-status").get_json() == {"needed": False, "email": False}
    assert client.post("/api/auth/setup", json=SETUP_BODY, headers=headers).status_code == 409


def test_setup_needed_ignores_personal_groups(app, db_session):
    from identity.accounts import setup_needed
    user = User(email="p@example.com", display_name="P")
    db.session.add(user)
    db.session.flush()
    db.session.add(Group(name="P", timezone="UTC", is_personal=True, personal_user_id=user.id))
    db.session.commit()
    assert setup_needed() is True


def test_race_counts_owners(app, database_url, monkeypatch):
    setup_app, client, headers = open_setup(app, database_url)
    monkeypatch.setattr("identity.auth_routes.more_than_one_owner", lambda: True)
    resp = client.post("/api/auth/setup", json=SETUP_BODY, headers=headers)
    assert (resp.status_code, resp.get_json()["error"]) == (409, "setup_done")
    with setup_app.app_context():
        assert db.session.query(User).count() == 0


def test_me_reports_owner_and_personal(app, db_session):
    from tests.identity.helpers import sign_in
    user = User(email="o@cafe.com", display_name="O", is_owner=True)
    db.session.add(user)
    db.session.flush()
    team = Group(name="Team")
    mine = Group(name="My tastings", is_personal=True, personal_user_id=user.id)
    db.session.add_all([team, mine])
    db.session.flush()
    db.session.add_all([Member(group_id=g.id, user_id=user.id, display_name="O", role="admin")
                        for g in (team, mine)])
    db.session.commit()
    client = app.test_client()
    sign_in(client, user)
    body = client.get("/api/auth/me").get_json()
    assert body["user"]["is_owner"] is True
    assert {g["name"]: g["is_personal"] for g in body["groups"]} == {"Team": False,
                                                                     "My tastings": True}


def test_request_link_owner_without_membership_gets_link(client, db_session, sent):
    db_session.add(User(email="owner@cafe.com", display_name="Owner", is_owner=True))
    db_session.commit()
    known = request_link(client, "owner@cafe.com")
    unknown = request_link(client, "nobody@cafe.com")
    assert known.status_code == unknown.status_code == 200
    assert known.get_json() == unknown.get_json() == {"status": "sent"}
    assert [to for to, _ in sent] == ["owner@cafe.com"]
    assert db_session.query(LoginToken).count() == 1
