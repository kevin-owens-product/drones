import pytest

from a2e.flight.commands import mav_command


def test_arm_disarm_land_are_fixed() -> None:
    assert mav_command("arm", 99) == (400, 1.0)
    assert mav_command("disarm", 99) == (400, 0.0)
    assert mav_command("land", 99) == (21, 0.0)


def test_takeoff_and_mode_keep_the_operator_value() -> None:
    assert mav_command("takeoff", 15) == (22, 15)
    assert mav_command("mode", 4) == (176, 4)


def test_unknown_command_is_rejected() -> None:
    with pytest.raises(ValueError):
        mav_command("release", 1)
