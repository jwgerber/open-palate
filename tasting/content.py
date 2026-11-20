"""Content as data: the flavor wheel and the score-sheet wording.

``content/lexicon.json`` (the 2020 flavor wheel credited in the README, and the
labels for the fixed enums) and ``content/forms.json`` (labels and wording for
the two sheets) are read once at startup. Scoring rules do NOT live here: the
1-5 and 7.5-10 ranges, the 7.0 disqualified value and the required bar vote
are column domains, kept in code (``tasting.enums``).

Term keys. A tag is stored as the node's PATH joined by the key separator
(``"Fruit>Berry>blueberry"``), never the bare label, so a key says where on the
wheel a note sits, and a taster can pick a heading (``"Fruit>Citrus"``) as is.
"""
import hashlib
import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path

CONTENT_DIR = Path(__file__).resolve().parent.parent / "content"


@dataclass(frozen=True)
class Content:
    lexicon: dict
    forms: dict
    term_index: dict   # key -> {label, family, tier, leaf, path}
    etag: str

    def is_valid_term(self, key) -> bool:
        return isinstance(key, str) and key in self.term_index

    def ancestors_of(self, key: str) -> list:
        """Keys of every ancestor, root first. Empty for a family."""
        path = self.term_index[key]["path"]
        sep = self.lexicon["key_separator"]
        return [sep.join(path[:i]) for i in range(1, len(path))]

    def family_of(self, key: str) -> str:
        return self.term_index[key]["family"]

    def label_of(self, key: str) -> str:
        return self.term_index[key]["label"]

    def tier_of(self, key: str) -> int:
        return self.term_index[key]["tier"]

    @property
    def defects(self) -> tuple:
        return tuple(self.lexicon["defects"])

    @property
    def attributes(self) -> tuple:
        return tuple(self.forms["basic"]["attributes"])

    def scale_word(self, attribute: str, mean_value: float) -> str:
        words = self.forms["basic"]["scale_words"][attribute]
        return words[max(0, min(4, round(mean_value) - 1))]

    def to_json(self) -> dict:
        return {"lexicon": self.lexicon, "forms": self.forms}


def _walk(level, path, family, sep, out):
    for node in level:
        fam = node.get("family", family)
        node_path = path + [node["label"]]
        children = node.get("children", [])
        out[sep.join(node_path)] = {
            "label": node["label"], "family": fam, "tier": len(node_path),
            "leaf": not children, "path": node_path,
        }
        _walk(children, node_path, fam, sep, out)


def _read(name: str) -> tuple:
    raw = (CONTENT_DIR / name).read_bytes()
    return json.loads(raw), raw


@cache
def load() -> Content:
    """Read and index the content files. Cached: the files are read once."""
    lexicon, lex_raw = _read("lexicon.json")
    forms, forms_raw = _read("forms.json")
    index: dict = {}
    _walk(lexicon["tree"], [], None, lexicon["key_separator"], index)
    etag = hashlib.sha256(lex_raw + forms_raw).hexdigest()[:16]
    return Content(lexicon=lexicon, forms=forms, term_index=index, etag=etag)


def get() -> Content:
    return load()
