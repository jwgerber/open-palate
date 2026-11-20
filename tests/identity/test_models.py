import pytest
from sqlalchemy.exc import IntegrityError

from identity.models import DeviceCode, Group, LoginToken, Member, Session, User
from utils import utc_now


def make_user(email="a@example.com"):
    return User(email=email, display_name="A")


def make_group(name="G"):
    return Group(name=name)


def test_user_email_is_normalized(db_session):
    user = make_user("  Mixed@Example.COM ")
    db_session.add(user)
    db_session.commit()
    assert user.email == "mixed@example.com"


def test_user_email_unique(db_session):
    db_session.add_all([make_user("x@example.com"), make_user("X@example.com")])
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_group_defaults(db_session):
    group = make_group()
    db_session.add(group)
    db_session.commit()
    assert group.timezone == "UTC"
    assert group.is_personal is False
    assert group.created_at is not None


def test_member_role_check(db_session):
    group = make_group()
    db_session.add(group)
    db_session.flush()
    db_session.add(Member(group_id=group.id, display_name="M", role="owner"))
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_member_defaults_active(db_session):
    group = make_group()
    db_session.add(group)
    db_session.flush()
    member = Member(group_id=group.id, display_name="M", role="member")
    db_session.add(member)
    db_session.commit()
    assert member.active is True


def test_member_unique_user_per_group(db_session):
    group, user = make_group(), make_user()
    db_session.add_all([group, user])
    db_session.flush()
    db_session.add(Member(group_id=group.id, user_id=user.id, display_name="A", role="admin"))
    db_session.add(Member(group_id=group.id, user_id=user.id, display_name="B", role="member"))
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_member_email_unique_per_group_case_insensitive(db_session):
    g1, g2 = make_group("one"), make_group("two")
    db_session.add_all([g1, g2])
    db_session.flush()
    db_session.add(Member(group_id=g1.id, display_name="A", role="member", email="p@x.io"))
    db_session.add(Member(group_id=g2.id, display_name="A", role="member", email="P@X.io"))
    db_session.commit()  # different group: fine
    db_session.add(Member(group_id=g1.id, display_name="B", role="member", email="P@x.IO"))
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_member_null_emails_may_repeat(db_session):
    group = make_group()
    db_session.add(group)
    db_session.flush()
    db_session.add_all([
        Member(group_id=group.id, display_name="A", role="member"),
        Member(group_id=group.id, display_name="B", role="member"),
    ])
    db_session.commit()


def test_login_token_purpose_check(db_session):
    user = make_user()
    db_session.add(user)
    db_session.flush()
    db_session.add(LoginToken(user_id=user.id, token_hash="h", purpose="bogus",
                              expires_at=utc_now()))
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_login_token_hash_unique(db_session):
    user = make_user()
    db_session.add(user)
    db_session.flush()
    for _ in range(2):
        db_session.add(LoginToken(user_id=user.id, token_hash="same", purpose="signin",
                                  expires_at=utc_now()))
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_user_session_valid_and_device_session_valid(db_session):
    user, group = make_user(), make_group()
    db_session.add_all([user, group])
    db_session.flush()
    now = utc_now()
    db_session.add(Session(user_id=user.id, token_hash="u", kind="user",
                           created_at=now, last_seen_at=now, expires_at=now))
    db_session.add(Session(device_group_id=group.id, token_hash="d", kind="device",
                           created_at=now, last_seen_at=now, expires_at=now))
    db_session.commit()


def test_session_shape_check_rejects_mixed(db_session):
    user, group = make_user(), make_group()
    db_session.add_all([user, group])
    db_session.flush()
    now = utc_now()
    db_session.add(Session(user_id=user.id, device_group_id=group.id, token_hash="m",
                           kind="user", created_at=now, last_seen_at=now, expires_at=now))
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_device_code(db_session):
    user, group = make_user(), make_group()
    db_session.add_all([user, group])
    db_session.flush()
    code = DeviceCode(group_id=group.id, code_hash="c", created_by=user.id,
                      expires_at=utc_now())
    db_session.add(code)
    db_session.commit()
    assert code.revoked_at is None


def test_tests_are_isolated_from_each_other(db_session):
    assert db_session.query(User).count() == 0
    assert db_session.query(Group).count() == 0


def test_owner_and_personal_defaults(db_session):
    from identity.models import InstallSettings
    user, group = make_user("o@example.com"), make_group()
    db_session.add_all([user, group])
    db_session.commit()
    assert user.is_owner is False
    assert group.personal_user_id is None
    assert db_session.get(InstallSettings, 1) is not None
    assert db_session.get(InstallSettings, 1).public_url is None
