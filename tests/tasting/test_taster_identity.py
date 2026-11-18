"""TasterIdentity, same_person, may_see_named and to_group_local."""
import datetime

import pytest

from identity.access import Actor
from tasting.models import Tasting
from tasting.repository import TasterIdentity, guest_slug, may_see_named, same_person
from utils import to_group_local


def _actor(kind, **kw):
    base = dict(kind=kind, group_id=1, user_id=7, member_id=3, role=None, display_name="Alex")
    base.update(kw)
    return Actor(**base)


class TestIdentity:
    def test_user_actor_is_the_account_door(self):
        who = TasterIdentity.from_actor(_actor("user", role="member"))
        assert (who.taster_key, who.created_via, who.user_id, who.member_id) == ("user:7", "account", 7, 3)

    def test_device_pick_is_the_device_door_even_when_linked(self):
        who = TasterIdentity.from_actor(_actor("device"))     # a pick of a linked member
        assert (who.taster_key, who.created_via) == ("member:3", "device")
        assert who.user_id == 7

    def test_unpicked_device_has_no_identity(self):
        with pytest.raises(ValueError):
            TasterIdentity.from_actor(_actor("device", user_id=None, member_id=None))

    def test_paper_forms(self):
        by_member = TasterIdentity.paper(member_id=4, member_name="Sam")
        assert (by_member.taster_key, by_member.user_id, by_member.created_via) == ("paper:member:4", None, "paper")
        guest = TasterIdentity.paper(guest_name="  Pat O'Neil ")
        assert guest.taster_key == "paper:name:pat-o-neil" and guest.name == "Pat O'Neil"
        with pytest.raises(ValueError):
            TasterIdentity.paper()
        with pytest.raises(ValueError):
            TasterIdentity.paper(member_id=1, guest_name="x")

    def test_guest_slug_falls_back_to_a_hash(self):
        assert guest_slug("Zoë") == "zoe"
        assert guest_slug("山田").startswith("g")


class TestSamePerson:
    def _read(self, **kw):
        return Tasting(taster_key=kw.pop("taster_key", "user:7"), user_id=kw.pop("user_id", None),
                       member_id=kw.pop("member_id", None))

    def test_one_human_three_doors(self):
        me = TasterIdentity.from_actor(_actor("user", role="member"))
        assert same_person(self._read(taster_key="user:7", user_id=7, member_id=3), me)
        assert same_person(self._read(taster_key="member:3", user_id=7, member_id=3), me)
        assert same_person(self._read(taster_key="paper:member:3", member_id=3), me)
        assert not same_person(self._read(taster_key="user:8", user_id=8, member_id=4), me)
        assert not same_person(self._read(taster_key="paper:name:pat"), me)
        assert not same_person(self._read(), None)


class TestMaySeeNamed:
    class Flight:
        def __init__(self, created_via="account", host_user_id=7):
            self.created_via, self.host_user_id = created_via, host_user_id

    def test_managers_and_the_account_host(self):
        assert may_see_named(self.Flight(host_user_id=1), _actor("user", role="editor"))
        assert may_see_named(self.Flight(host_user_id=1), _actor("user", role="admin"))
        assert may_see_named(self.Flight(), _actor("user", role="member"))
        assert not may_see_named(self.Flight(host_user_id=1), _actor("user", role="member"))

    def test_a_device_never_counts_even_when_the_pick_is_the_host(self):
        assert not may_see_named(self.Flight(), _actor("device"))
        assert not may_see_named(self.Flight(created_via="device"), _actor("user", role="member"))
        assert not may_see_named(self.Flight(), None)


class TestToGroupLocal:
    def test_dst_and_none(self):
        utc = datetime.datetime(2026, 9, 10, 6, 30)
        assert to_group_local(utc, "America/Los_Angeles") == datetime.datetime(2026, 9, 9, 23, 30)
        assert to_group_local(datetime.datetime(2026, 12, 10, 6, 30), "America/Los_Angeles") == \
            datetime.datetime(2026, 12, 9, 22, 30)
        assert to_group_local(utc, "UTC") == utc
        assert to_group_local(None, "UTC") is None
