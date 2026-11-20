"""owner flag, install settings, personal-group owner

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-20

Adds ``users.is_owner``, ``groups.personal_user_id`` (with a check tying it to
``is_personal`` and a partial unique index) and the single-row
``install_settings`` table. The upgrade names the install's owner: the earliest
active admin member (with a user) of the lowest-id non-personal group.
"""
import logging

from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

CHECK_NAME = "ck_groups_personal_user"
CHECK_SQL = ("(is_personal AND personal_user_id IS NOT NULL) OR "
             "(NOT is_personal AND personal_user_id IS NULL)")


def _pick_owner(bind):
    """Return (member_id, user_id) of the chosen owner, or None."""
    base = ("SELECT m.id, m.user_id FROM members m JOIN groups g ON g.id = m.group_id "
            "WHERE m.role = 'admin' AND m.active AND m.user_id IS NOT NULL AND NOT g.is_personal ")
    order = "ORDER BY m.created_at, m.id LIMIT 1"
    lowest_group = bind.execute(sa.text(
        "SELECT MIN(id) FROM groups WHERE NOT is_personal")).scalar()
    if lowest_group is not None:
        row = bind.execute(sa.text(base + "AND g.id = :gid " + order), {"gid": lowest_group}).first()
        if row:
            return row
    return bind.execute(sa.text(base + order)).first()


def upgrade() -> None:
    # recreate="never": a table copy would drop users' other constraints needlessly.
    with op.batch_alter_table("users", recreate="never") as batch:
        batch.add_column(sa.Column("is_owner", sa.Boolean(), nullable=False,
                                   server_default=sa.false()))
    # Default recreate: SQLite can only add a CHECK by copying the table. Safe because
    # SQLite connections here do not enable PRAGMA foreign_keys.
    with op.batch_alter_table("groups") as batch:
        batch.add_column(sa.Column("personal_user_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_groups_personal_user_id", "users",
                                 ["personal_user_id"], ["id"])
        batch.create_check_constraint(CHECK_NAME, CHECK_SQL)
    # After the batch block, so a table recreate cannot drop the partial index.
    op.create_index("uq_groups_personal_user", "groups", ["personal_user_id"], unique=True,
                    sqlite_where=sa.text("personal_user_id IS NOT NULL"),
                    postgresql_where=sa.text("personal_user_id IS NOT NULL"))

    settings = op.create_table(
        "install_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("public_url", sa.String(255), nullable=True),
        sa.CheckConstraint("id = 1", name="ck_install_settings_singleton"),
    )
    op.bulk_insert(settings, [{"id": 1, "public_url": None}])

    bind = op.get_bind()
    chosen = _pick_owner(bind)
    if chosen:
        member_id, user_id = chosen
        bind.execute(sa.text("UPDATE users SET is_owner = :yes WHERE id = :uid"),
                     {"yes": True, "uid": user_id})
        log.info("0007: owner is user %s (member %s)", user_id, member_id)
    else:
        log.info("0007: no admin member with a user; no owner set")


def downgrade() -> None:
    op.drop_table("install_settings")
    op.drop_index("uq_groups_personal_user", table_name="groups")
    with op.batch_alter_table("groups") as batch:
        batch.drop_constraint(CHECK_NAME, type_="check")
        batch.drop_constraint("fk_groups_personal_user_id", type_="foreignkey")
        batch.drop_column("personal_user_id")
    with op.batch_alter_table("users", recreate="never") as batch:
        batch.drop_column("is_owner")
