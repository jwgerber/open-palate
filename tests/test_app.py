import pytest

import utils
from app import create_app


def test_create_app_requires_secret_key_with_postgres(monkeypatch):
    monkeypatch.delenv("SECRET_KEY", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://u@h/db")
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        create_app()


def test_create_app_defaults_base_url(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "x")
    monkeypatch.delenv("BASE_URL", raising=False)
    assert create_app().config["BASE_URL"] == "http://localhost:8000"


def test_database_url_defaults_to_data_sqlite(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "x")
    monkeypatch.setenv("BASE_URL", "http://localhost")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    app = create_app()
    assert app.config["SQLALCHEMY_DATABASE_URI"] == "sqlite:////data/tasting.db"


def test_proxy_hops_zero_disables_proxyfix(monkeypatch):
    from werkzeug.middleware.proxy_fix import ProxyFix
    monkeypatch.setenv("SECRET_KEY", "x")
    monkeypatch.setenv("BASE_URL", "http://localhost")
    monkeypatch.setenv("PROXY_HOPS", "0")
    assert not isinstance(create_app().wsgi_app, ProxyFix)
    monkeypatch.setenv("PROXY_HOPS", "1")
    assert isinstance(create_app().wsgi_app, ProxyFix)


def test_fixtures_work(app, client, db_session):
    assert app.config["BASE_URL"] == "http://localhost"
    assert client.get("/api/nope").status_code == 404


def test_utc_now_is_naive():
    assert utils.utc_now().tzinfo is None


def test_is_pg_int():
    assert utils.is_pg_int(5)
    assert not utils.is_pg_int(True)
    assert not utils.is_pg_int(0)
    assert not utils.is_pg_int(2**31)
    assert not utils.is_pg_int("5")


def test_csv_safe():
    assert utils.csv_safe("=1+1") == "'=1+1"
    assert utils.csv_safe(None) == ""
    assert utils.csv_safe("ok") == "ok"


def test_get_json_object_and_handle_db_errors(app):
    @utils.handle_db_errors("boom")
    def bad():
        raise ValueError("x")

    @utils.handle_db_errors("boom")
    def good():
        data, err = utils.get_json_object()
        return err if err else data

    with app.test_request_context("/", method="POST", json=[1]):
        _, status = good()
        assert status == 400
    with app.test_request_context("/", method="POST", json={"a": 1}):
        assert good() == {"a": 1}
    with app.test_request_context("/"):
        body, status = bad()
        assert status == 500 and body.get_json() == {"error": "boom"}
