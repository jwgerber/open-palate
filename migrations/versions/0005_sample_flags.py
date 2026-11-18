"""sample-data flag on members, coffees and flights

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-18

``is_sample`` marks the rows the "load sample data" action creates so they can
be hidden from pickers and removed together. Existing rows read false.
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

TABLES = ("members", "tasting_coffees", "tasting_flights")
# recreate="never": SQLite's table copy cannot reflect members' functional partial
# unique index (uq_members_group_lower_email) and would silently drop it. Plain
# ALTER TABLE ADD/DROP COLUMN is enough for a not-null column with a default.


def upgrade() -> None:
    for table in TABLES:
        with op.batch_alter_table(table, recreate="never") as batch:
            batch.add_column(sa.Column("is_sample", sa.Boolean(), nullable=False,
                                       server_default=sa.false()))


def downgrade() -> None:
    for table in TABLES:
        with op.batch_alter_table(table, recreate="never") as batch:
            batch.drop_column("is_sample")
