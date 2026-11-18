"""Fixed vocabularies the tables' CHECK constraints are built from.

Kept in code, not content files: they are column domains (spec: fixed columns).
The word lists shown to people (labels, wheel terms) live in ``content/``.
"""
PREPS = ("drip", "pourover", "espresso", "milk_drink", "cold_brew", "cupping")
COFFEE_KINDS = ("house", "cupping_lot", "external")
PROCESSES = ("washed", "natural", "honey", "anaerobic", "decaf_ea", "other")
ROASTS = ("light", "medium", "med_dark", "dark")

# "basic" is the 1-5 sheet; "advanced" scores ten categories on a 7.5-10 scale
# (7.0 = disqualified).
SHEETS = ("basic", "advanced")
ADV_CATEGORIES = (
    "aroma", "flavour", "aftertaste", "acidity", "sweetness",
    "bitterness", "weight", "texture", "afterfeel", "balance",
)
ADV_STEPS = (0.5, 0.1)       # slider resolution: coarse, then fine
ADV_DQ_VALUE = 7.0

BAR_VOTES = ("yes", "maybe", "no")
TAG_STRENGTHS = (2, 3)       # 2 = picked, 3 = strong

# Who asserted the identity on a read: a signed-in account, the shared
# tablet, or a manager keying in a paper sheet.
CREATED_VIA = ("account", "kiosk", "paper")
