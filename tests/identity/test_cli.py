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
    assert resp.headers["Location"] == "/"
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


from extensions import db  # noqa: E402
from tests.identity.helpers import make_group, make_member  # noqa: E402


def run(app, *args):
    return app.test_cli_runner().invoke(args=list(args))


def test_create_admin_one_group_restores_admin(app, db_session):
    group = make_group("A")
    user, member = make_member(group, "boss@cafe.com", role="member", active=False)
    result = run(app, "create-admin", "boss@cafe.com")
    assert result.exit_code == 0, result.output
    db_session.refresh(member)
    db_session.refresh(user)
    assert (member.role, member.active, user.is_owner) == ("admin", True, True)
    assert db_session.query(Member).count() == 1


def test_create_admin_many_groups_needs_group(app, db_session):
    a, b = make_group("A"), make_group("B")
    user, _ = make_member(a, "boss@cafe.com", role="member")
    result = run(app, "create-admin", "boss@cafe.com")
    assert result.exit_code == 1
    assert "Several groups: pass --group ID or --owner-only" in result.output
    assert db_session.get(User, user.id).is_owner is False

    result = run(app, "create-admin", "boss@cafe.com", "--group", str(b.id))
    assert result.exit_code == 0, result.output
    rows = {m.group_id: (m.role, m.active) for m in db_session.query(Member).all()}
    assert rows == {a.id: ("member", True), b.id: ("admin", True)}
    assert db_session.get(User, user.id).is_owner is True


def test_create_admin_owner_only_adds_no_member_row(app, db_session):
    make_group("A"), make_group("B")
    result = run(app, "create-admin", "new@cafe.com", "--owner-only")
    assert result.exit_code == 0, result.output
    assert db_session.query(Member).count() == 0
    assert db_session.query(User).one().is_owner is True
    assert "consume?token=" in result.output


def test_create_admin_by_user_id(app, db_session):
    user, member = make_member(make_group("A"), "boss@cafe.com")
    result = run(app, "create-admin", str(user.id))
    assert result.exit_code == 0, result.output
    db_session.refresh(member)
    assert member.role == "admin"
    assert db_session.get(User, user.id).is_owner is True


def test_create_admin_unknown_id_exits_1(app, db_session):
    result = run(app, "create-admin", "999")
    assert result.exit_code == 1
    assert "No user with id 999" in result.output


def test_create_admin_empty_install_makes_first_group(app, db_session):
    result = run(app, "create-admin", "boss@cafe.com")
    assert result.exit_code == 0, result.output
    assert db_session.query(Group).one().name == "My café"
    assert db_session.query(Member).one().role == "admin"


def make_owner(email):
    user, _ = make_member(make_group(email), email)
    user.is_owner = True
    db.session.commit()
    return user


def test_remove_owner_refuses_last(app, db_session):
    user = make_owner("a@cafe.com")
    result = run(app, "remove-owner", "a@cafe.com")
    assert result.exit_code == 1
    assert "Can't remove the last owner" in result.output
    assert db_session.get(User, user.id).is_owner is True


def test_remove_owner_ok_with_two(app, db_session):
    first, second = make_owner("a@cafe.com"), make_owner("b@cafe.com")
    result = run(app, "remove-owner", str(first.id))
    assert result.exit_code == 0, result.output
    assert db_session.get(User, first.id).is_owner is False
    assert db_session.get(User, second.id).is_owner is True


def test_signin_link_prints_link_changes_nothing(app, db_session):
    user, member = make_member(make_group("A"), "boss@cafe.com")
    result = run(app, "signin-link", "boss@cafe.com")
    assert result.exit_code == 0, result.output
    assert re.search(r"http://localhost/api/auth/consume\?token=\S+", result.output)
    db_session.refresh(user)
    db_session.refresh(member)
    assert (user.is_owner, member.role, member.active) == (False, "member", True)
    assert db_session.query(Member).count() == 1


def test_signin_link_unknown_exits_1(app, db_session):
    assert run(app, "signin-link", "nobody@cafe.com").exit_code == 1
    assert run(app, "signin-link", "999").exit_code == 1
