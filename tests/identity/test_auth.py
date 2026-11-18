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


def add_user(email="owner@cafe.com", name="Owner"):
    user = User(email=email, display_name=name)
    db.session.add(user)
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
    assert first.headers["Location"] == "http://localhost/"
    again = client.get(f"/api/auth/consume?token={token_from(link)}")
    assert again.headers["Location"] == "http://localhost/signin?error=expired"

    start = utc_now()
    with freeze_time(start):
        request_link(client, "owner@cafe.com")
    late_link = sent[-1][1]
    with freeze_time(start + timedelta(minutes=15, seconds=1)):
        late = client.get(f"/api/auth/consume?token={token_from(late_link)}")
    assert late.headers["Location"] == "http://localhost/signin?error=expired"
    garbage = client.get("/api/auth/consume?token=not-a-token")
    assert garbage.headers["Location"] == "http://localhost/signin?error=expired"


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


@pytest.mark.parametrize("base_url, secure", [
    ("https://tasting.example", True),
    ("http://localhost", False),
])
def test_secure_flag_follows_base_url_scheme(app, database_url, base_url, secure):
    other = create_app({"TESTING": True, "SECRET_KEY": "test-secret",
                        "BASE_URL": base_url, "SQLALCHEMY_DATABASE_URI": database_url})
    with other.app_context():
        user = add_user()
        from identity.tokens import new_token
        raw, digest = new_token()
        db.session.add(LoginToken(user_id=user.id, token_hash=digest, purpose="signin",
                                  expires_at=utc_now() + timedelta(minutes=15)))
        db.session.commit()
        db.session.remove()
    test_client = other.test_client()
    consume = test_client.get(f"/api/auth/consume?token={raw}")
    session_attrs = cookie_attrs(consume, "tasting_session")
    csrf_attrs = cookie_attrs(consume, "tasting_csrf")
    assert ("secure" in session_attrs) is secure
    assert ("secure" in csrf_attrs) is secure
    assert "httponly" in session_attrs
    assert "httponly" not in csrf_attrs
    assert "samesite=lax" in session_attrs and "samesite=lax" in csrf_attrs


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


def test_consume_links_roster_member(client, db_session, sent):
    user = add_user()
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
                             "timezone": "America/Chicago"}]
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
    return create_app({"TESTING": True, "LOG_SETUP_LINK": True, "SECRET_KEY": "test-secret",
                       "BASE_URL": "http://localhost", "SQLALCHEMY_DATABASE_URI": database_url})


def setup_links(caplog):
    return [r.getMessage() for r in caplog.records
            if r.levelname == "WARNING" and "/setup?token=" in r.getMessage()]


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
