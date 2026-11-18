"""A signed-in test world for the tasting routes: one group with a client per
kind of session (member, editor, admin, a shared device), people added on
demand, and a second group for the scoping tests."""
from flask import Response

from extensions import db
from identity.sessions import SESSION_COOKIE, start_device_session
from tests.identity.helpers import csrf, make_group, make_member, sign_in
from tests.tasting.helpers import make_coffee, make_tasting

BASE = "/api/tasting"


class World:
    """``who`` is a key into ``clients``: "member", "editor", "admin", "device",
    any name passed to ``person()``, or "outsider" (an admin of ``other``)."""

    def __init__(self, app, tz="UTC"):
        self.app = app
        self.group = make_group("Cafe", tz)
        self.other = make_group("Elsewhere")
        self.members = {}
        self.clients = {}
        self.headers = {}
        for role in ("member", "editor", "admin"):
            self.person(role, role, name=role.title())
        self.device = self._device_client(self.group)
        self.headers["device"] = csrf(self.device)
        self.clients["device"] = self.device
        self.person("outsider", "admin", group=self.other, name="Outsider")
        self.anon = app.test_client()

    def person(self, key, role="member", name=None, group=None):
        """A signed-in user with a member row; returns (user, member)."""
        group = group or self.group
        user, member = make_member(group, f"{key}@{'cafe' if group is self.group else 'else'}.example",
                                   role, name=name or key.title())
        client = self.app.test_client()
        self.headers[key] = sign_in(client, user)
        self.clients[key] = client
        self.members[key] = (user, member)
        return user, member

    def roster_only(self, name, group=None):
        """A member with no account: picked on the shared device only."""
        from identity.models import Member
        member = Member(group_id=(group or self.group).id, display_name=name, role="member", active=True)
        db.session.add(member)
        db.session.commit()
        return member

    def _device_client(self, group):
        client = self.app.test_client()
        response = start_device_session(group.id)(Response())
        db.session.commit()
        raw = response.headers.get_all("Set-Cookie")[0].split(";")[0].split("=", 1)[1]
        client.set_cookie(SESSION_COOKIE, raw)
        return client

    def member_id(self, who):
        return self.members[who][1].id

    def user_id(self, who):
        return self.members[who][0].id

    def get(self, who, path, **kw):
        return self.clients[who].get(BASE + path, **kw)

    def send(self, who, method, path, **kw):
        headers = {**self.headers[who], **kw.pop("headers", {})}
        return getattr(self.clients[who], method)(BASE + path, headers=headers, **kw)

    def coffee(self, group=None, **kw):
        coffee = make_coffee(db.session, group or self.group, **kw)
        db.session.commit()
        return coffee

    def read(self, flight, coffee, who="member", **kw):
        """A basic or advanced read stamped as this person's account read."""
        user, member = self.members[who]
        return make_tasting(db.session, flight, coffee, user_id=user.id, member_id=member.id,
                            taster_key=f"user:{user.id}", taster_name=member.display_name, **kw)

    # -- flights through the API ---------------------------------------------

    def open_flight(self, coffees, who="member", *, blind=False, sheet=None, prep="cupping",
                    pick=None, **extra):
        """Open a shared flight; ``pick`` names the device's member."""
        body = {"coffee_ids": [c.id for c in coffees], "prep": prep, "shared": True,
                "blind": blind, **extra}
        if sheet:
            body["sheet"] = sheet
        if pick is not None:
            body["member_id"] = pick
        r = self.send(who, "post", "/flights", json=body)
        assert r.status_code == 201, r.get_json()
        return r.get_json()["id"]

    def solo(self, coffees, who="member", entries=None, pick=None, **extra):
        body = {"coffee_ids": [c.id for c in coffees], "prep": "drip",
                "entries": entries or [entry(c.id) for c in coffees], **extra}
        if pick is not None:
            body["member_id"] = pick
        return self.send(who, "post", "/flights", json=body)

    def log(self, fid, entries, who="member", pick=None):
        body = {"entries": entries}
        if pick is not None:
            body["member_id"] = pick
        return self.send(who, "post", f"/flights/{fid}/tastings", json=body)

    def close(self, fid, who="member", pick=None):
        return self.send(who, "post", f"/flights/{fid}/close",
                         json={} if pick is None else {"member_id": pick})


def entry(coffee_id, overall=4, **kw):
    return {"coffee_id": coffee_id, "overall": overall, **kw}


def adv_entry(score=8.5, vote="yes", **kw):
    from tasting.enums import ADV_CATEGORIES
    return {**{c: score for c in ADV_CATEGORIES}, "bar_vote": vote, **kw}
