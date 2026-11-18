"""Content as data: the lexicon and the score-sheet wording.

Terms are stored on ``tasting_tags.term`` as PATH KEYS (``"Fruity>Berry>blueberry"``),
not bare labels, because the wheel repeats labels at different depths
(``Floral > Floral``).
"""
import json
import re
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from tasting import content
from tasting.content import CONTENT_DIR
from tasting.enums import ADV_CATEGORIES, COFFEE_KINDS, PREPS, PROCESSES, ROASTS

SEP = ">"
ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def lex():
    return content.load()


class TestTreeShape:
    def test_nine_families_in_wheel_order(self, lex):
        assert [n["label"] for n in lex.lexicon["tree"]] == [
            "Fruity", "Floral", "Sweet", "Nutty / Cocoa", "Spices", "Roasted",
            "Sour / Fermented", "Green / Vegetative", "Other",
        ]

    def test_term_count_matches_the_2016_lexicon(self, lex):
        tiers = {}
        for info in lex.term_index.values():
            tiers[info["tier"]] = tiers.get(info["tier"], 0) + 1
        assert tiers == {1: 9, 2: 28, 3: 73}
        assert len(lex.term_index) == 110

    def test_keys_are_unique_even_where_labels_repeat(self, lex):
        floral_keys = [k for k, v in lex.term_index.items() if v["label"] == "Floral"]
        assert sorted(floral_keys) == ["Floral", f"Floral{SEP}Floral"]
        assert lex.term_index["Floral"]["tier"] == 1
        assert lex.term_index[f"Floral{SEP}Floral"]["tier"] == 2

    def test_every_family_has_a_hex_and_a_tint(self, lex):
        fams = {v["family"] for v in lex.term_index.values()}
        assert fams == set(lex.lexicon["families"])
        assert lex.lexicon["families"]["fruity"] == {"hex": "#DA1D23", "tint": "#F5C6C7"}

    def test_leaf_and_heading_flags(self, lex):
        assert lex.term_index[f"Fruity{SEP}Berry{SEP}blueberry"] == {
            "label": "blueberry", "family": "fruity", "tier": 3, "leaf": True,
            "path": ["Fruity", "Berry", "blueberry"],
        }
        assert lex.term_index["Fruity"]["leaf"] is False
        assert lex.term_index[f"Sweet{SEP}Vanilla"]["leaf"] is True


class TestHelpers:
    def test_ancestors_of(self, lex):
        assert lex.ancestors_of(f"Fruity{SEP}Berry{SEP}blueberry") == ["Fruity", f"Fruity{SEP}Berry"]
        assert lex.ancestors_of("Fruity") == []

    def test_family_and_label(self, lex):
        assert lex.family_of(f"Other{SEP}Chemical{SEP}rubber") == "other"
        assert lex.label_of(f"Other{SEP}Chemical{SEP}rubber") == "rubber"

    def test_is_valid_term(self, lex):
        assert lex.is_valid_term("Fruity")
        assert lex.is_valid_term(f"Roasted{SEP}Burnt{SEP}smoky")
        assert not lex.is_valid_term("blueberry")            # bare labels are NOT keys
        assert not lex.is_valid_term("Fruity>Berry>durian")
        assert not lex.is_valid_term(None)

    def test_defects_and_scales(self, lex):
        assert len(lex.defects) == 16 and "papery" in lex.defects and "quakery" in lex.defects
        assert lex.attributes == ("acidity", "sweetness", "body", "balance", "overall")
        words = lex.forms["basic"]["scale_words"]
        assert all(len(words[a]) == 5 for a in lex.attributes)
        assert words["overall"][0] == "wouldn't finish it"
        assert lex.scale_word("acidity", 3.4) == "bright"

    def test_load_is_cached(self):
        assert content.load() is content.load()


class TestEnumLabels:
    """The enums are column domains in code; the content files only label them."""

    @pytest.mark.parametrize("section, enum", [
        ("preps", PREPS), ("kinds", COFFEE_KINDS), ("processes", PROCESSES), ("roasts", ROASTS)])
    def test_labels_cover_exactly_the_enum(self, lex, section, enum):
        assert tuple(lex.lexicon[section]) == enum


class TestAdvancedSheetWording:
    def test_categories_match_the_columns(self, lex):
        adv = lex.forms["advanced"]
        assert tuple(adv["categories"]) == ADV_CATEGORIES
        assert tuple(c for g in adv["groups"] for c in g["categories"]) == ADV_CATEGORIES

    def test_guidance_is_short(self, lex):
        for cat, text in lex.forms["advanced"]["categories"].items():
            for key in ("label", "plus", "minus", "dq"):
                assert text[key] and len(text[key]) <= 140, (cat, key)

    def test_votes_labelled(self, lex):
        assert set(lex.forms["advanced"]["votes"]) == {"yes", "maybe", "no"}


def _schema(name):
    return json.loads((CONTENT_DIR / "schema" / name).read_text(encoding="utf-8"))


@pytest.mark.parametrize("data_file, schema_file", [
    ("lexicon.json", "lexicon.schema.json"), ("forms.json", "forms.schema.json")])
def test_content_files_match_schema(data_file, schema_file):
    schema = _schema(schema_file)
    Draft202012Validator.check_schema(schema)
    data = json.loads((CONTENT_DIR / data_file).read_text(encoding="utf-8"))
    errors = sorted(Draft202012Validator(schema).iter_errors(data), key=lambda e: list(e.path))
    assert errors == [], [e.message for e in errors[:3]]


def test_schema_rejects_a_bad_file():
    schema = _schema("lexicon.schema.json")
    data = json.loads((CONTENT_DIR / "lexicon.json").read_text(encoding="utf-8"))
    data["tree"][0]["label"] = "Fruit>y"          # a label may not contain the key separator
    del data["families"]["fruity"]["tint"]
    messages = [e.message for e in Draft202012Validator(schema).iter_errors(data)]
    assert len(messages) >= 2


BRAND = re.compile(r"barista\s*hustle|\bBH\b|\bbh_", re.IGNORECASE)


def test_content_has_no_brand_strings():
    files = [p for p in CONTENT_DIR.rglob("*") if p.is_file()]
    assert files, "content directory is empty"
    for path in files:
        assert not BRAND.search(path.read_text(encoding="utf-8")), path


def test_source_has_no_brand_or_shop_strings():
    pattern = re.compile(r"barista\s*hustle|\bBH\b|\bbh_|\b1369\b|Inman|Kelley", re.IGNORECASE)
    for path in list((ROOT / "tasting").glob("*.py")) + list((ROOT / "content").rglob("*.json")):
        assert not pattern.search(path.read_text(encoding="utf-8")), path
