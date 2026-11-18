"""tasting tables

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-18

Migrations may not import app code, so the CHECK text and category list are
literal copies of ``tasting/models.py`` / ``tasting/enums.py``;
``tests/tasting/test_models.py`` pins them to each other.
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

ADV_CATEGORIES = (
    "aroma", "flavour", "aftertaste", "acidity", "sweetness",
    "bitterness", "weight", "texture", "afterfeel", "balance",
)

_SHEET = "sheet IN ('basic','advanced')"
_VIA = "created_via IN ('account','device','paper')"
_SHAPE_BASIC = (
    "(sheet = 'basic' AND overall IS NOT NULL AND overall BETWEEN 1 AND 5 AND bar_vote IS NULL AND "
    + " AND ".join(f"adv_{c} IS NULL" for c in ADV_CATEGORIES) + ")")
_SHAPE_ADVANCED = (
    "(sheet = 'advanced' AND overall IS NULL AND bar_vote IS NOT NULL AND "
    + " AND ".join(f"adv_{c} IS NOT NULL" for c in ADV_CATEGORIES) + ")")

CHECKS = {
    "ck_tasting_coffee_kind": "kind IN ('house','cupping_lot','external')",
    "ck_tasting_coffee_process":
        "process IS NULL OR process IN ('washed','natural','honey','anaerobic','decaf_ea','other')",
    "ck_tasting_coffee_roast": "roast_level IS NULL OR roast_level IN ('light','medium','med_dark','dark')",
    "ck_tasting_flight_prep": "prep IN ('drip','pourover','espresso','milk_drink','cold_brew','cupping')",
    "ck_tasting_flight_via": _VIA,
    "ck_tasting_flight_sheet": _SHEET,
    "ck_tasting_flight_adv_step":
        "(sheet = 'basic' AND adv_step IS NULL) OR (sheet = 'advanced' AND adv_step IS NOT NULL "
        "AND adv_step IN (0.5, 0.1))",
    "ck_tasting_flight_adv_pass": "adv_pass IS NULL OR adv_pass BETWEEN 0 AND 3",
    "ck_tasting_via": _VIA,
    "ck_tasting_sheet": _SHEET,
    "ck_tasting_bar_vote": "bar_vote IS NULL OR bar_vote IN ('yes','maybe','no')",
    "ck_tasting_sheet_shape": _SHAPE_BASIC + " OR " + _SHAPE_ADVANCED,
    "ck_tasting_acidity": "acidity IS NULL OR acidity BETWEEN 1 AND 5",
    "ck_tasting_sweetness": "sweetness IS NULL OR sweetness BETWEEN 1 AND 5",
    "ck_tasting_body": "body IS NULL OR body BETWEEN 1 AND 5",
    "ck_tasting_balance": "balance IS NULL OR balance BETWEEN 1 AND 5",
    "ck_tasting_tag_strength": "strength IN (2,3)",
    **{f"ck_tasting_adv_{c}":
       f"adv_{c} IS NULL OR adv_{c} = 7.0 OR adv_{c} BETWEEN 7.5 AND 10" for c in ADV_CATEGORIES},
}

# name -> (table, columns, unique, partial predicate or None)
INDEXES = {
    "idx_tasting_coffee_archived_kind": ("tasting_coffees", ("archived_at", "kind"), False, None),
    "ix_tasting_coffees_group_id": ("tasting_coffees", ("group_id",), False, None),
    "idx_tasting_flight_host": ("tasting_flights", ("host_user_id", "opened_at"), False, None),
    "ix_tasting_flights_group_id": ("tasting_flights", ("group_id",), False, None),
    "uq_tasting_flight_coffee_member":
        ("tastings", ("flight_id", "coffee_id", "member_id"), True, "member_id IS NOT NULL"),
    "uq_tasting_flight_coffee_user":
        ("tastings", ("flight_id", "coffee_id", "user_id"), True, "user_id IS NOT NULL"),
    "idx_tasting_coffee": ("tastings", ("coffee_id",), False, None),
    "idx_tasting_flight": ("tastings", ("flight_id",), False, None),
    "idx_tasting_user_date": ("tastings", ("user_id", "created_at"), False, None),
    "ix_tastings_member_id": ("tastings", ("member_id",), False, None),
}


def _check(name: str) -> sa.CheckConstraint:
    return sa.CheckConstraint(CHECKS[name], name=name)


def upgrade() -> None:
    op.create_table(
        "tasting_coffees",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("group_id", sa.Integer, sa.ForeignKey("groups.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("roaster", sa.String(255), nullable=False, server_default=""),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("origin", sa.String(120)),
        sa.Column("region", sa.String(255)),
        sa.Column("variety", sa.String(255)),
        sa.Column("altitude", sa.String(60)),
        sa.Column("lot_code", sa.String(120)),
        sa.Column("process", sa.String(20)),
        sa.Column("roast_level", sa.String(20)),
        sa.Column("notes", sa.Text, nullable=False, server_default=""),
        sa.Column("archived_at", sa.DateTime, nullable=True),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
        _check("ck_tasting_coffee_kind"),
        _check("ck_tasting_coffee_process"),
        _check("ck_tasting_coffee_roast"),
    )
    op.create_table(
        "tasting_flights",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("group_id", sa.Integer, sa.ForeignKey("groups.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("prep", sa.String(20), nullable=False),
        sa.Column("host_member_id", sa.Integer, sa.ForeignKey("members.id", ondelete="SET NULL")),
        sa.Column("host_user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("host_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("is_shared", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("is_blind", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("is_open", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("is_open_link", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_via", sa.String(20), nullable=False, server_default="account"),
        sa.Column("sheet", sa.String(10), nullable=False, server_default="basic"),
        sa.Column("adv_step", sa.Numeric(2, 1), nullable=True),
        sa.Column("timer_started_at", sa.DateTime, nullable=True),
        sa.Column("adv_pass", sa.SmallInteger, nullable=True),
        sa.Column("opened_at", sa.DateTime, nullable=False),
        sa.Column("closes_at", sa.DateTime, nullable=False),
        sa.Column("closed_at", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
        _check("ck_tasting_flight_prep"),
        _check("ck_tasting_flight_via"),
        _check("ck_tasting_flight_sheet"),
        _check("ck_tasting_flight_adv_step"),
        _check("ck_tasting_flight_adv_pass"),
    )
    op.create_table(
        "tasting_flight_coffees",
        sa.Column("flight_id", sa.Integer, sa.ForeignKey("tasting_flights.id", ondelete="CASCADE"),
                  primary_key=True),
        sa.Column("coffee_id", sa.Integer, sa.ForeignKey("tasting_coffees.id", ondelete="RESTRICT"),
                  primary_key=True),
        sa.Column("position", sa.SmallInteger, nullable=False),
        sa.Column("blind_label", sa.String(20), nullable=True),
        sa.UniqueConstraint("flight_id", "position", name="uq_tasting_flight_position"),
    )
    op.create_table(
        "tastings",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("flight_id", sa.Integer, sa.ForeignKey("tasting_flights.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("coffee_id", sa.Integer, sa.ForeignKey("tasting_coffees.id", ondelete="RESTRICT"),
                  nullable=False),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("member_id", sa.Integer, sa.ForeignKey("members.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("taster_key", sa.String(80), nullable=False),
        sa.Column("taster_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("created_via", sa.String(20), nullable=False, server_default="account"),
        sa.Column("sheet", sa.String(10), nullable=False, server_default="basic"),
        sa.Column("entered_by_user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("acidity", sa.SmallInteger),
        sa.Column("sweetness", sa.SmallInteger),
        sa.Column("body", sa.SmallInteger),
        sa.Column("balance", sa.SmallInteger),
        sa.Column("overall", sa.SmallInteger, nullable=True),
        *(sa.Column(f"adv_{c}", sa.Numeric(3, 1)) for c in ADV_CATEGORIES),
        sa.Column("bar_vote", sa.String(5), nullable=True),
        sa.Column("note", sa.Text, nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.UniqueConstraint("flight_id", "coffee_id", "taster_key", name="uq_tasting_flight_coffee_taster"),
        _check("ck_tasting_via"),
        _check("ck_tasting_sheet"),
        _check("ck_tasting_bar_vote"),
        *(_check(f"ck_tasting_adv_{c}") for c in ADV_CATEGORIES),
        _check("ck_tasting_sheet_shape"),
        _check("ck_tasting_acidity"),
        _check("ck_tasting_sweetness"),
        _check("ck_tasting_body"),
        _check("ck_tasting_balance"),
    )
    op.create_table(
        "tasting_tags",
        sa.Column("tasting_id", sa.Integer, sa.ForeignKey("tastings.id", ondelete="CASCADE"),
                  primary_key=True),
        sa.Column("term", sa.String(80), primary_key=True),
        sa.Column("strength", sa.SmallInteger, nullable=False, server_default="2"),
        _check("ck_tasting_tag_strength"),
    )
    op.create_table(
        "tasting_defects",
        sa.Column("tasting_id", sa.Integer, sa.ForeignKey("tastings.id", ondelete="CASCADE"),
                  primary_key=True),
        sa.Column("term", sa.String(80), primary_key=True),
    )
    for name, (table, columns, unique, where) in INDEXES.items():
        kwargs = {}
        if where:
            kwargs = {"sqlite_where": sa.text(where), "postgresql_where": sa.text(where)}
        op.create_index(name, table, list(columns), unique=unique, **kwargs)


def downgrade() -> None:
    for name, (table, *_rest) in INDEXES.items():
        op.drop_index(name, table_name=table)
    op.drop_table("tasting_defects")
    op.drop_table("tasting_tags")
    op.drop_table("tastings")
    op.drop_table("tasting_flight_coffees")
    op.drop_table("tasting_flights")
    op.drop_table("tasting_coffees")
