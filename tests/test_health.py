from unittest import mock

from extensions import db


def test_healthz_ok(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.get_json() == {"ok": True}


def test_healthz_503_on_database_error(client):
    with mock.patch.object(db.session, "execute", side_effect=RuntimeError("down")):
        response = client.get("/healthz")
    assert response.status_code == 503
    assert response.get_json() == {"ok": False}
