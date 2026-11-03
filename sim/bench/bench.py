"""End-of-line bench: plug in a flight controller, get a birth record.

    python bench.py --connect /dev/ttyACM0 --serial NX-0042 \\
        --parts parts.json --firmware build/px4_fmu-v6x.bin --out out/NX-0042.json

The bench captures a few seconds of MAVLink with the board at rest on the
bench, runs the acceptance checks in ``checks.py`` against a variant profile,
and writes two things: the check report, and a birth record in the shape
``a2e.birth.from_dict`` reads (the EOL test is a "bench" test; the IMU numbers
become calibrations). It never arms the board and never writes a parameter.

``--emulate FAULT`` runs against ``emulator.py`` on loopback instead of a
board, to show the flow without hardware.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import checks
from capture import capture

HERE = Path(__file__).parent


def birth_record(serial: str, parts: list[dict[str, str]], firmware_sha256: str, results: list[checks.Check], when: datetime) -> dict[str, Any]:
    cals = [
        {"name": c.name.removeprefix("imu "), "value": c.value, "low": c.low, "high": c.high}
        for c in results
        if c.name.startswith("imu ") and c.value is not None
    ]
    return {
        "serial": serial,
        "parts": parts,
        "calibrations": cals,
        "firmware_sha256": firmware_sha256,
        "eol": {"kind": "bench", "passed": checks.passed(results), "note": checks.first_failure(results)},
        "recorded_at": when.isoformat(),
    }


def verdict_of(record: dict[str, Any]) -> str | None:
    """The console's airworthiness verdict for this record, if the API package is installed."""
    try:
        from a2e import birth
    except ImportError:
        return None
    v = birth.verdict(birth.from_dict(record))
    return f"{v.status}: {v.reason}"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--connect", help="pymavlink connection string, e.g. /dev/ttyACM0 or udpin:0.0.0.0:14550")
    src.add_argument("--emulate", choices=["good", "bad-imu", "bad-param", "armed", "lossy", "no-mag"], help="run against the loopback emulator")
    ap.add_argument("--baud", type=int, default=921600)
    ap.add_argument("--serial", required=True, help="airframe serial number")
    ap.add_argument("--profile", type=Path, default=HERE / "profiles" / "variant-a.json")
    ap.add_argument("--parts", type=Path, help='JSON list of {"part": ..., "lot": ...}')
    fw = ap.add_mutually_exclusive_group()
    fw.add_argument("--firmware", type=Path, help="the image that was flashed; its sha256 goes in the record")
    fw.add_argument("--firmware-sha256")
    ap.add_argument("--seconds", type=float, help="capture length (default from profile)")
    ap.add_argument("--out", type=Path, help="write {report, birth} JSON here")
    a = ap.parse_args(argv)

    profile = json.loads(a.profile.read_text())
    seconds = a.seconds or profile["capture_s"]
    connect = a.connect
    stop = None
    if a.emulate:
        import emulator

        port = 14650
        _, stop = emulator.start(port, a.emulate, seconds + 15)
        connect = f"udpin:127.0.0.1:{port}"
    try:
        cap = capture(connect, a.baud, seconds, list(profile["params"]))
    finally:
        if stop:
            stop.set()

    results = checks.run(cap, profile)
    for c in results:
        print(f"{'PASS' if c.passed else 'FAIL'}  {c.name:28} {c.detail}")
    if not cap.heartbeats:
        print("No heartbeat; nothing recorded.", file=sys.stderr)
        return 2

    if a.firmware:
        sha = hashlib.sha256(a.firmware.read_bytes()).hexdigest()
    else:
        sha = (a.firmware_sha256 or "").lower()
    parts = json.loads(a.parts.read_text()) if a.parts else []
    record = birth_record(a.serial, parts, sha, results, datetime.now(UTC))
    v = verdict_of(record)
    print(f"\n{a.serial}: {'PASS' if checks.passed(results) else 'FAIL'}" + (f"  (console verdict: {v})" if v else ""))
    if a.out:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        report = {"serial": a.serial, "profile": profile["name"], "source": "emulator" if a.emulate else connect, "seconds": seconds, "checks": [c.to_dict() for c in results]}
        a.out.write_text(json.dumps({"report": report, "birth": record}, indent=2) + "\n")
    return 0 if checks.passed(results) else 1


if __name__ == "__main__":
    sys.exit(main())
