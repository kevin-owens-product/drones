"""Factory-to-flight digital thread: one birth record per airframe serial.

A birth record is what the factory knows when a vehicle leaves the line: which
parts lots went in, the calibration results, the firmware it was flashed with,
and the end-of-line (EOL) bench or hover test. ``verdict`` turns that into the
airworthiness status the console shows, with a reason an operator can read.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

Status = Literal["airworthy", "grounded", "unknown"]
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True)
class PartLot:
    part: str
    lot: str


@dataclass(frozen=True)
class Calibration:
    name: str
    value: float
    low: float
    high: float

    @property
    def ok(self) -> bool:
        return self.low <= self.value <= self.high


@dataclass(frozen=True)
class EolTest:
    kind: Literal["bench", "hover"]
    passed: bool
    note: str = ""


@dataclass(frozen=True)
class BirthRecord:
    serial: str
    parts: tuple[PartLot, ...]
    calibrations: tuple[Calibration, ...]
    firmware_sha256: str
    eol: EolTest
    recorded_at: datetime


@dataclass(frozen=True)
class Verdict:
    status: Status
    reason: str


def validate(rec: BirthRecord) -> list[str]:
    """Problems that make the record unusable as evidence. Empty means valid."""
    errors: list[str] = []
    if not rec.serial.strip():
        errors.append("serial is empty")
    if not rec.parts:
        errors.append("no parts lots")
    for p in rec.parts:
        if not p.part.strip() or not p.lot.strip():
            errors.append(f"part lot incomplete: {p.part or '?'}")
    if not rec.calibrations:
        errors.append("no calibration results")
    for c in rec.calibrations:
        if c.low > c.high:
            errors.append(f"{c.name} cal limits inverted")
    if not _SHA256.match(rec.firmware_sha256):
        errors.append("firmware hash is not a lowercase sha256")
    if rec.eol.kind not in ("bench", "hover"):
        errors.append(f"unknown EOL test kind: {rec.eol.kind}")
    if rec.recorded_at.tzinfo is None:
        errors.append("timestamp has no timezone")
    return errors


def verdict(rec: BirthRecord) -> Verdict:
    """Airworthiness from the birth record alone, with the first reason that decides it."""
    errors = validate(rec)
    if errors:
        return Verdict("unknown", f"Birth record invalid: {errors[0]}")
    bad_cal = next((c for c in rec.calibrations if not c.ok), None)
    cause = f"{bad_cal.name} cal out of range" if bad_cal else (rec.eol.note or "no cause recorded")
    if not rec.eol.passed:
        return Verdict("grounded", f"EOL {rec.eol.kind} test failed: {cause}")
    if bad_cal:
        return Verdict("grounded", cause)
    return Verdict("airworthy", f"EOL {rec.eol.kind} test passed")


def from_dict(d: dict[str, Any]) -> BirthRecord:
    """Parse the JSON shape the factory station posts. Raises KeyError/ValueError on bad shape."""
    eol = d["eol"]
    return BirthRecord(
        serial=str(d["serial"]),
        parts=tuple(PartLot(str(p["part"]), str(p["lot"])) for p in d["parts"]),
        calibrations=tuple(
            Calibration(str(c["name"]), float(c["value"]), float(c["low"]), float(c["high"]))
            for c in d["calibrations"]
        ),
        firmware_sha256=str(d["firmware_sha256"]),
        eol=EolTest(eol["kind"], bool(eol["passed"]), str(eol.get("note", ""))),
        recorded_at=datetime.fromisoformat(str(d["recorded_at"])),
    )
