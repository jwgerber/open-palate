import pytest

from app import create_app


@pytest.fixture
def web_client(app, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>SPA-SHELL</html>")
    (dist / "assets" / "app-abc123.js").write_text("console.log(1)")
    app.config["STATIC_DIR"] = str(dist)
    return app.test_client()


@pytest.mark.parametrize("path", ["/", "/coffees/3", "/signin", "/device", "/setup", "/admin",
                                  "/f/abc", "/print/sheets/7", "/some/deep/path"])
def test_spa_fallback_serves_index(web_client, path):
    response = web_client.get(path)
    assert response.status_code == 200
    assert b"SPA-SHELL" in response.data
    assert "no-cache" in response.headers["Cache-Control"]


def test_spa_fallback_not_for_api(web_client):
    response = web_client.get("/api/nope")
    assert response.status_code == 404
    assert response.is_json
    assert b"SPA-SHELL" not in response.data


def test_api_post_unknown_is_json_404(web_client):
    response = web_client.post("/api/nope")
    assert response.status_code in (403, 404, 405)
    assert response.is_json


def test_assets_have_long_cache(web_client):
    response = web_client.get("/assets/app-abc123.js")
    assert response.status_code == 200
    assert "max-age=31536000" in response.headers["Cache-Control"]
    assert "immutable" in response.headers["Cache-Control"]


def test_missing_asset_is_404_not_index(web_client):
    assert web_client.get("/assets/missing.js").status_code == 404


def test_path_traversal_blocked(web_client):
    response = web_client.get("/..%2f..%2fetc/passwd")
    assert b"root:" not in response.data


def test_no_build_means_404(app, tmp_path):
    app.config["STATIC_DIR"] = str(tmp_path / "absent")
    assert app.test_client().get("/").status_code == 404


def test_nul_byte_path_is_404(web_client):
    assert web_client.get("/a%00b").status_code == 404


def test_direct_index_html_is_no_cache(web_client):
    response = web_client.get("/index.html")
    assert response.status_code == 200
    assert "no-cache" in response.headers["Cache-Control"]
