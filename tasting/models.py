"""Tasting tables: coffees, flights, tastings, tags, defects.

A FLIGHT is the container: N coffees presented together in pour order, tasted by
one or more people. A solo entry is a flight of one. A TASTING is one person's
read of one coffee within one flight. Tags and defects hang off the tasting as
lexicon path keys; the lexicon itself is content, not a table.

Everything is scoped to a group: coffees and flights carry ``group_id``; a
tasting gets its group through its flight.

Identity: ``taster_key`` is one of ``user:<id>``, ``member:<id>``,
``paper:member:<id>`` or ``paper:name:<name>``. It drives the per-flight
uniqueness and the "tasted by me" filter. ``created_via`` records which door
asserted the identity. A person's palate counts every door: rows with their
``user_id`` or one of their ``member_id`` rows in the group (``tasting/palate.py``).

Two score sheets, chosen per flight (``sheet``, copied onto each tasting).
``basic``: scales are 1-5; an untouched slider is NULL, never the midpoint, and
``overall`` is the only required score. ``advanced``: ten ``adv_<category>``
scores, each 7.0 (disqualifying) or 7.5-10, plus a bar vote; ``overall`` is
NULL. ``ck_tasting_sheet_shape`` keeps the two shapes from mixing.

The schema is owned by ``migrations/versions/0002_tasting.py``; keep the two in
step (tests pin the CHECK text).
"""
import sqlalchemy as sa
from sqlalchemy import CheckConstraint, Index, UniqueConstraint, text

from extensions import db
from tasting.enums import (ADV_CATEGORIES, ADV_DQ_VALUE, ADV_STEPS, BAR_VOTES,
                           COFFEE_KINDS, CREATED_VIA, PREPS, PROCESSES, ROASTS,
                           SHEETS, TAG_STRENGTHS)
from utils import utc_now


def _in_list(values):
    return "(" + ",".join(f"'{v}'" for v in values) + ")"


def _adv_score_check(cat):
    col = f"adv_{cat}"
    return f"{col} IS NULL OR {col} = {ADV_DQ_VALUE} OR {col} BETWEEN 7.5 AND 10"


_SHEET_SHAPE_CHECK = (
    "(sheet = 'basic' AND overall IS NOT NULL AND overall BETWEEN 1 AND 5 AND bar_vote IS NULL"
    " AND " + " AND ".join(f"adv_{c} IS NULL" for c in ADV_CATEGORIES) + ")"
    " OR (sheet = 'advanced' AND overall IS NULL AND bar_vote IS NOT NULL"
    " AND " + " AND ".join(f"adv_{c} IS NOT NULL" for c in ADV_CATEGORIES) + ")")


class TastingCoffee(db.Model):
    """A coffee that can be tasted. Uniqueness is deliberately NOT a DB
    constraint: the picker fuzzy-matches instead."""
    __tablename__ = "tasting_coffees"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    group_id = db.Column(db.Integer, db.ForeignKey("groups.id"), nullable=False)
    name = db.Column(db.String(255), nullable=False)
    roaster = db.Column(db.String(255), nullable=False, default="", server_default="")
    kind = db.Column(db.String(20), nullable=False)

    origin = db.Column(db.String(120))
    region = db.Column(db.String(255))
    variety = db.Column(db.String(255))
    altitude = db.Column(db.String(60))
    lot_code = db.Column(db.String(120))
    process = db.Column(db.String(20))
    roast_level = db.Column(db.String(20))
    # Roaster's notes: what's on the bag, not the tasting.
    notes = db.Column(db.Text, nullable=False, default="", server_default="")

    archived_at = db.Column(db.DateTime, nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    updated_at = db.Column(db.DateTime, nullable=False, default=utc_now, onupdate=utc_now)

    __table_args__ = (
        CheckConstraint("kind IN " + _in_list(COFFEE_KINDS), name="ck_tasting_coffee_kind"),
        CheckConstraint("process IS NULL OR process IN " + _in_list(PROCESSES),
                        name="ck_tasting_coffee_process"),
        CheckConstraint("roast_level IS NULL OR roast_level IN " + _in_list(ROASTS),
                        name="ck_tasting_coffee_roast"),
        # archived_at leads: every query filters `archived_at IS NULL`; kind is only
        # ever filtered in Python after the fetch.
        Index("idx_tasting_coffee_archived_kind", "archived_at", "kind"),
        Index("ix_tasting_coffees_group_id", "group_id"),
    )

    @property
    def is_archived(self):
        return self.archived_at is not None

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "roaster": self.roaster,
            "kind": self.kind,
            "origin": self.origin,
            "region": self.region,
            "variety": self.variety,
            "altitude": self.altitude,
            "lot_code": self.lot_code,
            "process": self.process,
            "roast_level": self.roast_level,
            "notes": self.notes,
            "archived_at": self.archived_at.isoformat() if self.archived_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class TastingFlight(db.Model):
    """A sitting. Open while tasters may still log; the reveal waits for
    `is_open = false`. Solo flights are created closed; shared flights close
    when the host closes them or after 24h (`closes_at`)."""
    __tablename__ = "tasting_flights"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    group_id = db.Column(db.Integer, db.ForeignKey("groups.id"), nullable=False)
    name = db.Column(db.String(255), nullable=True)
    prep = db.Column(db.String(20), nullable=False)

    host_member_id = db.Column(db.Integer, db.ForeignKey("members.id", ondelete="SET NULL"))
    host_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    host_name = db.Column(db.String(120), nullable=False, default="", server_default="")

    is_shared = db.Column(db.Boolean, nullable=False, default=False, server_default=sa.false())
    is_blind = db.Column(db.Boolean, nullable=False, default=False, server_default=sa.false())
    is_open = db.Column(db.Boolean, nullable=False, default=True, server_default=sa.true())
    # Open-link joining arrives in Phase 2; unused until then.
    is_open_link = db.Column(db.Boolean, nullable=False, default=False, server_default=sa.false())
    created_via = db.Column(db.String(20), nullable=False, default="account", server_default="account")
    sheet = db.Column(db.String(10), nullable=False, default="basic", server_default="basic")
    # Advanced slider resolution: 0.5 coarse or 0.1 fine; NULL exactly when sheet is basic.
    adv_step = db.Column(db.Numeric(2, 1), nullable=True)
    timer_started_at = db.Column(db.DateTime, nullable=True)   # unused for now
    adv_pass = db.Column(db.SmallInteger, nullable=True)       # unused for now

    opened_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    # No default on purpose: a shared flight closes opened_at + 24h, a solo one
    # at opened_at. Omitting it must raise, not create an instantly-expired flight.
    closes_at = db.Column(db.DateTime, nullable=False)
    closed_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    coffees = db.relationship("TastingFlightCoffee", cascade="all, delete-orphan",
                              order_by="TastingFlightCoffee.position", back_populates="flight")
    tastings = db.relationship("Tasting", cascade="all, delete-orphan", back_populates="flight")

    __table_args__ = (
        CheckConstraint("prep IN " + _in_list(PREPS), name="ck_tasting_flight_prep"),
        CheckConstraint("created_via IN " + _in_list(CREATED_VIA), name="ck_tasting_flight_via"),
        CheckConstraint("sheet IN " + _in_list(SHEETS), name="ck_tasting_flight_sheet"),
        CheckConstraint("(sheet = 'basic' AND adv_step IS NULL)"
                        " OR (sheet = 'advanced' AND adv_step IS NOT NULL AND adv_step IN ("
                        + ", ".join(str(s) for s in ADV_STEPS) + "))", name="ck_tasting_flight_adv_step"),
        CheckConstraint("adv_pass IS NULL OR adv_pass BETWEEN 0 AND 3", name="ck_tasting_flight_adv_pass"),
        Index("idx_tasting_flight_host", "host_user_id", "opened_at"),
        # migration 0004: "my flights" for a member who hosted from a shared device
        Index("idx_tasting_flight_host_member", "host_member_id", "opened_at"),
        Index("ix_tasting_flights_group_id", "group_id"),
    )


class TastingFlightCoffee(db.Model):
    """A coffee's slot in a flight. `position` is pour order (1-based)."""
    __tablename__ = "tasting_flight_coffees"

    flight_id = db.Column(db.Integer, db.ForeignKey("tasting_flights.id", ondelete="CASCADE"),
                          primary_key=True)
    # RESTRICT, not CASCADE: a coffee with history is archived, never deleted;
    # the accumulated reads are the point.
    coffee_id = db.Column(db.Integer, db.ForeignKey("tasting_coffees.id", ondelete="RESTRICT"),
                          primary_key=True)
    position = db.Column(db.SmallInteger, nullable=False)
    blind_label = db.Column(db.String(20), nullable=True)

    flight = db.relationship("TastingFlight", back_populates="coffees")
    coffee = db.relationship("TastingCoffee")

    __table_args__ = (
        UniqueConstraint("flight_id", "position", name="uq_tasting_flight_position"),
    )


class Tasting(db.Model):
    """One person's impression of one coffee within one flight."""
    __tablename__ = "tastings"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    flight_id = db.Column(db.Integer, db.ForeignKey("tasting_flights.id", ondelete="CASCADE"),
                          nullable=False)
    coffee_id = db.Column(db.Integer, db.ForeignKey("tasting_coffees.id", ondelete="RESTRICT"),
                          nullable=False)

    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    member_id = db.Column(db.Integer, db.ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    taster_key = db.Column(db.String(80), nullable=False)
    taster_name = db.Column(db.String(120), nullable=False, default="", server_default="")
    created_via = db.Column(db.String(20), nullable=False, default="account", server_default="account")
    sheet = db.Column(db.String(10), nullable=False, default="basic", server_default="basic")
    # The account that keyed in someone else's paper sheet; unused for now.
    entered_by_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"),
                                   nullable=True)

    # Basic sheet: intensity (acidity/sweetness/body) and judgment (balance/overall),
    # all 1-5. `overall` is required on a basic read and NULL on an advanced one.
    acidity = db.Column(db.SmallInteger)
    sweetness = db.Column(db.SmallInteger)
    body = db.Column(db.SmallInteger)
    balance = db.Column(db.SmallInteger)
    overall = db.Column(db.SmallInteger, nullable=True)

    # Advanced sheet: all ten set on an advanced read, all NULL on a basic one.
    adv_aroma = db.Column(db.Numeric(3, 1))
    adv_flavour = db.Column(db.Numeric(3, 1))
    adv_aftertaste = db.Column(db.Numeric(3, 1))
    adv_acidity = db.Column(db.Numeric(3, 1))
    adv_sweetness = db.Column(db.Numeric(3, 1))
    adv_bitterness = db.Column(db.Numeric(3, 1))
    adv_weight = db.Column(db.Numeric(3, 1))
    adv_texture = db.Column(db.Numeric(3, 1))
    adv_afterfeel = db.Column(db.Numeric(3, 1))
    adv_balance = db.Column(db.Numeric(3, 1))
    bar_vote = db.Column(db.String(5), nullable=True)

    note = db.Column(db.Text, nullable=False, default="", server_default="")
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    flight = db.relationship("TastingFlight", back_populates="tastings")
    coffee = db.relationship("TastingCoffee")
    tags = db.relationship("TastingTag", cascade="all, delete-orphan", order_by="TastingTag.term")
    defects = db.relationship("TastingDefect", cascade="all, delete-orphan", order_by="TastingDefect.term")

    __table_args__ = (
        UniqueConstraint("flight_id", "coffee_id", "taster_key", name="uq_tasting_flight_coffee_taster"),
        # One human, several doors: the same person logging on the tablet
        # (member:<id>) and on their phone (user:<id>) carries the same member_id
        # (or user_id) and must still be ONE read per cup. Partial so a taster
        # with neither keeps taster_key as the sole key.
        Index("uq_tasting_flight_coffee_member", "flight_id", "coffee_id", "member_id",
              unique=True,
              postgresql_where=text("member_id IS NOT NULL"),
              sqlite_where=text("member_id IS NOT NULL")),
        Index("uq_tasting_flight_coffee_user", "flight_id", "coffee_id", "user_id",
              unique=True,
              postgresql_where=text("user_id IS NOT NULL"),
              sqlite_where=text("user_id IS NOT NULL")),
        CheckConstraint("created_via IN " + _in_list(CREATED_VIA), name="ck_tasting_via"),
        CheckConstraint("sheet IN " + _in_list(SHEETS), name="ck_tasting_sheet"),
        CheckConstraint("bar_vote IS NULL OR bar_vote IN " + _in_list(BAR_VOTES), name="ck_tasting_bar_vote"),
        *(CheckConstraint(_adv_score_check(c), name=f"ck_tasting_adv_{c}") for c in ADV_CATEGORIES),
        CheckConstraint(_SHEET_SHAPE_CHECK, name="ck_tasting_sheet_shape"),
        CheckConstraint("acidity IS NULL OR acidity BETWEEN 1 AND 5", name="ck_tasting_acidity"),
        CheckConstraint("sweetness IS NULL OR sweetness BETWEEN 1 AND 5", name="ck_tasting_sweetness"),
        CheckConstraint("body IS NULL OR body BETWEEN 1 AND 5", name="ck_tasting_body"),
        CheckConstraint("balance IS NULL OR balance BETWEEN 1 AND 5", name="ck_tasting_balance"),
        Index("idx_tasting_coffee", "coffee_id"),
        Index("idx_tasting_flight", "flight_id"),
        Index("idx_tasting_user_date", "user_id", "created_at"),
        Index("ix_tastings_member_id", "member_id"),
    )

    def vals(self):
        return {
            "acidity": self.acidity, "sweetness": self.sweetness, "body": self.body,
            "balance": self.balance, "overall": self.overall,
        }

    def adv_scores(self) -> dict[str, float | None]:
        """Advanced scores keyed by category, in sheet order, as floats (None on a basic read)."""
        out = {}
        for cat in ADV_CATEGORIES:
            v = getattr(self, f"adv_{cat}")
            out[cat] = None if v is None else float(v)
        return out

    def adv_total(self) -> float | None:
        """Sum of the ten advanced scores; None for a basic read."""
        if self.sheet != "advanced":
            return None
        scores = self.adv_scores().values()
        if any(v is None for v in scores):
            return None
        return round(sum(scores), 1)

    def adv_dq_categories(self) -> list[str]:
        """Categories scored at the disqualifying 7.0, in sheet order."""
        return [cat for cat, v in self.adv_scores().items() if v == ADV_DQ_VALUE]


class TastingTag(db.Model):
    """A lexicon term on a tasting. `term` is a path key, `strength` 2 = picked,
    3 = strong. At most 5 per tasting (enforced in the repository)."""
    __tablename__ = "tasting_tags"

    tasting_id = db.Column(db.Integer, db.ForeignKey("tastings.id", ondelete="CASCADE"),
                           primary_key=True)
    term = db.Column(db.String(80), primary_key=True)
    strength = db.Column(db.SmallInteger, nullable=False, default=2, server_default="2")

    __table_args__ = (
        CheckConstraint("strength IN (" + ",".join(str(s) for s in TAG_STRENGTHS) + ")",
                        name="ck_tasting_tag_strength"),
    )


class TastingDefect(db.Model):
    """A cupping fault on a tasting: its own column, outside the tag cap and
    outside consensus descriptors."""
    __tablename__ = "tasting_defects"

    tasting_id = db.Column(db.Integer, db.ForeignKey("tastings.id", ondelete="CASCADE"),
                           primary_key=True)
    term = db.Column(db.String(80), primary_key=True)
