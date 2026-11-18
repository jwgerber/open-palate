"""Blind is blind on the wire. While a blind flight is open, no GET that takes the
flight may carry another taster's scores, any tags or the coffees' identity, for
any kind of caller: a member, the shared device, the host and an editor.

The one deliberate exception is the label key, served to the account-door host
only (spec: host powers); every other caller is refused it."""
import json
import re

import pytest

from extensions import db
from tasting.enums import ADV_CATEGORIES
from tests.tasting.world import World, adv_entry

SCORE_KEYS = {"overall", "acidity", "sweetness", "body", "balance", "tags", "defects", "bar_vote",
              "scores", "total", "avg_total", "avg_overall", "consensus", "descriptors", "note",
              "reads", "yours", "votes", "categories", *ADV_CATEGORIES, *(f"adv_{c}" for c in ADV_CATEGORIES)}


@pytest.fixture
def world(db_session, app):
    return World(app)


def _flight_get_routes(app):
    """Every GET rule that takes a flight id, found from the URL map so a new
    route is walked without editing this test."""
    rules = [r.rule for r in app.url_map.iter_rules()
             if "GET" in r.methods and r.rule.startswith("/api/tasting/flights/<int:flight_id>")]
    assert rules, "no flight GET routes found"
    return sorted(r.replace("/api/tasting", "") for r in rules)


def _keys(x):
    if isinstance(x, dict):
        for k, v in x.items():
            yield k, v
            yield from _keys(v)
    elif isinstance(x, list):
        for v in x:
            yield from _keys(v)


def _assert_dark(body_text, coffees, where):
    for c in coffees:
        for secret in (c.name, c.roaster, c.origin):
            if secret:
                assert secret not in body_text, (where, secret)
    try:
        body = json.loads(body_text)
    except ValueError:
        return
    for key, value in _keys(body):
        assert key not in SCORE_KEYS or value in (None, [], {}), (where, key, value)
        if key == "coffee_id":
            assert value is None, (where, value)
    assert not re.search(r'"kind":\s*"(house|cupping_lot|external)"', body_text), where


@pytest.mark.parametrize("sheet", ["basic", "advanced"])
def test_blind_on_wire(world, app, sheet):
    coffees = [world.coffee(name="Secret Gesha", roaster="Hidden Roasters", origin="Narnia"),
               world.coffee(name="Quiet Bourbon", roaster="Unseen Co", origin="Atlantis")]
    host, other = world.member_id("member"), world.member_id("admin")
    fid = world.open_flight(coffees, who="member", blind=True, prep="cupping",
                            sheet="advanced" if sheet == "advanced" else None)

    def entries():
        if sheet == "advanced":
            return [dict(adv_entry(8.5), position=p, tags={"Floral": 2}, note="jammy") for p in (1, 2)]
        return [{"position": p, "overall": 5, "acidity": 4, "tags": {"Floral": 2}, "note": "jammy"} for p in (1, 2)]

    # Everyone but the editor has logged, so there are reads to leak.
    assert world.log(fid, entries(), who="member").status_code == 201
    assert world.log(fid, entries(), who="admin").status_code == 201
    assert world.log(fid, entries(), who="device", pick=world.roster_only("Rowan").id).status_code == 201

    callers = {
        "member (host)": ("member", ""),
        "admin (a reader)": ("admin", ""),
        "editor": ("editor", ""),
        "device (unpicked)": ("device", ""),
        "device (the host picked)": ("device", f"?member_id={host}"),
        "device (a reader picked)": ("device", f"?member_id={other}"),
    }
    paths = _flight_get_routes(app)
    walked = set()
    for label, (who, qs) in callers.items():
        for rule in paths:
            path = rule.replace("<int:flight_id>", str(fid))
            r = world.get(who, path + qs)
            walked.add(rule)
            if rule.endswith("/label-key"):
                if label == "member (host)":
                    assert r.status_code == 200      # the documented exception
                    continue
                assert r.status_code == 403, (label, r.status_code)
            assert r.status_code in (200, 403, 404, 409), (label, rule, r.status_code)
            _assert_dark(r.get_data(as_text=True), coffees, (label, rule))
        recent = world.get(who, "/flights/recent" + qs)
        if recent.status_code == 200:
            _assert_dark(recent.get_data(as_text=True), coffees, (label, "recent"))
        for coffee in coffees:
            for path in (f"/coffees/{coffee.id}", f"/coffees/{coffee.id}/sessions"):
                r = world.get(who, path + qs)
                body = r.get_json()
                assert body.get("n", 0) == 0 and not body.get("yours") and not body.get("sessions"), (label, path)
        coffees_list = world.get(who, "/coffees" + qs).get_json()["coffees"]
        assert all(c["n"] == 0 and not c["tasted_by_me"] for c in coffees_list), label
        if who != "device":
            palate = world.get(who, "/palate").get_json()
            assert palate["tastings"] == 0 and palate["cupping"]["reads"] == 0, label
            assert "Secret" not in json.dumps(palate), label
    assert walked == set(paths)
    expected = {"/flights/<int:flight_id>", "/flights/<int:flight_id>/reveal",
                "/flights/<int:flight_id>/summary", "/flights/<int:flight_id>/export.csv",
                "/flights/<int:flight_id>/label-key"}
    assert expected <= set(paths), paths
    db.session.rollback()
