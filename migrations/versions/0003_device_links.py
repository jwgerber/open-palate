"""device code single-use marker and device-session link

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-18

``device_codes.used_at`` marks single use without touching ``revoked_at`` (a used
code must stay revocable). ``sessions.device_code_id`` lets revoking a code end
every device session it created.
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("device_codes") as batch:
        batch.add_column(sa.Column("used_at", sa.DateTime(), nullable=True))
    with op.batch_alter_table("sessions") as batch:
        batch.add_column(sa.Column("device_code_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_sessions_device_code", "device_codes",
                                 ["device_code_id"], ["id"])
        batch.create_index("ix_sessions_device_code_id", ["device_code_id"])


def downgrade() -> None:
    with op.batch_alter_table("sessions") as batch:
        batch.drop_index("ix_sessions_device_code_id")
        batch.drop_constraint("fk_sessions_device_code", type_="foreignkey")
        batch.drop_column("device_code_id")
    with op.batch_alter_table("device_codes") as batch:
        batch.drop_column("used_at")
