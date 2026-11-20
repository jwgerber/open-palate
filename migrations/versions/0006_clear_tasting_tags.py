"""clear saved flavor notes for the 2020 wheel

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-20

The lexicon moved to the 2020 wheel (spec 2026-11-20), so every
saved key (``Fruity>Berry>blueberry``) lost its meaning. There was no real data,
so the notes are deleted rather than translated. Downgrade does nothing: the
deleted notes cannot be restored.
"""
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DELETE FROM tasting_tags")


def downgrade() -> None:
    pass
