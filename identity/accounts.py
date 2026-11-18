"""Account helpers shared by the auth routes, the CLI and app start-up."""
import logging
import secrets
from datetime import timedelta

from flask import current_app
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy import func, update
from sqlalchemy.exc import SQLAlchemyError

from extensions import db
from identity.models import Group, LoginToken, Member, User
from identity.tokens import new_token
from utils import utc_now

logger = logging.getLogger(__name__)

LINK_TTL = timedelta(minutes=15)
ADMIN_LINK_TTL = timedelta(hours=24)
DEFAULT_GROUP_NAME = "My café"
_SETUP_SALT = "tasting-setup"


def normalize_email(value) -> str | None:
    """Lower-cased, stripped email, or None when it can't be an address."""
    if not isinstance(value, str):
        return None
    email = value.strip().lower()
    local, _, domain = email.partition("@")
    if not local or not domain or len(email) > 320 or any(c.isspace() for c in email):
        return None
    return email


def default_display_name(email: str) -> str:
    return email.partition("@")[0][:120]


def find_user(email: str) -> User | None:
    return db.session.execute(db.select(User).where(User.email == email)).scalar_one_or_none()


def get_or_create_user(email: str, display_name: str) -> User:
    user = find_user(email)
    if user is None:
        user = User(email=email, display_name=display_name)
        db.session.add(user)
        db.session.flush()
    return user


def active_member_for_email(email: str) -> Member | None:
    return db.session.execute(
        db.select(Member).where(func.lower(Member.email) == email, Member.active.is_(True),
                                Member.user_id.is_(None))
        .order_by(Member.id).limit(1)
    ).scalar_one_or_none()


def user_has_active_member(user: User) -> bool:
    return db.session.execute(
        db.select(Member.id).where(Member.user_id == user.id, Member.active.is_(True)).limit(1)
    ).first() is not None


def issue_signin_link(user: User, ttl: timedelta = LINK_TTL, supersede: bool = False) -> str:
    """Add a single-use sign-in token (the caller commits); return its link.

    With `supersede`, the user's other unused sign-in tokens are marked used so
    only this newest link works."""
    now = utc_now()
    if supersede:
        db.session.execute(
            update(LoginToken)
            .where(LoginToken.user_id == user.id, LoginToken.purpose == "signin",
                   LoginToken.used_at.is_(None))
            .values(used_at=now))
    raw, digest = new_token()
    db.session.add(LoginToken(user_id=user.id, token_hash=digest, purpose="signin",
                              expires_at=now + ttl))
    return f"{current_app.config['BASE_URL']}/api/auth/consume?token={raw}"


def link_roster_members(user: User) -> None:
    """Attach unlinked, active roster rows carrying this user's email, skipping a
    group where the user already has a member row (one per group)."""
    linked_groups = set(db.session.execute(
        db.select(Member.group_id).where(Member.user_id == user.id)).scalars())
    rows = db.session.execute(
        db.select(Member).where(func.lower(Member.email) == user.email,
                                Member.user_id.is_(None), Member.active.is_(True))
        .order_by(Member.id)
    ).scalars()
    for member in rows:
        if member.group_id not in linked_groups:
            member.user_id = user.id
            linked_groups.add(member.group_id)


def admin_exists() -> bool:
    return db.session.execute(
        db.select(Member.id).where(Member.role == "admin").limit(1)).first() is not None


def ensure_admin(email: str, display_name: str) -> User:
    """Get or create the user, the install's group (created when none exists)
    and an admin member row for them. The caller commits."""
    user = get_or_create_user(email, display_name)
    group = db.session.execute(
        db.select(Group).where(Group.is_personal.is_(False)).order_by(Group.id).limit(1)
    ).scalar_one_or_none()
    if group is None:
        group = Group(name=DEFAULT_GROUP_NAME, timezone="UTC")
        db.session.add(group)
        db.session.flush()
    member = db.session.execute(
        db.select(Member).where(Member.group_id == group.id,
                                (Member.user_id == user.id) | (func.lower(Member.email) == email))
        .order_by(Member.id).limit(1)
    ).scalar_one_or_none()
    if member is None:
        db.session.add(Member(group_id=group.id, display_name=user.display_name, email=email,
                              user_id=user.id, role="admin"))
    else:
        member.user_id, member.role, member.active = user.id, "admin", True
    return user


# First-admin setup token. LoginToken.user_id is NOT NULL and there is no user
# yet, so the token is a timestamped signature over a random nonce instead of a
# row. Every worker can verify it (shared SECRET_KEY), it survives restarts
# within its 15 minutes, and it is single-use in effect: redeeming it creates
# the first admin, after which `admin_exists()` refuses every setup token.

def _setup_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=_SETUP_SALT)


def new_setup_token() -> str:
    return _setup_serializer().dumps(secrets.token_urlsafe(16))


def setup_token_valid(token) -> bool:
    if not isinstance(token, str) or not token:
        return False
    try:
        _setup_serializer().loads(token, max_age=int(LINK_TTL.total_seconds()))
    except BadSignature:  # includes SignatureExpired
        return False
    return True


def log_setup_link_if_needed(app) -> None:
    """On start, log a one-time setup link while the install has no admin."""
    with app.app_context():
        try:
            needed = not admin_exists()
        except SQLAlchemyError:
            logger.warning("Could not check for an admin at start-up (is the database "
                           "migrated?); no setup link logged.", exc_info=True)
            return
        finally:
            db.session.remove()
        if needed:
            link = f"{app.config['BASE_URL']}/setup?token={new_setup_token()}"
            logger.warning("No admin yet. Open the app from this machine, or create the "
                           "first admin within 15 minutes: %s", link)
            if app.config.get("SETUP_OPEN"):
                logger.warning("SETUP_OPEN is on: anyone who can reach this app can "
                               "create the first admin.")


DEVICE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I/L
DEVICE_CODE_LENGTH = 8
DEVICE_CODE_TTL = timedelta(days=7)


def new_device_code() -> str:
    return "".join(secrets.choice(DEVICE_CODE_ALPHABET) for _ in range(DEVICE_CODE_LENGTH))


def normalize_device_code(value) -> str | None:
    """Upper-cased, stripped code, or None when it can't be one."""
    if not isinstance(value, str):
        return None
    code = value.strip().upper()
    return code if len(code) == DEVICE_CODE_LENGTH else None
