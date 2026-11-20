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
- lists: every GET, as each A actor, never shows a B sentinel. Its positive
  control: the same GET as U acting in B shows the sentinel, and as each A
  actor shows A's names (``NAMELESS_GETS`` and ``REFUSED_GETS`` say where not);
- body and query ids: B's ids inside otherwise-valid A requests get the exact
  refusal each case names, and the twin with A's id succeeds;
- writes without ids (sample data, creates, CSV imports, the group, device
  codes), acting in A: B is untouched, and naming B's coffee, flight or member
  answers exactly as naming something that exists nowhere (no oracle);
- after all of that, B's rows are exactly as they were.
"""
import io
import json
import re
from dataclasses import dataclass
from typing import Callable

import pytest

from extensions import db, limiter
from identity.models import DeviceCode, Group, Member
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

# Extra query strings for GETs in the list sweeps: show everything, and probe
# the coffee matcher with a coffee name ("{prefix}" is SENTINEL-B when A's
# actors look for leaks, and the caller's own prefix when proving reach).
GET_QUERY = {
    "tasting.list_coffees": "include_archived=1&mine=1",
    "tasting.match_coffee": "q={prefix}-coffee",
}

# GETs whose answers carry no names, so "shows the sentinel" / "shows A's
# names" can't apply: the lexicon, and device codes (ids and dates only).
NAMELESS_GETS = {"content.get_content", "admin.list_device_codes"}

# GETs an A actor is refused (403) on every path of A's own, so the reach
# check expects 403 there instead of A's names. The device: the admin and
# manage pages, the account-only label key and palate, and the cupping CSV
# (host-or-manager is judged on the device itself, not its pick). V: the label
# key, which only the host (U) may see.
REFUSED_GETS = {
    "device": {"admin.get_group", "admin.list_members", "admin.list_device_codes",
               "tasting.export_coffees_csv", "tasting.get_label_key", "tasting.get_palate",
               "tasting.export_cupping_csv"},
    "v": {"tasting.get_label_key"},
    "u": set(),
}

_ID_ARG = re.compile(r"<int:(\w+)>")
_JPEG = b"\xff\xd8\xff" + b"x" * 16


@dataclass
class GroupData:
    id: int
    flight_id: int          # open, blind, advanced, one read
    closed_flight_id: int   # closed, advanced, one read (two in A: U and V)
    basic_flight_id: int    # closed, basic (solo), one read: the reveal
    coffee_id: int
    coffee2_id: int         # the flights' second cup
    member_id: int          # roster only, no account
    code_id: int
    host_member_id: int     # U's member row here: hosts both flights

    def ids(self, flight_id=None) -> dict:
        return {"flight_id": flight_id or self.flight_id, "coffee_id": self.coffee_id,
                "member_id": self.member_id, "code_id": self.code_id}


@dataclass
class Sweep:
    world: World
    a: GroupData
    b: GroupData

    def call(self, who, method, path, group=None, query="", json_body=None, multipart=False,
             form=None):
        """``multipart`` sends one scan photo; ``form`` is any other multipart body."""
        headers = dict(self.world.headers[who])
        if group is not None:
            headers["X-Group"] = str(group.id)
        url = f"{path}?{query}" if query else path
        kw = {}
        if multipart:
            form = {"photos": [(io.BytesIO(_JPEG), "sheet.jpg", "image/jpeg")]}
        if form is not None:
            kw = {"data": form, "content_type": "multipart/form-data"}
        elif json_body is not None:
            kw = {"json": json_body}
        return getattr(self.world.clients[who], method.lower())(url, headers=headers, **kw)


# ---------------------------------------------------------------------------
# setup
# ---------------------------------------------------------------------------

def _build_group(world: World, who: str, group, prefix: str, readers=("u",)) -> GroupData:
    xg = {"X-Group": str(group.id)}
    coffee = world.coffee(group=group, name=f"{prefix}-coffee")
    second = world.coffee(group=group, name=f"{prefix}-coffee-2")
    ids = [coffee.id, second.id]

    def open_flight(name, blind, readers):
        r = world.send(who, "post", "/flights", headers=xg, json={
            "coffee_ids": ids, "prep": "cupping", "shared": True, "blind": blind,
            "sheet": "advanced", "name": name})
        assert r.status_code == 201, r.get_json()
        fid = r.get_json()["id"]
        entries = [dict(e, note=f"{prefix}-note") for e in _ADV_ENTRIES]
        for reader in readers:
            r = world.send(reader, "post", f"/flights/{fid}/tastings", headers=xg, json={"entries": entries})
            assert r.status_code == 201, r.get_json()
        return fid

    open_id = open_flight(f"{prefix}-flight-open", True, ("u",))
    closed_id = open_flight(f"{prefix}-flight-closed", False, readers)
    r = world.send(who, "post", "/flights", headers=xg, json={
        "coffee_ids": [coffee.id], "prep": "drip", "name": f"{prefix}-flight-basic",
        "entries": [entry(coffee.id, note=f"{prefix}-note")]})
    assert r.status_code == 201, r.get_json()
    basic_id = r.get_json()["id"]
    assert world.send(who, "post", f"/flights/{closed_id}/close", headers=xg, json={}).status_code == 200
    member = world.roster_only(f"{prefix}-member", group=group)
    client = world.clients[who]
    r = client.post("/api/group/device-codes", headers={**world.headers[who], **xg})
    assert r.status_code == 201, r.get_json()
    return GroupData(id=group.id, flight_id=open_id, closed_flight_id=closed_id, basic_flight_id=basic_id,
                     coffee_id=coffee.id, coffee2_id=second.id, member_id=member.id,
                     code_id=r.get_json()["id"], host_member_id=_member_of(world, who, group))


def _member_of(world: World, who: str, group) -> int:
    return db.session.execute(db.select(Member.id).where(
        Member.user_id == world.user_id(who), Member.group_id == group.id)).scalar_one()


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
    world.group.name, world.other.name = "Alpha-group", f"{SENTINEL}-group"
    db.session.commit()                        # U: admin of A and of B
    a = _build_group(world, "u", world.group, "Alpha", readers=("u", "v"))
    b = _build_group(world, "u", world.other, SENTINEL)
    # A solo flight the device logs as U's A member: a device pick's recent
    # flights are its device-door ones.
    r = world.send("device", "post", "/flights", json={
        "coffee_ids": [a.coffee_id], "prep": "drip", "name": "Alpha-device-flight",
        "member_id": a.host_member_id, "entries": [entry(a.coffee_id)]})
    assert r.status_code == 201, r.get_json()
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
    group = db.session.get(Group, b.id)
    flights = db.session.execute(db.select(TastingFlight).where(TastingFlight.group_id == b.id)
                                 .order_by(TastingFlight.id)).scalars().all()
    return {
        "group": (group.name, group.timezone),
        "flights": [(f.id, f.name, f.is_open, f.closed_at) for f in flights],
        "tastings": db.session.execute(db.select(db.func.count(Tasting.id)).join(TastingFlight)
                                       .where(TastingFlight.group_id == b.id)).scalar_one(),
        "coffees": [(c.id, c.name, c.archived_at, c.is_sample) for c in db.session.execute(
            db.select(TastingCoffee).where(TastingCoffee.group_id == b.id)
            .order_by(TastingCoffee.id)).scalars()],
        "members": [(m.id, m.display_name, m.role, m.active, m.is_sample) for m in db.session.execute(
            db.select(Member).where(Member.group_id == b.id).order_by(Member.id)).scalars()],
        "codes": [(c.id, c.revoked_at) for c in db.session.execute(
            db.select(DeviceCode).where(DeviceCode.group_id == b.id)
            .order_by(DeviceCode.id)).scalars()],
    }


def _fail(label, r, limit=300):
    return f"{label}: {r.status_code} {r.get_data(as_text=True)[:limit]}"


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
            failures.append(_fail(f"{who} {method} {rule.rule}", r, 200))
    return failures


def _get_rules(app):
    return [r for r in _group_rules(app) if "GET" in r.methods]


def _get_paths(rule, group: GroupData) -> list:
    """The rule with this group's ids, once per flight."""
    flights = (group.flight_id, group.closed_flight_id, group.basic_flight_id)
    return sorted({_path(rule, group.ids(fid)) for fid in flights})


def _get_query(sweep: Sweep, endpoint, who, prefix) -> str:
    """The rule's extra query; the device also picks U's A member, who hosts
    A's flights and is, as U, also in B."""
    parts = [GET_QUERY.get(endpoint, "").format(prefix=prefix)]
    if who == "device":
        parts.append(f"member_id={sweep.a.host_member_id}")
    return "&".join(p for p in parts if p)


def _list_failures(sweep: Sweep, app) -> list:
    """A's actors, on every GET with A's and B's ids, never see a B sentinel."""
    failures = []
    for rule in _get_rules(app):
        paths = sorted(set(_get_paths(rule, sweep.a)) | set(_get_paths(rule, sweep.b)))
        for path in paths:
            for who in A_ACTORS:
                query = _get_query(sweep, rule.endpoint, who, SENTINEL)
                r = sweep.call(who, "GET", path, _a_group(sweep, who), query=query)
                if r.status_code >= 500 or SENTINEL in r.get_data(as_text=True):
                    failures.append(_fail(f"{who} GET {path}?{query}", r))
    return failures


def _shows(responses, needle) -> bool:
    return any(needle in r.get_data(as_text=True) for r in responses)


def _list_reach_failures(sweep: Sweep, app) -> list:
    """The positive control for ``_list_failures``: each GET reaches real rows.
    U acting in B gets a 2xx that shows the sentinel; each A actor gets a 2xx
    that shows A's names, except where ``REFUSED_GETS`` expects a 403."""
    failures = []
    for rule in _get_rules(app):
        named = rule.endpoint not in NAMELESS_GETS
        query = _get_query(sweep, rule.endpoint, "u", SENTINEL)
        ok = [r for r in (sweep.call("u", "GET", p, sweep.b, query=query)
                          for p in _get_paths(rule, sweep.b)) if r.status_code < 300]
        if not ok:
            failures.append(f"u in B: no 2xx on {rule.rule}")
        elif named and not _shows(ok, SENTINEL):
            failures.append(f"u in B: {rule.rule} never shows {SENTINEL}")
        for who in A_ACTORS:
            query = _get_query(sweep, rule.endpoint, who, "Alpha")
            responses = [sweep.call(who, "GET", p, _a_group(sweep, who), query=query)
                         for p in _get_paths(rule, sweep.a)]
            if rule.endpoint in REFUSED_GETS[who]:
                # 404 only where the rule doesn't apply (the CSV on a basic flight).
                statuses = [r.status_code for r in responses]
                if 403 not in statuses or any(st not in (403, 404) for st in statuses):
                    failures.append(f"{who}: {rule.rule} should be refused, got "
                                    f"{[r.status_code for r in responses]}")
                continue
            ok = [r for r in responses if r.status_code < 300]
            if not ok:
                failures.append(f"{who} in A: no 2xx on {rule.rule}: "
                                f"{[r.status_code for r in responses]}")
            elif named and not _shows(ok, "Alpha"):
                failures.append(f"{who} in A: {rule.rule} never shows Alpha")
    return failures


@dataclass
class IdCase:
    """B's id inside an otherwise-valid request acting in A. ``send(B's id)``
    must be refused exactly as ``refusal`` says; ``send(A's id)``, the twin,
    must succeed, which proves the refusal is about the id and nothing else."""
    label: str
    send: Callable
    own: int
    other: int
    refusal: dict      # {"status": 404, "field": ...} or {"status": 404, "error": ...}


def _body_id_cases(sweep: Sweep) -> list:
    a, b, world = sweep.a, sweep.b, sweep.world
    base = "/api/tasting"
    # An unlocked blind flight V hosts in A, so the cups PUT reaches its ids.
    r = world.send("v", "post", "/flights", headers={"X-Group": str(a.id)}, json={
        "coffee_ids": [a.coffee_id], "prep": "cupping", "shared": True, "blind": True})
    assert r.status_code == 201, r.get_json()
    unlocked = r.get_json()["id"]
    no_member = {"status": 404, "error": "not_found"}

    def coffee_404(field):
        return {"status": 404, "field": field}

    def device_get(path, extra=""):
        return lambda mid: sweep.call("device", "GET", f"{base}{path}",
                                      query=f"{extra}member_id={mid}")

    def device_post(path, body):
        return lambda mid: sweep.call("device", "POST", f"{base}{path}",
                                      json_body={**body, "member_id": mid})

    cases = [
        IdCase("device ?member_id= on recent", device_get("/flights/recent"),
               a.member_id, b.member_id, no_member),
        IdCase("device ?member_id= on a flight", device_get(f"/flights/{a.flight_id}"),
               a.member_id, b.member_id, no_member),
        IdCase("device ?member_id= on my coffees", device_get("/coffees", "mine=1&"),
               a.member_id, b.member_id, no_member),
    ]
    # Each paper twin names its own A member: one person gets one read per cup.
    for who, paper_taster in (("v", world.member_id("member")), ("u", world.member_id("editor"))):
        def create(ids_of, who=who, **extra):
            return lambda cid: sweep.call(who, "POST", f"{base}/flights", a,
                                          json_body={"coffee_ids": ids_of(cid), **extra})
        cases += [
            IdCase(f"{who} POST /flights coffee_ids",
                   create(lambda cid: [cid], prep="cupping", shared=True),
                   a.coffee_id, b.coffee_id, coffee_404("coffee_ids")),
            IdCase(f"{who} POST /flights mixed coffee_ids",
                   create(lambda cid: [a.coffee_id, cid], prep="cupping", shared=True),
                   a.coffee2_id, b.coffee_id, coffee_404("coffee_ids")),
            IdCase(f"{who} POST /flights solo coffee_ids",
                   lambda cid, who=who: sweep.call(who, "POST", f"{base}/flights", a, json_body={
                       "coffee_ids": [cid], "prep": "drip", "entries": [entry(cid)]}),
                   a.coffee_id, b.coffee_id, coffee_404("coffee_ids")),
            IdCase(f"{who} paper taster_member_id",
                   lambda mid, who=who: sweep.call(
                       who, "POST", f"{base}/flights/{a.flight_id}/paper", a,
                       json_body={"taster_member_id": mid, "entries": _ADV_ENTRIES}),
                   paper_taster, b.member_id, no_member),
        ]
    cases += [
        IdCase("v cups PUT coffee_id",
               lambda cid: sweep.call("v", "PUT", f"{base}/flights/{unlocked}/cups", a, json_body={
                   "cups": [{"coffee_id": a.coffee_id}, {"coffee_id": cid}]}),
               a.coffee2_id, b.coffee_id, coffee_404("cups")),
        IdCase("device tasting entry member_id",
               device_post(f"/flights/{a.flight_id}/tastings", {"entries": _ADV_ENTRIES}),
               a.member_id, b.member_id, no_member),
        IdCase("device timer member_id", device_post(f"/flights/{a.flight_id}/timer", {}),
               a.host_member_id, b.member_id, no_member),
        IdCase("device paper member_id",
               device_post(f"/flights/{a.flight_id}/paper", {"guest_name": "Pat", "entries": _ADV_ENTRIES}),
               a.host_member_id, b.member_id, no_member),
        # Last: closing A's open flight ends what the cases above can do on it.
        IdCase("device close member_id", device_post(f"/flights/{a.flight_id}/close", {}),
               a.host_member_id, b.member_id, no_member),
    ]
    return cases


def _body_id_failures(sweep: Sweep) -> list:
    failures = []
    for case in _body_id_cases(sweep):
        r = case.send(case.other)
        body = r.get_json(silent=True) or {}
        expected = {k: v for k, v in case.refusal.items() if k != "status"}
        if (r.status_code != case.refusal["status"]
                or any(body.get(k) != v for k, v in expected.items())
                or SENTINEL in r.get_data(as_text=True)):
            failures.append(_fail(f"{case.label} (B id)", r))
        twin = case.send(case.own)
        if not 200 <= twin.status_code < 300:
            failures.append(_fail(f"{case.label} (A id twin)", twin))
    return failures


def _upload(sweep: Sweep, who, path, text, **form):
    return sweep.call(who, "POST", path, sweep.a, form={
        "file": (io.BytesIO(text.encode()), "upload.csv"), **form})


def _swapped(r, name) -> dict:
    """A preview with the probed name replaced and the hash (which covers it) dropped."""
    body = json.loads(r.get_data(as_text=True).replace(name, "NAME"))
    body.pop("plan_hash", None)
    return body


def _add_sample_rows(world: World):
    """A sample coffee and member in each group, once."""
    for group, prefix in ((world.group, "Alpha"), (world.other, SENTINEL)):
        name = f"{prefix}-sample-coffee"
        if db.session.execute(db.select(TastingCoffee.id).where(TastingCoffee.name == name)).first():
            continue
        world.coffee(group=group, name=name, is_sample=True)
        db.session.add(Member(group_id=group.id, display_name=f"{prefix}-sample-member",
                              role="member", active=True, is_sample=True))
    db.session.commit()


def _non_id_write_failures(sweep: Sweep) -> list:
    """The writes that take no ids, acting in A: what B holds must neither change
    nor show through. A create or import naming B's coffee, flight or member
    must answer exactly as one naming something that exists nowhere: a 409 or
    a "matches" there would be an existence oracle for B."""
    a, b, world = sweep.a, sweep.b, sweep.world
    failures = []

    def expect(label, r, status):
        if r.status_code != status:
            failures.append(_fail(label, r))
        return r

    _add_sample_rows(world)   # in both groups; only A's may go
    before = _snapshot_b(b)
    r = expect("v DELETE sample-data", sweep.call("v", "DELETE", "/api/group/sample-data", a), 200)
    if r.status_code == 200 and r.get_json() != {"flights": 0, "members": 1, "coffees": 1, "kept_coffees": 0}:
        failures.append(_fail("v DELETE sample-data removed the wrong rows", r))
    expect("u DELETE sample-data", sweep.call("u", "DELETE", "/api/group/sample-data", a), 200)
    if _snapshot_b(b) != before:
        failures.append("DELETE sample-data acting in A changed B")
    expect("v POST sample-data (A has coffees)",
           sweep.call("v", "POST", "/api/group/sample-data", a), 409)

    # Creates naming B's things answer like creates naming nothing.
    for name in (f"{SENTINEL}-coffee", "Fresh-coffee"):
        expect(f"v POST /coffees {name}", sweep.call("v", "POST", "/api/tasting/coffees", a,
                                                     json_body={"name": name, "roaster": "Roaster",
                                                                "kind": "house"}), 201)
    for name in (f"{SENTINEL}-member", "Fresh-member"):
        expect(f"v POST /group/members {name}", sweep.call(
            "v", "POST", "/api/group/members", a, json_body={"display_name": name}), 201)
    expect("v POST /group/members with B's admin email", sweep.call(
        "v", "POST", "/api/group/members", a,
        json_body={"display_name": "Visitor", "email": world.members["outsider"][0].email}), 201)

    # Coffee CSV: B's second coffee previews as a create, like a fresh name.
    coffee_csv = "id,name,roaster,kind\n,{},Roaster,house\n"
    previews = {}
    for name in (f"{SENTINEL}-coffee-2", "Fresh-coffee-2"):
        r = expect(f"coffee preview {name}", _upload(
            sweep, "v", "/api/tasting/coffees/import/preview", coffee_csv.format(name)), 200)
        previews[name] = r
    if all(r.status_code == 200 for r in previews.values()):
        probe, fresh = (_swapped(r, n) for n, r in previews.items())
        if probe != fresh or len(probe["creates"]) != 1:
            failures.append(f"coffee preview differs for B's name: {probe} vs {fresh}")
        r = previews[f"{SENTINEL}-coffee-2"]
        expect("coffee import B's name", _upload(
            sweep, "v", "/api/tasting/coffees/import", coffee_csv.format(f"{SENTINEL}-coffee-2"),
            plan_hash=r.get_json()["plan_hash"]), 200)

    # Flight CSV: B's flight and coffee names count as unknown here (no
    # existing flight, a new coffee), like fresh ones.
    flight_csv = "flight,prep,position,blind_label,roaster,name,kind\n{},cupping,1,,Roaster,{},house\n"
    probe_names = (f"{SENTINEL}-flight-open", f"{SENTINEL}-sample-coffee")
    previews = {}
    for flight, coffee in (probe_names, ("Fresh-flight", "Fresh-coffee-3")):
        previews[flight] = expect(f"flight preview {flight}", _upload(
            sweep, "v", "/api/tasting/flights/import/preview", flight_csv.format(flight, coffee)), 200)
    if all(r.status_code == 200 for r in previews.values()):
        (fp, cp), (ff, cf) = probe_names, ("Fresh-flight", "Fresh-coffee-3")
        probe = json.loads(previews[fp].get_data(as_text=True).replace(fp, "F").replace(cp, "C"))
        fresh = json.loads(previews[ff].get_data(as_text=True).replace(ff, "F").replace(cf, "C"))
        probe.pop("plan_hash"), fresh.pop("plan_hash")
        if probe != fresh or probe["flights"][0]["existing_count"] != 0:
            failures.append(f"flight preview differs for B's names: {probe} vs {fresh}")
        expect("flight import B's names", _upload(
            sweep, "v", "/api/tasting/flights/import", flight_csv.format(*probe_names),
            plan_hash=previews[fp].get_json()["plan_hash"], flights=json.dumps([fp])), 201)

    expect("v PATCH /group", sweep.call("v", "PATCH", "/api/group", a,
                                         json_body={"name": "Alpha-renamed", "timezone": "Europe/Oslo"}), 200)
    expect("v POST device code", sweep.call("v", "POST", "/api/group/device-codes", a), 201)
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
            failures.append(_fail(f"{method} {rule.rule}", r, 200))
    assert not failures, "\n".join(failures)


def test_id_routes_cross_group_404(sweep, app):
    before = _snapshot_b(sweep.b)
    failures = _cross_group_failures(sweep, app)
    assert not failures, "\n".join(failures)
    assert _snapshot_b(sweep.b) == before


def test_list_routes_reach_their_rows(sweep, app):
    failures = _list_reach_failures(sweep, app)
    assert not failures, "\n".join(failures)


def test_list_routes_show_no_sentinel(sweep, app):
    failures = _list_failures(sweep, app)
    assert not failures, "\n".join(failures)


def test_list_sweep_covers_the_lists(app):
    """The GETs the brief names are all in the sweep."""
    gets = {r.rule for r in _get_rules(app)}
    named = {"/api/tasting/coffees", "/api/tasting/coffees/match", "/api/tasting/coffees/export.csv",
             "/api/tasting/flights/recent", "/api/tasting/palate", "/api/group",
             "/api/group/members", "/api/group/device-codes", "/api/device/members"}
    assert named <= gets, named - gets


def test_body_and_query_ids_from_other_group(sweep):
    before = _snapshot_b(sweep.b)
    failures = _body_id_failures(sweep)
    assert not failures, "\n".join(failures)
    assert _snapshot_b(sweep.b) == before


def test_non_id_writes_leave_b_alone(sweep):
    _add_sample_rows(sweep.world)
    before = _snapshot_b(sweep.b)
    failures = _non_id_write_failures(sweep)
    assert not failures, "\n".join(failures)
    assert _snapshot_b(sweep.b) == before


def test_group_b_unchanged(sweep, app):
    """Every cross-group sweep in one world, then B's rows are as they were."""
    _add_sample_rows(sweep.world)
    before = _snapshot_b(sweep.b)
    assert before["flights"] and before["tastings"] > 0 and before["codes"]
    _cross_group_failures(sweep, app)
    _list_failures(sweep, app)
    _body_id_failures(sweep)
    _non_id_write_failures(sweep)
    after = _snapshot_b(sweep.b)
    assert after == before, json.dumps({"before": before, "after": after}, default=str, indent=1)
