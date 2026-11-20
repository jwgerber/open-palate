"""Cross-group sweep: no API route lets a request acting in group A read or
write group B's data.

Every ``/api/`` endpoint sits in exactly one of four lists, and
``test_every_api_route_is_classified`` fails on any that is in none (or two),
so a new route has to be placed before the suite passes:

- ``GROUP_ROUTES``: acts in one group (``require`` at a group level). Swept.
- ``SIGNED_IN_ROUTES``: about the person, not a group (``require("signed_in")``).
- ``PUBLIC_ROUTES``: no session needed (sign-in, setup, ``/auth/me``).
- ``DEVICE_ENTRY_ROUTES``: a tablet trading a code for a session.

The world: groups A and B, each with coffees, an open blind advanced flight
(two cups, one read), a closed advanced flight with a read, a roster member and
a device code. Everything of B's that has a name carries ``SENTINEL-B``. User U
is admin of both A and B; user V is admin of A only; the device is bound to A.

The sweeps, over every ``GROUP_ROUTES`` rule:

- positive control: B's ids as U with ``X-Group: B`` must not 404, which proves
  the ids and bodies reach their target (a failure here is a broken test);
- cross-group: the same calls as V and U acting in A, and as the device, must
  404. A device may get 403 ``forbidden`` instead, but only where the same call
  with A's own ids is also 403 ``forbidden``: the route's level check
  (``self``, ``manage``, ``admin``) refuses every device before any id is read;
- lists: every GET, as each A actor, never shows a B sentinel;
- body and query ids: B's ids passed inside otherwise-valid A requests answer
  404, or 400 naming the id field;
- after all of that, B's rows are exactly as they were.
"""
import io
import json
import re
from dataclasses import dataclass

import pytest

from extensions import db, limiter
from identity.models import DeviceCode, Member
from tasting import scan as tasting_scan
from tasting.models import Tasting, TastingCoffee, TastingFlight
from tests.tasting.world import World, adv_entry, entry

SENTINEL = "SENTINEL-B"

GROUP_ROUTES = {
    "content.get_content",
    "device.members",
    "admin.get_group", "admin.patch_group",
    "admin.list_members", "admin.add_member", "admin.patch_member", "admin.copy_signin_link",
    "admin.list_device_codes", "admin.create_device_code", "admin.revoke_device_code",
    "admin.post_sample_data", "admin.delete_sample_data",
    "tasting.list_coffees", "tasting.create_coffee", "tasting.match_coffee",
    "tasting.get_coffee", "tasting.update_coffee", "tasting.coffee_sessions",
    "tasting.archive_coffee", "tasting.unarchive_coffee",
    "tasting.export_coffees_csv", "tasting.preview_coffee_import", "tasting.import_coffees",
    "tasting.recent_flights", "tasting.create_flight", "tasting.get_flight",
    "tasting.delete_flight", "tasting.close_flight", "tasting.edit_flight_cups",
    "tasting.export_cupping_csv", "tasting.get_label_key",
    "tasting.enter_paper_sheet", "tasting.scan_paper_sheet",
    "tasting.set_pass", "tasting.start_timer",
    "tasting.reveal_flight", "tasting.flight_summary",
    "tasting.log_tastings", "tasting.delete_tastings",
    "tasting.preview_flight_import", "tasting.import_flights",
    "tasting.get_palate",
}

SIGNED_IN_ROUTES = {
    "groups.create_team", "groups.create_personal_space",
    "groups.get_install", "groups.patch_install", "groups.install_groups",
}

PUBLIC_ROUTES = {
    "auth.consume", "auth.logout", "auth.me", "auth.request_link",
    "auth.setup", "auth.setup_status",
}

DEVICE_ENTRY_ROUTES = {"device.enter"}

# A minimal valid body for every write rule with id arguments; None sends none.
# "<coffee_id>" is replaced by the target group's coffee id. Scan is multipart
# and built in ``_call``.
_ADV_ENTRIES = [dict(adv_entry(8.5), position=p) for p in (1, 2)]
BODIES = {
    "admin.patch_member": {},
    "admin.copy_signin_link": None,
    "admin.revoke_device_code": None,
    "tasting.update_coffee": {},
    "tasting.archive_coffee": None,
    "tasting.unarchive_coffee": None,
    "tasting.delete_flight": None,
    "tasting.close_flight": {},
    "tasting.edit_flight_cups": {"cups": [{"coffee_id": "<coffee_id>"}]},
    "tasting.enter_paper_sheet": {"guest_name": "Pat", "entries": _ADV_ENTRIES},
    "tasting.scan_paper_sheet": "multipart",
    "tasting.set_pass": {"pass": 1},
    "tasting.start_timer": {},
    "tasting.log_tastings": {"entries": _ADV_ENTRIES},
    "tasting.delete_tastings": None,
}

# Extra query strings for GETs in the list sweep: show everything, and probe
# the coffee matcher with B's coffee name.
GET_QUERY = {
    "tasting.list_coffees": "include_archived=1&mine=1",
    "tasting.match_coffee": f"q={SENTINEL}-coffee",
}

_ID_ARG = re.compile(r"<int:(\w+)>")
_JPEG = b"\xff\xd8\xff" + b"x" * 16


@dataclass
class GroupData:
    id: int
    flight_id: int          # open, blind, advanced, one read
    closed_flight_id: int   # closed, advanced, one read
    coffee_id: int
    member_id: int          # roster only, no account
    code_id: int

    def ids(self, flight_id=None) -> dict:
        return {"flight_id": flight_id or self.flight_id, "coffee_id": self.coffee_id,
                "member_id": self.member_id, "code_id": self.code_id}


@dataclass
class Sweep:
    world: World
    a: GroupData
    b: GroupData

    def call(self, who, method, path, group=None, query="", json_body=None, multipart=False):
        headers = dict(self.world.headers[who])
        if group is not None:
            headers["X-Group"] = str(group.id)
        url = f"{path}?{query}" if query else path
        kw = {}
        if multipart:
            kw = {"data": {"photos": [(io.BytesIO(_JPEG), "sheet.jpg", "image/jpeg")]},
                  "content_type": "multipart/form-data"}
        elif json_body is not None:
            kw = {"json": json_body}
        return getattr(self.world.clients[who], method.lower())(url, headers=headers, **kw)


# ---------------------------------------------------------------------------
# setup
# ---------------------------------------------------------------------------

def _build_group(world: World, who: str, group, prefix: str) -> GroupData:
    xg = {"X-Group": str(group.id)}
    coffee = world.coffee(group=group, name=f"{prefix}-coffee")
    second = world.coffee(group=group, name=f"{prefix}-coffee-2")
    ids = [coffee.id, second.id]

    def open_flight(name, blind):
        r = world.send(who, "post", "/flights", headers=xg, json={
            "coffee_ids": ids, "prep": "cupping", "shared": True, "blind": blind,
            "sheet": "advanced", "name": name})
        assert r.status_code == 201, r.get_json()
        fid = r.get_json()["id"]
        entries = [dict(e, note=f"{prefix}-note") for e in _ADV_ENTRIES]
        r = world.send(who, "post", f"/flights/{fid}/tastings", headers=xg, json={"entries": entries})
        assert r.status_code == 201, r.get_json()
        return fid

    open_id = open_flight(f"{prefix}-flight-open", blind=True)
    closed_id = open_flight(f"{prefix}-flight-closed", blind=False)
    assert world.send(who, "post", f"/flights/{closed_id}/close", headers=xg, json={}).status_code == 200
    member = world.roster_only(f"{prefix}-member", group=group)
    client = world.clients[who]
    r = client.post("/api/group/device-codes", headers={**world.headers[who], **xg})
    assert r.status_code == 201, r.get_json()
    return GroupData(id=group.id, flight_id=open_id, closed_flight_id=closed_id,
                     coffee_id=coffee.id, member_id=member.id, code_id=r.get_json()["id"])


@pytest.fixture
def sweep(app, db_session, monkeypatch):
    limiter.reset()
    app.config["ANTHROPIC_API_KEY"] = "test"   # scan on, so it can't 404 early
    monkeypatch.setattr(tasting_scan, "read_page", lambda data, mime, labels, step: {
        "footer_flight_id": None, "footer_page": None, "taster_name": "Sam", "columns": []})
    world = World(app)                         # A = world.group, B = world.other
    world.person("v", "admin", name="Vera")    # V: admin of A only
    user_u, _ = world.person("u", "admin", name="Uma")
    db.session.add(Member(group_id=world.other.id, user_id=user_u.id, email=user_u.email,
                          display_name=f"{SENTINEL}-uma", role="admin", active=True))
    db.session.commit()                        # U: admin of A and of B
    a = _build_group(world, "u", world.group, "Alpha")
    b = _build_group(world, "u", world.other, SENTINEL)
    return Sweep(world, a, b)


def _group_rules(app, endpoints=None):
    rules = [r for r in app.url_map.iter_rules()
             if r.rule.startswith("/api/") and r.endpoint in GROUP_ROUTES]
    if endpoints is not None:
        rules = [r for r in rules if r.endpoint in endpoints]
    return rules


def _methods(rule):
    return sorted(rule.methods - {"HEAD", "OPTIONS"})


def _path(rule, ids: dict) -> str:
    def fill(match):
        name = match.group(1)
        if name not in ids:
            pytest.fail(f"unknown id argument {name!r} in {rule.rule}: add it to GroupData.ids")
        return str(ids[name])
    return _ID_ARG.sub(fill, rule.rule)


def _id_calls(app):
    """(rule, method) for every swept rule with ids. Deletes run last and the
    flight delete very last, so one world serves the whole positive control."""
    calls = [(r, m) for r in _group_rules(app) if _ID_ARG.search(r.rule) for m in _methods(r)]
    return sorted(calls, key=lambda c: (c[0].endpoint == "tasting.delete_flight",
                                        c[1] == "DELETE", c[0].endpoint, c[1]))


def _fill_body(value, coffee_id):
    if value == "<coffee_id>":
        return coffee_id
    if isinstance(value, dict):
        return {k: _fill_body(v, coffee_id) for k, v in value.items()}
    if isinstance(value, list):
        return [_fill_body(v, coffee_id) for v in value]
    return value


def _id_call(sweep: Sweep, rule, method, target: GroupData, who, group):
    """One call of an id rule with ``target``'s ids, acting as ``who`` in ``group``."""
    path = _path(rule, target.ids())
    if method == "GET":
        return sweep.call(who, method, path, group)
    if rule.endpoint not in BODIES:
        pytest.fail(f"no body for {method} {rule.rule} ({rule.endpoint}): add one to BODIES")
    body = BODIES[rule.endpoint]
    if body == "multipart":
        return sweep.call(who, method, path, group, multipart=True)
    return sweep.call(who, method, path, group, json_body=_fill_body(body, target.coffee_id))


def _snapshot_b(b: GroupData) -> dict:
    db.session.expire_all()
    flights = db.session.execute(db.select(TastingFlight).where(TastingFlight.group_id == b.id)
                                 .order_by(TastingFlight.id)).scalars().all()
    return {
        "flights": [(f.id, f.is_open, f.closed_at) for f in flights],
        "tastings": db.session.execute(db.select(db.func.count(Tasting.id)).join(TastingFlight)
                                       .where(TastingFlight.group_id == b.id)).scalar_one(),
        "coffees": [(c.id, c.archived_at) for c in db.session.execute(
            db.select(TastingCoffee).where(TastingCoffee.group_id == b.id)
            .order_by(TastingCoffee.id)).scalars()],
        "members": [(m.id, m.role, m.active) for m in db.session.execute(
            db.select(Member).where(Member.group_id == b.id).order_by(Member.id)).scalars()],
        "codes": [(c.id, c.revoked_at) for c in db.session.execute(
            db.select(DeviceCode).where(DeviceCode.group_id == b.id)
            .order_by(DeviceCode.id)).scalars()],
    }


# ---------------------------------------------------------------------------
# the sweeps (shared by the tests and by test_group_b_unchanged)
# ---------------------------------------------------------------------------

A_ACTORS = ("v", "u", "device")


def _a_group(sweep: Sweep, who):
    """The group header each A actor sends: the device needs none."""
    return None if who == "device" else sweep.a


def _cross_group_failures(sweep: Sweep, app) -> list:
    failures = []
    for rule, method in _id_calls(app):
        for who in A_ACTORS:
            r = _id_call(sweep, rule, method, sweep.b, who, _a_group(sweep, who))
            if r.status_code == 404:
                continue
            if who == "device" and r.status_code == 403 and r.get_json() == {"error": "forbidden"}:
                own = _id_call(sweep, rule, method, sweep.a, who, None)
                if own.status_code == 403 and own.get_json() == {"error": "forbidden"}:
                    continue
            failures.append(f"{who} {method} {rule.rule}: {r.status_code} {r.get_data(as_text=True)[:200]}")
    return failures


def _list_failures(sweep: Sweep, app) -> list:
    a, b = sweep.a, sweep.b
    id_sets = [a.ids(), a.ids(a.closed_flight_id), b.ids(), b.ids(b.closed_flight_id)]
    failures = []
    for rule in _group_rules(app):
        if "GET" not in rule.methods:
            continue
        paths = sorted({_path(rule, ids) for ids in id_sets})
        for path in paths:
            for who in A_ACTORS:
                query = GET_QUERY.get(rule.endpoint, "")
                if who == "device":   # the device picks A's roster member
                    query = "&".join(q for q in (query, f"member_id={a.member_id}") if q)
                r = sweep.call(who, "GET", path, _a_group(sweep, who), query=query)
                body = r.get_data(as_text=True)
                if r.status_code >= 500 or SENTINEL in body:
                    failures.append(f"{who} GET {path}?{query}: {r.status_code} {body[:300]}")
    return failures


def _body_id_cases(sweep: Sweep):
    """(label, response, field) for B ids inside otherwise-valid A requests."""
    a, b, world = sweep.a, sweep.b, sweep.world
    xa = {"X-Group": str(a.id)}
    # An unlocked blind flight V hosts in A, so the cups PUT reaches its ids.
    r = world.send("v", "post", "/flights", headers=xa, json={
        "coffee_ids": [a.coffee_id], "prep": "cupping", "shared": True, "blind": True})
    assert r.status_code == 201, r.get_json()
    unlocked = r.get_json()["id"]
    base = "/api/tasting"
    cases = [
        ("device ?member_id= on recent",
         sweep.call("device", "GET", f"{base}/flights/recent", query=f"member_id={b.member_id}"), "member_id"),
        ("device ?member_id= on a flight",
         sweep.call("device", "GET", f"{base}/flights/{a.flight_id}", query=f"member_id={b.member_id}"),
         "member_id"),
        ("device ?member_id= on my coffees",
         sweep.call("device", "GET", f"{base}/coffees", query=f"mine=1&member_id={b.member_id}"), "member_id"),
    ]
    for who in ("v", "u"):
        for ids in ([b.coffee_id], [a.coffee_id, b.coffee_id]):
            cases.append((f"{who} POST /flights coffee_ids={ids}", sweep.call(
                who, "POST", f"{base}/flights", a, json_body={
                    "coffee_ids": ids, "prep": "cupping", "shared": True}), "coffee_ids"))
        cases.append((f"{who} POST /flights solo coffee_ids", sweep.call(
            who, "POST", f"{base}/flights", a, json_body={
                "coffee_ids": [b.coffee_id], "prep": "drip", "entries": [entry(b.coffee_id)]}),
            "coffee_ids"))
        cases.append((f"{who} paper taster_member_id", sweep.call(
            who, "POST", f"{base}/flights/{a.flight_id}/paper", a, json_body={
                "taster_member_id": b.member_id, "entries": _ADV_ENTRIES}), "taster_member_id"))
    cases.append(("v cups PUT coffee_id", sweep.call(
        "v", "PUT", f"{base}/flights/{unlocked}/cups", a, json_body={
            "cups": [{"coffee_id": a.coffee_id}, {"coffee_id": b.coffee_id}]}), "cups"))
    pick = {"member_id": b.member_id}
    cases += [
        ("device tasting entry member_id", sweep.call(
            "device", "POST", f"{base}/flights/{a.flight_id}/tastings",
            json_body={"entries": _ADV_ENTRIES, **pick}), "member_id"),
        ("device close member_id", sweep.call(
            "device", "POST", f"{base}/flights/{a.flight_id}/close", json_body=pick), "member_id"),
        ("device timer member_id", sweep.call(
            "device", "POST", f"{base}/flights/{a.flight_id}/timer", json_body=pick), "member_id"),
        ("device paper member_id", sweep.call(
            "device", "POST", f"{base}/flights/{a.flight_id}/paper",
            json_body={"guest_name": "Pat", "entries": _ADV_ENTRIES, **pick}), "member_id"),
    ]
    return cases


def _body_id_failures(sweep: Sweep) -> list:
    failures = []
    for label, r, field in _body_id_cases(sweep):
        body = r.get_json(silent=True) or {}
        if r.status_code == 404 or (r.status_code == 400 and body.get("field") == field):
            if SENTINEL not in r.get_data(as_text=True):
                continue
        failures.append(f"{label}: {r.status_code} {r.get_data(as_text=True)[:300]}")
    return failures


# ---------------------------------------------------------------------------
# tests
# ---------------------------------------------------------------------------

def test_every_api_route_is_classified(app):
    lists = {"GROUP_ROUTES": GROUP_ROUTES, "SIGNED_IN_ROUTES": SIGNED_IN_ROUTES,
             "PUBLIC_ROUTES": PUBLIC_ROUTES, "DEVICE_ENTRY_ROUTES": DEVICE_ENTRY_ROUTES}
    endpoints = {r.endpoint for r in app.url_map.iter_rules() if r.rule.startswith("/api/")}
    problems = []
    for endpoint in sorted(endpoints):
        homes = [name for name, members in lists.items() if endpoint in members]
        if len(homes) != 1:
            problems.append(f"{endpoint}: in {homes or 'no list'}")
    stale = sorted(set().union(*lists.values()) - endpoints)
    if stale:
        problems.append(f"listed but not routes: {stale}")
    assert not problems, "\n".join(problems)


def test_id_routes_positive_control(sweep, app):
    """B's ids, as U acting in B, reach their target: never 404."""
    failures = []
    for rule, method in _id_calls(app):
        r = _id_call(sweep, rule, method, sweep.b, "u", sweep.b)
        if r.status_code == 404 or r.status_code >= 500:
            failures.append(f"{method} {rule.rule}: {r.status_code} {r.get_data(as_text=True)[:200]}")
    assert not failures, "\n".join(failures)


def test_id_routes_cross_group_404(sweep, app):
    before = _snapshot_b(sweep.b)
    failures = _cross_group_failures(sweep, app)
    assert not failures, "\n".join(failures)
    assert _snapshot_b(sweep.b) == before


def test_list_routes_show_no_sentinel(sweep, app):
    failures = _list_failures(sweep, app)
    assert not failures, "\n".join(failures)


def test_list_sweep_covers_the_lists(app):
    """The GETs the brief names are all in the sweep."""
    gets = {r.rule for r in _group_rules(app) if "GET" in r.methods}
    named = {"/api/tasting/coffees", "/api/tasting/coffees/match", "/api/tasting/coffees/export.csv",
             "/api/tasting/flights/recent", "/api/tasting/palate", "/api/group",
             "/api/group/members", "/api/group/device-codes", "/api/device/members"}
    assert named <= gets, named - gets


def test_body_and_query_ids_from_other_group(sweep):
    before = _snapshot_b(sweep.b)
    failures = _body_id_failures(sweep)
    assert not failures, "\n".join(failures)
    assert _snapshot_b(sweep.b) == before


def test_group_b_unchanged(sweep, app):
    """Every cross-group sweep in one world, then B's rows are as they were."""
    before = _snapshot_b(sweep.b)
    assert before["flights"] and before["tastings"] > 0 and before["codes"]
    _cross_group_failures(sweep, app)
    _list_failures(sweep, app)
    _body_id_failures(sweep)
    after = _snapshot_b(sweep.b)
    assert after == before, json.dumps({"before": before, "after": after}, default=str, indent=1)
