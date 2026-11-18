"""Shared helpers for identity route tests."""
from extensions import db
from identity.models import Group, Member, Session, User
from identity.sessions import SESSION_COOKIE, start_user_session


def make_group(name="Cafe", timezone="UTC") -> Group:
    group = Group(name=name, timezone=timezone)
    db.session.add(group)
    db.session.commit()
    return group


def make_member(group, email, role="member", name=None, active=True) -> tuple[User, Member]:
    user = User(email=email, display_name=name or email.split("@")[0])
    db.session.add(user)
    db.session.flush()
    member = Member(group_id=group.id, display_name=user.display_name, email=email,
                    user_id=user.id, role=role, active=active)
    db.session.add(member)
    db.session.commit()
    return user, member


def sign_in(client, user: User) -> dict:
    """Give the client a user session cookie; return the CSRF header."""
    from flask import Response
    set_cookie = start_user_session(user)
    response = set_cookie(Response())
    db.session.commit()
    raw = response.headers.get_all("Set-Cookie")[0].split(";")[0].split("=", 1)[1]
    client.set_cookie(SESSION_COOKIE, raw)
    return csrf(client)


def csrf(client) -> dict:
    client.get("/api/auth/me")
    return {"X-CSRF-Token": client.get_cookie("tasting_csrf").value}


def device_sessions(code_id=None):
    query = db.select(Session).where(Session.kind == "device")
    if code_id is not None:
        query = query.where(Session.device_code_id == code_id)
    return db.session.execute(query).scalars().all()
