"""Sample members are hidden from every picker and cannot be edited or signed in."""
import pytest

from extensions import db
from identity.models import Member
from tests.tasting.world import World


@pytest.fixture
def world(db_session, app):
    return World(app)


@pytest.fixture
def sample(world):
    member = Member(group_id=world.group.id, display_name="Sample · Robin", role="member",
                    active=True, is_sample=True)
    db.session.add(member)
    db.session.commit()
    return member


def test_device_members_hide_sample(world, sample):
    listing = world.device.get("/api/device/members").get_json()
    assert sample.id not in [m["id"] for m in listing]
    assert listing  # the real members are still there


def test_device_cannot_pick_sample_member(world, sample):
    coffee = world.coffee()
    response = world.solo([coffee], who="device", pick=sample.id)
    assert response.status_code == 404


def test_paper_cannot_name_sample_member(world, sample):
    coffee = world.coffee()
    fid = world.open_flight([coffee], who="editor", sheet="advanced")
    from tests.tasting.world import adv_entry
    body = {"taster_member_id": sample.id,
            "entries": [dict(adv_entry(), position=1)]}
    response = world.send("editor", "post", f"/flights/{fid}/paper", json=body)
    assert response.status_code == 404


def test_admin_list_marks_sample(world, sample):
    rows = world.clients["admin"].get("/api/group/members").get_json()
    by_id = {r["id"]: r for r in rows}
    assert by_id[sample.id]["is_sample"] is True
    assert by_id[world.member_id("member")]["is_sample"] is False


def test_patch_sample_member_409(world, sample):
    response = world.clients["admin"].patch(
        f"/api/group/members/{sample.id}", json={"display_name": "Nope"},
        headers=world.headers["admin"])
    assert response.status_code == 409
    assert response.get_json() == {"error": "sample_member"}


def test_signin_link_for_sample_member_409(world, sample):
    response = world.clients["admin"].post(
        f"/api/group/members/{sample.id}/signin-link", json={}, headers=world.headers["admin"])
    assert response.status_code == 409
    assert response.get_json() == {"error": "sample_member"}
