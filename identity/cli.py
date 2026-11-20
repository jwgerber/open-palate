"""Server commands: `flask create-admin`, `remove-owner`, `signin-link`."""
import click
from flask import Flask
from sqlalchemy import func

from extensions import db
from identity.accounts import (default_display_name, ensure_admin, find_user_by_ref,
                               get_or_create_user, issue_signin_link, normalize_email)
from identity.models import Group, Member, User


def _fail(message: str) -> None:
    click.echo(message, err=True)
    raise SystemExit(1)


def _existing_user(ref: str) -> User:
    user = find_user_by_ref(ref)
    if user is None:
        _fail(f"No user with id {ref}" if ref.strip().isdigit() else f"No user {ref}")
    return user


def _make_group_admin(user: User, group: Group) -> None:
    member = db.session.execute(
        db.select(Member).where(Member.group_id == group.id,
                                (Member.user_id == user.id) | (func.lower(Member.email) == user.email))
        .order_by(Member.id).limit(1)
    ).scalar_one_or_none()
    if member is None:
        db.session.add(Member(group_id=group.id, display_name=user.display_name,
                              email=user.email, user_id=user.id, role="admin"))
    else:
        member.user_id, member.role, member.active = user.id, "admin", True


def _non_personal_groups() -> list[Group]:
    return list(db.session.execute(
        db.select(Group).where(Group.is_personal.is_(False)).order_by(Group.id)).scalars())


@click.command("create-admin")
@click.argument("who")
@click.option("--name", "display_name", default=None, help="Display name (default: from email).")
@click.option("--group", "group_id", type=int, default=None,
              help="Make them admin of this group (needed when there are several).")
@click.option("--owner-only", is_flag=True, help="Make them an owner without joining a group.")
def create_admin(who: str, display_name: str | None, group_id: int | None,
                 owner_only: bool) -> None:
    """Make WHO (an email or user id) an owner and admin; print a sign-in link.

    Also the way back in when a group has lost every admin."""
    groups = _non_personal_groups()
    if group_id is not None and owner_only:
        raise click.UsageError("Pass --group or --owner-only, not both")
    if group_id is None and not owner_only and len(groups) > 1:
        _fail("Several groups: pass --group ID or --owner-only")
    chosen = None
    if group_id is not None:
        chosen = next((g for g in groups if g.id == group_id), None)
        if chosen is None:
            _fail(f"No group with id {group_id}")

    if who.strip().isdigit():
        user = _existing_user(who)
    else:
        email = normalize_email(who)
        if email is None:
            raise click.BadParameter("not an email address or user id", param_hint="WHO")
        user = get_or_create_user(email, display_name or default_display_name(email))

    if owner_only:
        user.is_owner = True
    elif chosen is not None:
        user.is_owner = True
        _make_group_admin(user, chosen)
    else:  # none or one group: the install's group, created when missing
        ensure_admin(user.email, user.display_name)
    link, _ = issue_signin_link(user)
    db.session.commit()
    click.echo(f"Admin ready: {user.email}")
    click.echo(f"Sign in within 15 minutes (works once): {link}")


@click.command("remove-owner")
@click.argument("who")
def remove_owner(who: str) -> None:
    """Clear the owner flag on WHO (an email or user id); never the last owner."""
    user = _existing_user(who)
    owners = db.session.execute(
        db.select(func.count(User.id)).where(User.is_owner.is_(True))).scalar_one()
    if user.is_owner and owners <= 1:
        _fail("Can't remove the last owner")
    if not user.is_owner:
        click.echo(f"{user.email} is not an owner")
        return
    user.is_owner = False
    db.session.commit()
    click.echo(f"{user.email} is no longer an owner")


@click.command("signin-link")
@click.argument("who")
def signin_link(who: str) -> None:
    """Print a one-time sign-in link for WHO (an email or user id); changes nothing else."""
    user = _existing_user(who)
    link, _ = issue_signin_link(user)
    db.session.commit()
    click.echo(f"Sign in within 15 minutes (works once): {link}")


def init_app(app: Flask) -> None:
    app.cli.add_command(create_admin)
    app.cli.add_command(remove_owner)
    app.cli.add_command(signin_link)
