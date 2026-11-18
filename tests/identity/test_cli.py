import re

from identity.models import Group, Member, User


def test_create_admin_prints_link(app, client, db_session):
    result = app.test_cli_runner().invoke(args=["create-admin", " Owner@Cafe.com"])
    assert result.exit_code == 0, result.output
    match = re.search(r"http://localhost/api/auth/consume\?token=(\S+)", result.output)
    assert match

    user = db_session.query(User).one()
    assert user.email == "owner@cafe.com"
    group = db_session.query(Group).one()
    assert (group.name, group.timezone) == ("My café", "UTC")
    member = db_session.query(Member).one()
    assert (member.role, member.user_id, member.group_id) == ("admin", user.id, group.id)

    resp = client.get(f"/api/auth/consume?token={match.group(1)}")
    assert resp.headers["Location"] == "http://localhost/"
    me = client.get("/api/auth/me").get_json()
    assert [(g["name"], g["role"]) for g in me["groups"]] == [("My café", "admin")]


def test_create_admin_reuses_user_and_group(app, db_session):
    runner = app.test_cli_runner()
    assert runner.invoke(args=["create-admin", "owner@cafe.com"]).exit_code == 0
    result = runner.invoke(args=["create-admin", "OWNER@cafe.com"])
    assert result.exit_code == 0, result.output
    assert db_session.query(User).count() == 1
    assert db_session.query(Group).count() == 1
    assert db_session.query(Member).count() == 1
