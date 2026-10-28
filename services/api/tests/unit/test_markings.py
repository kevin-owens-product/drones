from __future__ import annotations

import json
from pathlib import Path

from a2e.classification import (
    Marking,
    banner_text,
    marking_reasons,
    normalize_caveats,
    portion_mark,
)

CASES = json.loads(
    (Path(__file__).resolve().parents[4] / "policies" / "testdata" / "marking_cases.json").read_text()
)
SKIP = {"tenant_denied", "role_denied"}


def test_shared_vectors_match_python() -> None:
    for case in CASES:
        reason = case.get("reason")
        if reason in SKIP:
            continue
        reasons = marking_reasons(
            clearance=case["subject"]["clearance"],
            citizenship=case["subject"]["citizenship"],
            ntk=case["subject"]["ntk"],
            classification=case["resource"]["classification"],
            caveats=case["resource"]["caveats"],
            row_ntk=case["resource"]["ntk"],
            system_high=case["system_high"],
        )
        if case["allow"]:
            assert reasons == [], case["name"]
        else:
            assert reason in reasons, case["name"]


def test_banner_floor_and_union() -> None:
    text = banner_text(
        "CUI",
        [
            Marking("UNCLASSIFIED", ()),
            Marking("CUI", ("NOFORN",)),
        ],
    )
    assert text == "CUI//NOFORN"


def test_empty_screen_uses_system_high() -> None:
    assert banner_text("CUI", []) == "CUI"


def test_portion_and_caveat_order() -> None:
    ordered = normalize_caveats(["REL TO USA, GBR", "NOFORN"])
    assert ordered[0] == "NOFORN"
    assert portion_mark("CUI", ordered) == "(CUI//NOFORN/REL TO USA, GBR)"


def test_unknown_caveat_fails_closed() -> None:
    reasons = marking_reasons(
        clearance="CUI",
        citizenship="USA",
        ntk=[],
        classification="CUI",
        caveats=["ORCON"],
        row_ntk=[],
        system_high="CUI",
    )
    assert "caveat_not_understood" in reasons
