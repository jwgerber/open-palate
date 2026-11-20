"""Content as data: the lexicon and the score-sheet wording.

Terms are stored on ``tasting_tags.term`` as PATH KEYS (``"Fruit>Berry>blueberry"``),
not bare labels, so a key always says where on the wheel a note sits.
"""
import hashlib
import json
import re
import subprocess
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


FAMILIES = ["Fruit", "Chocolate", "Sweet & Sugary", "Nut", "Grain & Cereal",
            "Roast", "Spice", "Savory", "Vegetal / Earthy / Herb", "Floral"]
SLUGS = {"fruit", "chocolate", "sweet", "nut", "grain", "roast", "spice", "savory",
         "vegetal", "floral"}


class TestTreeShape:
    """The 2020 wheel credited in the README, word for word (spec 2026-11-20)."""

    def test_ten_families_in_wheel_order(self, lex):
        assert [n["label"] for n in lex.lexicon["tree"]] == FAMILIES

    def test_term_counts_match_the_2020_wheel(self, lex):
        tiers = {}
        for info in lex.term_index.values():
            tiers[info["tier"]] = tiers.get(info["tier"], 0) + 1
        assert tiers == {1: 10, 2: 89, 3: 43}
        assert sum(1 for v in lex.term_index.values() if v["leaf"]) == 124

    def test_fruit_groups_in_order(self, lex):
        fruit = lex.lexicon["tree"][0]
        assert [g["label"] for g in fruit["children"]] == [
            "Citrus", "Apple / Pear", "Melon", "Grape", "Tropical Fruit",
            "Stone Fruit", "Berry", "Dried Fruit"]

    def test_leaf_and_heading_flags(self, lex):
        assert lex.term_index[f"Fruit{SEP}Berry{SEP}blueberry"] == {
            "label": "blueberry", "family": "fruit", "tier": 3, "leaf": True,
            "path": ["Fruit", "Berry", "blueberry"],
        }
        assert lex.term_index[f"Nut{SEP}hazelnut"]["tier"] == 2
        assert lex.term_index[f"Nut{SEP}hazelnut"]["leaf"] is True
        assert lex.term_index["Fruit"]["leaf"] is False

    def test_group_key_is_a_term(self, lex):
        assert lex.is_valid_term(f"Fruit{SEP}Citrus")

    def test_slash_and_apostrophe_terms_round_trip(self, lex):
        for key in (f"Spice{SEP}licorice / anise", f"Chocolate{SEP}baker's chocolate",
                    f"Floral{SEP}rose / rosewater"):
            assert lex.is_valid_term(key) and len(key) <= 80

    def test_families_have_slugs_hex_and_tint(self, lex):
        assert set(lex.lexicon["families"]) == SLUGS
        assert {v["family"] for v in lex.term_index.values()} == SLUGS
        assert all({"hex", "tint"} <= set(v) for v in lex.lexicon["families"].values())

    def test_no_old_wheel_jargon(self, lex):
        labels = {v["label"] for v in lex.term_index.values()}
        assert not labels & {"butyric acid", "vanillin", "Overall sweet", "Other fruit"}

    def test_labels_never_repeat(self, lex):
        labels = [v["label"].lower() for v in lex.term_index.values()]
        assert len(labels) == len(set(labels))


class TestHelpers:
    def test_ancestors_of(self, lex):
        assert lex.ancestors_of(f"Fruit{SEP}Berry{SEP}blueberry") == ["Fruit", f"Fruit{SEP}Berry"]
        assert lex.ancestors_of("Fruit") == []

    def test_family_and_label(self, lex):
        assert lex.family_of(f"Vegetal / Earthy / Herb{SEP}cedar") == "vegetal"
        assert lex.label_of(f"Vegetal / Earthy / Herb{SEP}cedar") == "cedar"

    def test_is_valid_term(self, lex):
        assert lex.is_valid_term("Fruit")
        assert lex.is_valid_term(f"Roast{SEP}smoky")
        assert not lex.is_valid_term("blueberry")            # bare labels are NOT keys
        assert not lex.is_valid_term("Fruit>Berry>durian")
        assert not lex.is_valid_term("Fruity>Berry>blueberry")  # the old wheel's keys are gone
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
    del data["families"]["fruit"]["tint"]
    messages = [e.message for e in Draft202012Validator(schema).iter_errors(data)]
    assert len(messages) >= 2


# Banned words are stored only as sha256 digests (controller ruling R11), so the
# test file itself never spells them. Lower-cased tokens: the shop's number, a
# store name, a staff name, and the two words of the third-party sheet's brand.
BANNED_WORD_HASHES = frozenset({
    "eed5fe88eedf687582e394a4afc70a7b8c6afbf20072c1a1d4a935ef5ef94640",
    "04e408bf1c03e6b59a66baf572993522a2e512f4d3924cdeac537b5e77424323",
    "b5a7d3c79084b8f59745ade726a5d9fa2112bca7e137d2a252b3c7ba06f2d2a0",
    "ca03b861723f3bc73bc8a14f649bba1697d2340e282b1362cab61ee6945b2d1d",
    "b01928cd61a0a26e091adcc564106156214bde4231d8f0c23e15ddb2c4cff04e",
})
# The old app's name is an ordinary word lower-cased, so only the exact capitalised
# token is banned, matched case-sensitively.
BANNED_EXACT_HASHES = frozenset({
    "37bac4952becf21ac5838d3c9ba82811bc421c857571e89634dcbe346681d54c",
})
# (path, line number) pairs of reviewed false positives. Empty: none were found.
EXACT_ALLOWLIST: frozenset = frozenset()
SKIP_FILES: set = set()
TOKEN = re.compile(r"[A-Za-z0-9]+")
ABBREVIATION = re.compile(r"\bBH\b|\bbh_")


def _digest(word: str) -> str:
    return hashlib.sha256(word.encode()).hexdigest()


def banned_tokens(text: str, words=BANNED_WORD_HASHES, exact=BANNED_EXACT_HASHES) -> list:
    """(line, token) for every banned token in ``text``."""
    hits = []
    for number, line in enumerate(text.splitlines(), 1):
        for token in TOKEN.findall(line):
            if _digest(token.lower()) in words or _digest(token) in exact:
                hits.append((number, token))
    return hits


def _project_files() -> list:
    out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout.split("\n")
    return [ROOT / f for f in out if f and f not in SKIP_FILES and (ROOT / f).is_file()]


def test_scanner_finds_and_ignores():
    words, exact = {_digest("zebra")}, {_digest("Okapi")}
    assert banned_tokens("a Zebra\nstripes, Okapi", words, exact) == [(1, "Zebra"), (2, "Okapi")]
    assert banned_tokens("okapi and zebras and Counter", words, exact) == []


def test_content_has_no_brand_strings():
    files = [p for p in CONTENT_DIR.rglob("*") if p.is_file()]
    assert files, "content directory is empty"
    for path in files:
        text = path.read_text(encoding="utf-8")
        assert not banned_tokens(text), path
        assert not ABBREVIATION.search(text), path


def test_no_shop_or_brand_strings_anywhere():
    files = _project_files()
    assert len(files) > 30
    offenders = []
    for path in files:
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        rel = str(path.relative_to(ROOT))
        for number, token in banned_tokens(text):
            if (rel, number) not in EXACT_ALLOWLIST:
                offenders.append((rel, number))
        if ABBREVIATION.search(text):
            offenders.append((rel, "abbreviation"))
    assert offenders == []
