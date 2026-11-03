"""MAVLink command ids for operator actions. There is no weapon command."""

from __future__ import annotations

# MAV_CMD_COMPONENT_ARM_DISARM, NAV_TAKEOFF, NAV_LAND, DO_SET_MODE.
_FIXED = {
    "arm": (400, 1.0),
    "disarm": (400, 0.0),
    "land": (21, 0.0),
}


def mav_command(name: str, param1: float) -> tuple[int, float]:
    if name in _FIXED:
        code, value = _FIXED[name]
        return code, value
    if name == "takeoff":
        return 22, param1
    if name == "mode":
        return 176, param1
    raise ValueError(name)
