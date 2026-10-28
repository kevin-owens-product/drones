"""Portion marks, caveats, and banner rollup.

The same rules are enforced in SQL (RLS) and in Rego. Vectors live in
policies/testdata/marking_cases.json. Unknown caveats fail closed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

CLASSIFICATION_RANK: dict[str, int] = {
    "UNCLASSIFIED": 0,
    "CUI": 1,
    "CONFIDENTIAL": 2,
    "SECRET": 3,
    "TOP_SECRET": 4,
}

BUILD_MAX = "CUI"
FVEY = frozenset({"USA", "GBR", "CAN", "AUS", "NZL"})
PORTION_LABEL = {
    "UNCLASSIFIED": "U",
    "CUI": "CUI",
    "CONFIDENTIAL": "C",
    "SECRET": "S",
    "TOP_SECRET": "TS",
}
BANNER_NAME = {
    "UNCLASSIFIED": "UNCLASSIFIED",
    "CUI": "CUI",
    "CONFIDENTIAL": "CONFIDENTIAL",
    "SECRET": "SECRET",
    "TOP_SECRET": "TOP SECRET",
}
_CITIZENSHIP = re.compile(r"^[A-Z]{3}$")
_TOKEN = re.compile(r"^[A-Z]{3}$")


@dataclass(frozen=True)
class Marking:
    classification: str
    caveats: tuple[str, ...] = ()
    ntk_programs: tuple[str, ...] = ()


def normalize_caveats(caveats: list[str] | tuple[str, ...]) -> list[str]:
    def sort_key(value: str) -> tuple[int, str]:
        if value == "NOFORN":
            return (0, value)
        if value.startswith("REL TO "):
            return (1, value)
        return (2, value)

    return sorted(caveats, key=sort_key)


def citizenship_valid(citizenship: str) -> bool:
    return _CITIZENSHIP.fullmatch(citizenship) is not None


def _rel_tokens(caveat: str) -> list[str] | None:
    body = caveat[len("REL TO ") :]
    tokens = [token for token in re.split(r"[, ]+", body) if token]
    if not tokens:
        return None
    for token in tokens:
        if token != "FVEY" and _TOKEN.fullmatch(token) is None:
            return None
    return tokens


def caveats_understood(caveats: list[str] | tuple[str, ...]) -> bool:
    for caveat in caveats:
        if caveat == "NOFORN":
            continue
        if caveat.startswith("REL TO "):
            if _rel_tokens(caveat) is None:
                return False
            continue
        return False
    return True


def marking_reasons(
    *,
    clearance: str,
    citizenship: str,
    ntk: list[str] | tuple[str, ...],
    classification: str,
    caveats: list[str] | tuple[str, ...],
    row_ntk: list[str] | tuple[str, ...],
    system_high: str,
) -> list[str]:
    """Reasons the subject may not see the row. Empty means the marking allows it."""
    reasons: list[str] = []
    if not citizenship_valid(citizenship):
        reasons.append("citizenship_invalid")
    row_rank = CLASSIFICATION_RANK.get(classification)
    holder_rank = CLASSIFICATION_RANK.get(clearance)
    high_rank = CLASSIFICATION_RANK.get(system_high)
    if row_rank is None or holder_rank is None or high_rank is None:
        reasons.append("clearance_insufficient")
        return reasons
    if row_rank > high_rank:
        reasons.append("above_system_high")
    if holder_rank < row_rank:
        reasons.append("clearance_insufficient")
    if not caveats_understood(caveats):
        reasons.append("caveat_not_understood")
        return reasons
    if "NOFORN" in caveats and citizenship != "USA":
        reasons.append("noforn")
    rel_lists = [_rel_tokens(c) for c in caveats if c.startswith("REL TO ")]
    if rel_lists:
        allowed: set[str] = set()
        for tokens in rel_lists:
            if tokens is None:
                continue
            for token in tokens:
                if token == "FVEY":
                    allowed.update(FVEY)
                else:
                    allowed.add(token)
        if citizenship not in allowed:
            reasons.append("rel_to_denied")
    if len(row_ntk) > 0 and not set(row_ntk).intersection(ntk):
        reasons.append("ntk_denied")
    return reasons


def portion_mark(classification: str, caveats: list[str] | tuple[str, ...]) -> str:
    label = PORTION_LABEL[classification]
    if not caveats:
        return f"({label})"
    return f"({label}//{'/'.join(caveats)})"


def banner_text(system_high: str, rows: list[Marking]) -> str:
    """System-high floor, plus every caveat actually on screen."""
    top = system_high
    seen: list[str] = []
    for row in rows:
        if CLASSIFICATION_RANK[row.classification] > CLASSIFICATION_RANK[top]:
            top = row.classification
        for caveat in row.caveats:
            if caveat not in seen:
                seen.append(caveat)
    name = BANNER_NAME[top]
    ordered = normalize_caveats(seen)
    if not ordered:
        return name
    return name + "//" + "/".join(ordered)
