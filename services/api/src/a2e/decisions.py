"""Combine the SQL decision and the OPA decision. Both must allow."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Decision:
    allow: bool
    reasons: tuple[str, ...]
    disagreement: bool = False
    unavailable: bool = False


def combine(
    sql_allow: bool,
    opa_allow: bool | None,
    opa_reasons: list[str],
) -> Decision:
    if opa_allow is None:
        return Decision(False, ("opa_unavailable",), disagreement=False, unavailable=True)
    if sql_allow and opa_allow:
        return Decision(True, ())
    if not sql_allow and opa_allow:
        return Decision(False, ("denied",), disagreement=True)
    reasons = tuple(opa_reasons) if opa_reasons else ("denied",)
    return Decision(False, reasons)
