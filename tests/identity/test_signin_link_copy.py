import logging
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

from extensions import db
from identity.accounts import issue_signin_link
from identity.models import LoginToken, Member, Session, User
from tests.identity.helpers import make_group, make_member, sign_in
from utils import utc_now


def token_from(link: str) -> str:
    return parse_qs(urlparse(link).query)["token"][0]


def setup_admin(app):
    group = make_group()
    admin, admin_member = make_member(group, "admin@cafe.com", "admin")
    client = app.test_client()
    return group, admin_member, client, sign_in(client, admin)


def add_roster_member(group, email="robin@cafe.com", active=True) -> Member:
    member = Member(group_id=group.id, display_name="Robin", email=email, role="member",
                    active=active)
    db.session.add(member)
    db.session.commit()
    return member


def copy_link(client, headers, member):
    return client.post(f"/api/group/members/{member.id}/signin-link", json={}, headers=headers)


def consume(app, link):
    return app.test_client().get(f"/api/auth/consume?token={token_from(link)}")


def test_admin_gets_a_24h_link(app, db_session):
    group, _, client, headers = setup_admin(app)
    member = add_roster_member(group)
    response = copy_link(client, headers, member)
    assert response.status_code == 200
    body = response.get_json()
    assert "/api/auth/consume?token=" in body["link"]
    token = db.session.execute(db.select(LoginToken).order_by(LoginToken.id.desc())).scalars().first()
    assert token.purpose == "signin"
    assert abs((token.expires_at - utc_now()) - timedelta(hours=24)) < timedelta(minutes=1)
    assert body["expires_at"] == token.expires_at.isoformat() + "+00:00"
    redeemed = consume(app, body["link"])
    assert redeemed.status_code == 302 and redeemed.headers["Location"].endswith("/")
    assert redeemed.headers.get("Set-Cookie")


def test_link_works_once(app, db_session):
    group, _, client, headers = setup_admin(app)
    link = copy_link(client, headers, add_roster_member(group)).get_json()["link"]
    assert consume(app, link).headers["Location"].endswith("/")
    again = consume(app, link)
    assert again.headers["Location"].endswith("/signin?error=expired")


def test_link_creates_user_even_when_signup_off(app, db_session):
    app.config["ALLOW_SIGNUP"] = False
    group, _, client, headers = setup_admin(app)
    member = add_roster_member(group)
    assert copy_link(client, headers, member).status_code == 200
    user = db.session.execute(db.select(User).where(User.email == "robin@cafe.com")).scalar_one()
    assert db.session.get(Member, member.id).user_id == user.id


def test_link_reuses_existing_user_and_kills_older_links(app, db_session):
    group, _, client, headers = setup_admin(app)
    user, member = make_member(group, "robin@cafe.com")
    old, _ = issue_signin_link(user)
    db.session.commit()
    new = copy_link(client, headers, member).get_json()["link"]
    assert consume(app, old).headers["Location"].endswith("/signin?error=expired")
    assert consume(app, new).headers["Location"].endswith("/")
    assert db.session.execute(db.select(User).where(User.email == "robin@cafe.com")).scalars().all() == [user]


def test_default_issue_does_not_supersede(app, db_session):
    user = User(email="a@cafe.com", display_name="a")
    db.session.add(user)
    db.session.flush()
    first, _ = issue_signin_link(user)
    issue_signin_link(user)
    db.session.commit()
    assert consume(app, first).headers["Location"].endswith("/")


def test_refusals(app, db_session):
    group, _, client, headers = setup_admin(app)
    # non-admin
    _, plain = make_member(group, "plain@cafe.com")
    plain_client = app.test_client()
    plain_headers = sign_in(plain_client, db.session.get(User, plain.user_id))
    target = add_roster_member(group)
    assert copy_link(plain_client, plain_headers, target).status_code == 403
    # other group's member
    other = add_roster_member(make_group("Other"), "x@other.com")
    assert copy_link(client, headers, other).status_code == 404
    # no email
    no_email = add_roster_member(group, email=None)
    response = copy_link(client, headers, no_email)
    assert response.status_code == 409 and response.get_json() == {"error": "no_email"}
    # inactive
    inactive = add_roster_member(group, "gone@cafe.com", active=False)
    response = copy_link(client, headers, inactive)
    assert response.status_code == 409 and response.get_json()["error"] == "member_inactive"


def test_link_not_logged(app, db_session, caplog):
    group, admin_member, client, headers = setup_admin(app)
    member = add_roster_member(group)
    with caplog.at_level(logging.INFO):
        link = copy_link(client, headers, member).get_json()["link"]
    assert token_from(link) not in caplog.text
    records = [r for r in caplog.records if r.getMessage().startswith("Sign-in link copied")]
    assert len(records) == 1
    message = records[0].getMessage()
    assert f"admin_member_id={admin_member.id}" in message
    assert f"target_member_id={member.id}" in message
    assert "expires_at=" in message and "+00:00" in message


def test_user_in_another_group_is_refused(app, db_session):
    group, _, client, headers = setup_admin(app)
    other_user, _ = make_member(make_group("Other"), "robin@cafe.com", "admin")
    other_client = app.test_client()
    sign_in(other_client, other_user)
    row = add_roster_member(group, "robin@cafe.com")
    tokens_before = db.session.execute(db.select(LoginToken)).scalars().all()
    response = copy_link(client, headers, row)
    assert response.status_code == 409 and response.get_json() == {"error": "other_group"}
    assert db.session.execute(db.select(LoginToken)).scalars().all() == tokens_before
    assert db.session.get(Member, row.id).user_id is None
    live = db.session.execute(db.select(Session).where(
        Session.user_id == other_user.id, Session.revoked_at.is_(None))).scalars().all()
    assert len(live) == 1
    assert other_client.get("/api/auth/me").status_code == 200


def test_member_that_cannot_link_is_refused(app, db_session):
    group, _, client, headers = setup_admin(app)
    # The user already holds a row in this group under another email, so the
    # roster row with the user's email cannot be linked (one row per group).
    user, held = make_member(group, "first@cafe.com")
    user.email = "robin@cafe.com"
    db.session.commit()
    row = add_roster_member(group, "robin@cafe.com")
    tokens_before = db.session.execute(db.select(LoginToken)).scalars().all()
    response = copy_link(client, headers, row)
    assert response.status_code == 409 and response.get_json() == {"error": "not_linked"}
    assert db.session.execute(db.select(LoginToken)).scalars().all() == tokens_before


def test_links_are_for_members_and_your_own_row_only(app, db_session):
    group, admin_member, client, headers = setup_admin(app)
    for role in ("admin", "editor"):
        _, other = make_member(group, f"other-{role}@cafe.com", role)
        response = copy_link(client, headers, other)
        assert response.status_code == 409
        assert response.get_json() == {"error": "manager_member"}
    assert db.session.execute(db.select(LoginToken)).scalars().all() == []
    assert copy_link(client, headers, admin_member).status_code == 200
    assert copy_link(client, headers, add_roster_member(group)).status_code == 200
