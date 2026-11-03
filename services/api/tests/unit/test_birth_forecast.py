from dataclasses import replace
from datetime import UTC, datetime

import pytest

from a2e.birth import BirthRecord, Calibration, EolTest, PartLot, from_dict, validate, verdict
from a2e.forecast import Pack, attrition_rate, pack_health, ready_tomorrow

FW = "a" * 64


def record(**kw: object) -> BirthRecord:
    base = BirthRecord(
        serial="NX-12",
        parts=(PartLot("fc", "L2311"), PartLot("esc", "E0907")),
        calibrations=(Calibration("IMU", 0.02, -0.05, 0.05), Calibration("Mag", 0.9, 0.8, 1.2)),
        firmware_sha256=FW,
        eol=EolTest("hover", True),
        recorded_at=datetime(2026, 11, 2, 9, 0, tzinfo=UTC),
    )
    return replace(base, **kw)  # type: ignore[arg-type]


def test_clean_record_is_airworthy() -> None:
    rec = record()
    assert validate(rec) == []
    assert verdict(rec).status == "airworthy"
    assert verdict(rec).reason == "EOL hover test passed"


def test_failed_hover_names_the_out_of_range_cal() -> None:
    rec = record(
        calibrations=(Calibration("IMU", 0.09, -0.05, 0.05),),
        eol=EolTest("hover", False, "drifted"),
    )
    assert verdict(rec).status == "grounded"
    assert verdict(rec).reason == "EOL hover test failed: IMU cal out of range"


def test_failed_bench_without_cal_fault_uses_note() -> None:
    v = verdict(record(eol=EolTest("bench", False, "motor 3 current high")))
    assert v.reason == "EOL bench test failed: motor 3 current high"


def test_cal_out_of_range_grounds_even_if_eol_passed() -> None:
    v = verdict(record(calibrations=(Calibration("Mag", 1.5, 0.8, 1.2),)))
    assert (v.status, v.reason) == ("grounded", "Mag cal out of range")


def test_invalid_record_is_unknown_not_airworthy() -> None:
    rec = record(firmware_sha256="deadbeef", parts=())
    assert len(validate(rec)) == 2
    assert verdict(rec).status == "unknown"
    assert verdict(rec).reason.startswith("Birth record invalid: no parts lots")
    assert "timezone" in validate(record(recorded_at=datetime(2026, 1, 1)))[0]


def test_from_dict_round_trip() -> None:
    rec = from_dict(
        {
            "serial": "NX-12",
            "parts": [{"part": "fc", "lot": "L1"}],
            "calibrations": [{"name": "IMU", "value": 0.09, "low": -0.05, "high": 0.05}],
            "firmware_sha256": FW,
            "eol": {"kind": "hover", "passed": False},
            "recorded_at": "2026-11-02T09:00:00+00:00",
        }
    )
    assert verdict(rec).reason == "EOL hover test failed: IMU cal out of range"


def test_pack_health_from_fade_and_cycles() -> None:
    h = pack_health(Pack("B1", cycles=100, capacity_mah=4500, rated_mah=5000))
    assert h.soh == pytest.approx(0.9)
    assert h.fade_per_cycle == pytest.approx(0.001)
    assert h.cycles_left == 100 and h.usable
    assert pack_health(Pack("B2", 0, 5000, 5000)).cycles_left == 300
    assert not pack_health(Pack("B3", 250, 3900, 5000)).usable
    assert not pack_health(Pack("B4", 300, 4900, 5000)).usable
    with pytest.raises(ValueError):
        pack_health(Pack("B5", 1, 1, 0))


def test_attrition_interval_brackets_rate() -> None:
    p, lo, hi = attrition_rate(2, 100)
    assert p == 0.02 and lo < p < hi
    _, lo0, hi0 = attrition_rate(0, 10)
    assert lo0 == 0.0 and hi0 > 0.1
    with pytest.raises(ValueError):
        attrition_rate(3, 2)


def test_ready_tomorrow_attrition_bound() -> None:
    packs = [Pack(f"B{i}", 10, 4950, 5000) for i in range(40)]
    f = ready_tomorrow("A Co", 12, packs, sorties_per_airframe=3, losses=2, sorties=100)
    assert f.limited_by == "attrition"
    assert f.low <= f.expected <= f.high + 1
    assert f.high <= 12 and f.low < f.high


def test_ready_tomorrow_pack_bound() -> None:
    worn = [Pack(f"W{i}", 180, 4010, 5000) for i in range(6)]  # 1 cycle left each
    fresh = [Pack(f"F{i}", 5, 4990, 5000) for i in range(4)]
    f = ready_tomorrow("B Co", 10, worn + fresh, sorties_per_airframe=1, losses=0, sorties=50)
    assert f.limited_by == "packs"
    assert f.high == 2  # only the 4 fresh packs survive today's cycles, 2 per airframe
