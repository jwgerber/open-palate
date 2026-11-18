"""Identity tables: users, groups, members, sign-in tokens, sessions, device codes.

All datetimes are naive UTC (see ``utils.utc_now``). The schema is owned by the
Alembic chain in ``migrations/``; keep the two in step.
"""
import sqlalchemy as sa
from sqlalchemy.orm import validates

from extensions import db
from utils import utc_now


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(320), nullable=False, unique=True)
    display_name = db.Column(db.String(120), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    last_login_at = db.Column(db.DateTime)

    @validates("email")
    def _normalize_email(self, _key, value: str) -> str:
        return value.strip().lower()


class Group(db.Model):
    __tablename__ = "groups"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    timezone = db.Column(db.String(64), nullable=False, default="UTC", server_default="UTC")
    is_personal = db.Column(db.Boolean, nullable=False, default=False, server_default=sa.false())
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)


class Member(db.Model):
    __tablename__ = "members"
    __table_args__ = (
        sa.CheckConstraint("role IN ('admin','editor','member')", name="ck_members_role"),
        sa.UniqueConstraint("group_id", "user_id", name="uq_members_group_user"),
        sa.Index(
            "uq_members_group_lower_email",
            "group_id",
            sa.text("lower(email)"),
            unique=True,
            sqlite_where=sa.text("email IS NOT NULL"),
            postgresql_where=sa.text("email IS NOT NULL"),
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey("groups.id"), nullable=False)
    display_name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(320))
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    role = db.Column(db.String(10), nullable=False)
    active = db.Column(db.Boolean, nullable=False, default=True, server_default=sa.true())
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)


class LoginToken(db.Model):
    __tablename__ = "login_tokens"
    __table_args__ = (
        sa.CheckConstraint("purpose IN ('signin','setup')", name="ck_login_tokens_purpose"),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    token_hash = db.Column(db.String(64), nullable=False, unique=True)
    purpose = db.Column(db.String(10), nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    used_at = db.Column(db.DateTime)


class Session(db.Model):
    __tablename__ = "sessions"
    __table_args__ = (
        sa.CheckConstraint("kind IN ('user','device')", name="ck_sessions_kind"),
        sa.CheckConstraint(
            "(kind = 'user' AND user_id IS NOT NULL AND device_group_id IS NULL) "
            "OR (kind = 'device' AND device_group_id IS NOT NULL AND user_id IS NULL)",
            name="ck_sessions_kind_shape",
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    device_group_id = db.Column(db.Integer, db.ForeignKey("groups.id"))
    device_code_id = db.Column(db.Integer, db.ForeignKey("device_codes.id"), index=True)
    token_hash = db.Column(db.String(64), nullable=False, unique=True)
    kind = db.Column(db.String(10), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    last_seen_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    expires_at = db.Column(db.DateTime, nullable=False)
    revoked_at = db.Column(db.DateTime)


class DeviceCode(db.Model):
    __tablename__ = "device_codes"

    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey("groups.id"), nullable=False)
    code_hash = db.Column(db.String(64), nullable=False, unique=True)
    created_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    used_at = db.Column(db.DateTime)
    revoked_at = db.Column(db.DateTime)
