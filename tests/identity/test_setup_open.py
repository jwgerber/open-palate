"""Who may create the first admin without the logged setup link."""
import logging

import pytest

from app import create_app
from extensions import db
from identity.accounts import admin_exists, new_setup_token
from identity.setup_access import is_private
from tests.identity.helpers import csrf, make_group, make_member

BODY = {"email": "boss@example.com", "display_name": "Boss"}


def make_app(database_url, **extra):
    config = {"TESTING": True, "SECRET_KEY": "test-secret", "BASE_URL": "http://localhost",
              "SQLALCHEMY_DATABASE_URI": database_url, "PROXY_HOPS": 1}
    config.update(extra)
    return create_app(config)


def peer_client(app, peer):
    """A client whose socket peer address is `peer`."""
    client = app.test_client()
    client.environ_base["REMOTE_ADDR"] = peer
    return client


def post_setup(app, peer, forwarded=None, **body):
    client = peer_client(app, peer)
    headers = csrf(client)
    if forwarded:
        headers["X-Forwarded-For"] = forwarded
    return client.post("/api/auth/setup", json={**BODY, **body}, headers=headers)


def get_status(app, peer):
    return peer_client(app, peer).get("/api/auth/setup-status")


def test_is_private_ranges():
    for addr in ("127.0.0.1", "::1", "10.1.2.3", "172.16.0.1", "172.31.255.255",
                 "192.168.1.5", "fd00::1", "fe80::1", "::ffff:127.0.0.1"):
        assert is_private(addr), addr
    for addr in ("172.32.0.1", "8.8.8.8", "2001:4860::1", None, "garbage", "::ffff:8.8.8.8"):
        assert not is_private(addr), addr


def test_local_peer_without_proxy_header_is_open(app, database_url):
    setup_app = make_app(database_url, IN_CONTAINER=False)
    response = post_setup(setup_app, "192.168.1.5")
    assert response.status_code == 200
    with setup_app.app_context():
        assert admin_exists()


def test_spoofed_forwarded_for_from_public_peer_is_not_open(app, database_url):
    response = post_setup(make_app(database_url), "203.0.113.9", forwarded="127.0.0.1")
    assert response.status_code == 400
    assert response.get_json()["error"] == "invalid_token"


def test_proxy_with_public_client_is_not_open(app, database_url):
    response = post_setup(make_app(database_url), "10.0.0.2", forwarded="198.51.100.7")
    assert response.status_code == 400


def test_setup_open_false_is_never_open_even_for_local_peer(app, database_url):
    response = post_setup(make_app(database_url, SETUP_OPEN=False, IN_CONTAINER=False), "127.0.0.1")
    assert response.status_code == 400
    status = get_status(make_app(database_url, SETUP_OPEN=False), "127.0.0.1").get_json()
    assert status["open"] is False


def test_setup_open_unset_keeps_local_rule(app, database_url):
    response = post_setup(make_app(database_url, SETUP_OPEN=None), "127.0.0.1")
    assert response.status_code == 200


def test_container_is_never_open_without_switch(app, database_url):
    response = post_setup(make_app(database_url, IN_CONTAINER=True), "127.0.0.1")
    assert response.status_code == 400


def test_setup_open_switch_opens_anywhere(app, database_url):
    setup_app = make_app(database_url, SETUP_OPEN=True, IN_CONTAINER=True)
    assert post_setup(setup_app, "203.0.113.9").status_code == 200


def test_setup_password(app, database_url):
    setup_app = make_app(database_url, SETUP_PASSWORD="hunter22")
    wrong = post_setup(setup_app, "203.0.113.9", forwarded="203.0.113.9", setup_password="nope")
    assert wrong.status_code == 400
    assert wrong.get_json()["error"] == "invalid_token"
    right = post_setup(setup_app, "203.0.113.9", forwarded="203.0.113.9",
                       setup_password="hunter22")
    assert right.status_code == 200


def test_token_still_works_from_public_peer(app, database_url):
    setup_app = make_app(database_url)
    with setup_app.app_context():
        token = new_setup_token()
    response = post_setup(setup_app, "203.0.113.9", forwarded="203.0.113.9", token=token)
    assert response.status_code == 200


def test_status_before_admin(app, database_url):
    with_password = make_app(database_url, SETUP_PASSWORD="hunter22")
    assert get_status(with_password, "203.0.113.9").get_json() == {
        "needed": True, "open": False, "password": True}
    local = make_app(database_url)
    assert get_status(local, "127.0.0.1").get_json() == {
        "needed": True, "open": True, "password": False}


def test_status_after_admin_says_only_not_needed(app, database_url):
    setup_app = make_app(database_url, SETUP_PASSWORD="hunter22")
    with setup_app.app_context():
        make_member(make_group(), "a@example.com", role="admin")
    assert get_status(setup_app, "127.0.0.1").get_json() == {"needed": False}


def test_setup_after_admin_is_409_even_when_open(app, database_url):
    setup_app = make_app(database_url, SETUP_OPEN=True)
    with setup_app.app_context():
        make_member(make_group(), "a@example.com", role="admin")
    response = post_setup(setup_app, "127.0.0.1")
    assert response.status_code == 409
    assert response.get_json()["error"] == "setup_done"


def test_password_never_logged(app, database_url, caplog):
    setup_app = make_app(database_url, SETUP_PASSWORD="hunter22")
    with caplog.at_level(logging.DEBUG):
        post_setup(setup_app, "203.0.113.9", forwarded="203.0.113.9", setup_password="guess-me")
        post_setup(setup_app, "203.0.113.9", forwarded="203.0.113.9", setup_password="hunter22")
    assert "hunter22" not in caplog.text
    assert "guess-me" not in caplog.text


def test_setup_is_rate_limited(app, database_url):
    setup_app = make_app(database_url, SETUP_PASSWORD="hunter22")
    codes = [post_setup(setup_app, "203.0.113.9", forwarded="203.0.113.9",
                        setup_password=f"guess{i}").status_code for i in range(6)]
    assert codes == [400] * 5 + [429]


def test_racing_setup_loses_with_409_and_leaves_one_group(app, database_url, monkeypatch):
    from identity import auth_routes
    from identity.models import Group, Member
    setup_app = make_app(database_url, SETUP_OPEN=True)
    real_ensure_admin = auth_routes.ensure_admin

    def other_setup_wins_first(email, display_name):
        # Another request completes setup between our check and our write.
        _, _ = make_member(make_group("Race"), "first@example.com", "admin")
        return real_ensure_admin(email, display_name)

    monkeypatch.setattr(auth_routes, "ensure_admin", other_setup_wins_first)
    response = post_setup(setup_app, "127.0.0.1")
    assert response.status_code == 409
    assert response.get_json() == {"error": "setup_done"}
    with setup_app.app_context():
        assert len(db.session.execute(db.select(Group)).scalars().all()) == 1
        admins = db.session.execute(db.select(Member).where(Member.role == "admin")).scalars().all()
        assert [m.email for m in admins] == ["first@example.com"]
