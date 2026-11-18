"""POST /flights/<id>/paper/scan: photos in, a pre-fill out, nothing written.
The Claude call is always stubbed: these tests never reach the network."""
import io
import logging

import pytest

from extensions import db, limiter
from tasting import scan as tasting_scan
from tasting.models import Tasting
from tests.tasting.world import World

UNAVAILABLE = "Couldn't read the photo right now — type the sheet in instead."
UNREADABLE = "Couldn't read this photo — try a sharper, flatter shot, or type it in."


@pytest.fixture
def world(db_session, app):
    limiter.reset()
    return World(app)


@pytest.fixture
def keyed(app):
    app.config["ANTHROPIC_API_KEY"] = "test-key-not-real"
    return app


@pytest.fixture
def reader(monkeypatch):
    """Stub the Claude call; ``.calls`` records (labels, step) per photo."""
    calls = []

    def fake(data, mime_type, labels, step):
        calls.append({"labels": list(labels), "step": step, "mime": mime_type})
        return {"footer_flight_id": None, "footer_page": None, "taster_name": "Sam",
                "columns": [{"label": labels[0], "scores": {"aroma": {"written": "8.5", "dq": False}},
                             "vote": "yes", "flavor_words": [], "defect_words": [], "note": "jammy"}]}
    monkeypatch.setattr(tasting_scan, "read_page", fake)
    fake.calls = calls
    return fake


def _photo(mime="image/jpeg", size=10, head=b"\xff\xd8\xff"):
    return (io.BytesIO(head + b"x" * (size - len(head))), "sheet.jpg", mime)


def _open(world, n=2, blind=False, sheet="advanced", who="member", pick=None):
    coffees = [world.coffee(name=f"Named Lot {i}", roaster="Hidden Roasters") for i in range(n)]
    return world.open_flight(coffees, who=who, pick=pick, blind=blind, sheet=sheet), coffees


def _scan(world, fid, photos=None, who="editor", **form):
    files = [_photo()] if photos is None else photos
    data = {"photos": files, **form} if files else dict(form)
    return world.send(who, "post", f"/flights/{fid}/paper/scan", data=data, content_type="multipart/form-data")


def test_scan_disabled_without_key(world, reader, app):
    assert not app.config.get("ANTHROPIC_API_KEY")
    fid, _ = _open(world)
    r = _scan(world, fid)
    assert r.status_code == 404 and r.get_json() == {"error": "scan_disabled"}
    assert reader.calls == []


def test_returns_fill_and_writes_nothing(world, keyed, reader, db_session):
    fid, _ = _open(world)
    before = db_session.query(Tasting).count()
    r = _scan(world, fid)
    assert r.status_code == 200, r.get_json()
    j = r.get_json()
    assert j["taster"] == {"read_name": "Sam"} and j["warnings"] == []
    (cup,) = j["cups"]
    assert cup["position"] == 1 and cup["scores"] == {"aroma": 8.5} and cup["note"] == "jammy"
    assert db_session.query(Tasting).count() == before and reader.calls[0]["step"] == 0.5


def test_gate_host_either_door_or_manage(world, keyed, reader):
    fid, _ = _open(world)
    assert _scan(world, fid, who="member").status_code == 200          # account host
    world.person("plain")
    r = _scan(world, fid, who="plain")
    assert r.status_code == 403 and r.get_json() == {"error": "Only the host or an editor can enter a paper sheet"}
    host = world.member_id("member")
    dfid, _ = _open(world, pick=host, who="device")
    assert _scan(world, dfid, who="device", member_id=str(host)).status_code == 200
    assert _scan(world, dfid, who="device", member_id=str(world.member_id("editor"))).status_code == 403
    r = _scan(world, dfid, who="device")
    assert r.status_code == 400 and r.get_json()["field"] == "member_id"
    r = _scan(world, dfid, who="device", member_id="abc")
    assert r.status_code == 400 and r.get_json()["field"] == "member_id"


def test_basic_missing_and_other_group_404(world, keyed, reader):
    fid, _ = _open(world, sheet=None)
    assert _scan(world, fid).status_code == 404
    assert _scan(world, 999999).get_json() == {"error": "Flight not found"}
    assert _scan(world, fid, who="outsider").status_code == 404


def test_photo_rules(world, keyed, reader):
    fid, _ = _open(world)
    for photos in ([], [_photo(), _photo()], [_photo(mime="text/plain")], [_photo(size=3_500_001)],
                   [(io.BytesIO(b"just some text"), "s.jpg", "image/jpeg")]):
        r = _scan(world, fid, photos=photos)
        assert r.status_code == 400 and r.get_json()["field"] == "photos"
    assert reader.calls == []
    assert _scan(world, fid, photos=[_photo(size=3_500_000)]).status_code == 200


def test_two_photos_for_a_two_page_cupping_and_sniffed_type(world, keyed, reader):
    fid, _ = _open(world, n=7)
    png = _photo(mime="image/jpeg", size=30, head=b"\x89PNG\r\n\x1a\n")
    assert _scan(world, fid, photos=[_photo(), png]).status_code == 200
    assert [len(c["labels"]) for c in reader.calls] == [6, 1]
    assert [c["mime"] for c in reader.calls] == ["image/jpeg", "image/png"]


def test_oversize_request_400_before_parsing(world, keyed, reader, monkeypatch):
    from tasting import paper_routes
    fid, _ = _open(world)

    def reached(*a, **k):
        raise AssertionError("form parsing reached before the size check")
    monkeypatch.setattr(paper_routes, "_form_member_id", reached)
    r = _scan(world, fid, photos=[_photo(size=7_100_000)])
    assert r.status_code == 400 and "too large" in r.get_json()["error"] and reader.calls == []


def test_unavailable_and_unreadable(world, keyed, monkeypatch):
    fid, _ = _open(world)
    for exc, status, message in ((tasting_scan.ScanUnavailable, 503, UNAVAILABLE),
                                 (tasting_scan.ScanUnreadable, 422, UNREADABLE)):
        def boom(*a, exc=exc):
            raise exc("nope")
        monkeypatch.setattr(tasting_scan, "read_page", boom)
        r = _scan(world, fid)
        assert r.status_code == status and r.get_json() == {"error": message}


def test_claude_404_is_503_not_a_photo_fault(world, keyed, monkeypatch):
    import anthropic
    import httpx2
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    err = anthropic.NotFoundError("no such model", response=httpx2.Response(404, request=request), body=None)

    def boom(*a):
        raise err
    monkeypatch.setattr(tasting_scan, "_call", boom)
    fid, _ = _open(world)
    r = _scan(world, fid)
    assert r.status_code == 503 and r.get_json() == {"error": UNAVAILABLE}


@pytest.mark.parametrize("close", [False, True])
def test_blind_flight_prompt_has_no_names(world, keyed, reader, close):
    fid, coffees = _open(world, blind=True)
    if close:
        assert world.close(fid).status_code == 200
    r = _scan(world, fid)
    assert r.status_code == 200 and reader.calls[0]["labels"] == ["Cup A", "Cup B"]
    everything = str(reader.calls) + r.get_data(as_text=True)
    for c in coffees:
        assert c.name not in everything and c.roaster not in everything


def test_photos_are_never_logged(world, keyed, reader, caplog):
    fid, _ = _open(world)
    marker = b"SECRET-PHOTO-BYTES"
    with caplog.at_level(logging.DEBUG):
        assert _scan(world, fid, photos=[_photo(size=60, head=b"\xff\xd8\xff" + marker)]).status_code == 200
    assert "SECRET-PHOTO-BYTES" not in caplog.text
    db.session.rollback()
