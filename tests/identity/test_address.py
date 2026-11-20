from app import create_app
from extensions import db
from identity.accounts import issue_signin_link
from identity.address import app_address, install_settings
from identity.models import InstallSettings
from tests.identity.test_auth import add_user, cookie_attrs, request_link, sent, token_from  # noqa: F401

LAN = "http://192.168.1.40:8000"


def test_app_address_falls_back_to_base_url(app, db_session):
    assert app_address() == "http://localhost"


def test_app_address_uses_public_url(app, db_session):
    install_settings().public_url = LAN + "/"
    db_session.commit()
    assert app_address() == LAN


def test_app_address_with_row_deleted(app, db_session):
    db_session.query(InstallSettings).delete()
    db_session.commit()
    assert app_address() == "http://localhost"
    assert db_session.get(InstallSettings, 1).public_url is None


def test_signin_link_uses_public_url(app, db_session):
    install_settings().public_url = LAN
    user = add_user()
    link, _ = issue_signin_link(user)
    assert link.startswith(f"{LAN}/api/auth/consume?token=")


def test_consume_redirects_relative(client, db_session, sent):
    add_user()
    request_link(client, "owner@cafe.com")
    ok = client.get(f"/api/auth/consume?token={token_from(sent[-1][1])}")
    assert ok.headers["Location"] == "/"
    bad = client.get("/api/auth/consume?token=nope")
    assert bad.headers["Location"] == "/signin?error=expired"


def _consume(other_app, environ_overrides=None, headers=None):
    with other_app.app_context():
        user = add_user()
        link, _ = issue_signin_link(user)
        db.session.commit()
        db.session.remove()
    return other_app.test_client().get(
        f"/api/auth/consume?token={token_from(link)}",
        environ_overrides=environ_overrides, headers=headers)


def _app(database_url, **extra):
    return create_app({"TESTING": True, "SECRET_KEY": "test-secret",
                       "BASE_URL": "https://x", "SQLALCHEMY_DATABASE_URI": database_url,
                       **extra})


def test_secure_cookie_follows_request(app, database_url):
    plain = _consume(_app(database_url))
    assert "secure" not in cookie_attrs(plain, "tasting_session")
    assert "secure" not in cookie_attrs(plain, "tasting_csrf")


def test_secure_cookie_with_https_scheme(app, database_url):
    resp = _consume(_app(database_url), environ_overrides={"wsgi.url_scheme": "https"})
    assert "secure" in cookie_attrs(resp, "tasting_session")


def test_secure_cookie_with_forwarded_proto(app, database_url):
    resp = _consume(_app(database_url, PROXY_HOPS=1),
                    headers={"X-Forwarded-Proto": "https"})
    assert "secure" in cookie_attrs(resp, "tasting_session")
