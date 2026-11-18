"""index tasting_flights on the hosting member

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-18

"My flights" (``GET /api/tasting/flights/recent``) finds the flights a person
hosted by ``host_member_id`` as well as ``host_user_id``: a shared device hosts
with the picked member and no user, and those flights belong to that member's
account too. ``idx_tasting_flight_host`` only covers ``host_user_id``.
"""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

# Pinned to the model by tests/tasting/test_models.py (with 0002's INDEXES).
INDEXES = {
    "idx_tasting_flight_host_member": ("tasting_flights", ("host_member_id", "opened_at"), False, None),
}


def upgrade() -> None:
    for name, (table, columns, unique, _where) in INDEXES.items():
        op.create_index(name, table, list(columns), unique=unique)


def downgrade() -> None:
    for name, (table, _columns, _unique, _where) in INDEXES.items():
        op.drop_index(name, table_name=table)
