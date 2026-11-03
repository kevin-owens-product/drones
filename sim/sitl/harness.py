"""Run one PX4 SIH quadcopter in Docker and talk MAVLink to it.

SIH (simulation-in-hardware) is PX4's built-in rigid-body simulator. It runs
the real PX4 flight stack (EKF2, position and attitude controllers, commander)
against a 6-DOF quad model, with no Gazebo and no GPU. That makes it cheap
enough to run many seeded trials headless.

Ground truth comes from HIL_STATE_QUATERNION, which PX4 fills from the SIH
ground-truth topics. The estimate comes from GLOBAL_POSITION_INT, which is
EKF2's output. Error is always estimate minus truth in the same frame.
"""

from __future__ import annotations

import json
import math
import os
import socket
import subprocess
import time
from dataclasses import dataclass

from pymavlink import mavutil

IMAGE = os.environ.get(
    "A2E_PX4_IMAGE",
    "px4io/px4-sitl-gazebo:v1.18.0-rc1@sha256:aa4bbf35f0bd6bdb3269cc96e317c8e78b87f1fc769c734c0818094074e1cc0a",
)
PX4_BIN = "/opt/px4-gazebo/bin"
EARTH_R = 6_378_137.0

# MAVLink ids not always present in pymavlink enums.
HIL_STATE_QUATERNION = 115
GLOBAL_POSITION_INT = 33
ESTIMATOR_STATUS = 230
PX4_MODE_OFFBOARD = 6


@dataclass
class Ned:
    n: float
    e: float
    d: float


def to_ned(lat_deg: float, lon_deg: float, alt_m: float, ref: tuple[float, float, float]) -> Ned:
    lat0, lon0, alt0 = ref
    n = math.radians(lat_deg - lat0) * EARTH_R
    e = math.radians(lon_deg - lon0) * EARTH_R * math.cos(math.radians(lat0))
    return Ned(n, e, -(alt_m - alt0))


def to_lla(p: Ned, ref: tuple[float, float, float]) -> tuple[float, float, float]:
    lat0, lon0, alt0 = ref
    lat = lat0 + math.degrees(p.n / EARTH_R)
    lon = lon0 + math.degrees(p.e / (EARTH_R * math.cos(math.radians(lat0))))
    return lat, lon, alt0 - p.d


class Sih:
    """One PX4 SIH instance in a container on the host network."""

    def __init__(self, name: str, instance: int = 0, speed: float = 1.0) -> None:
        self.name = name
        self.instance = instance
        self.speed = speed
        # PX4 instance i sends its onboard link to 14540 + i.
        self.port = 14540 + instance

    def start(self) -> None:
        subprocess.run(["docker", "rm", "-f", self.name], capture_output=True, check=False)
        subprocess.run(
            [
                "docker", "run", "-d", "--name", self.name, "--network", "host",
                "--log-opt", "max-size=10m", "--log-opt", "max-file=3",
                "-e", "PX4_SIMULATOR=sihsim",
                "-e", "PX4_SIM_MODEL=sihsim_quadx",
                "-e", "PX4_SYS_AUTOSTART=10040",
                "-e", f"PX4_SIM_SPEED_FACTOR={self.speed}",
                "-v", f"{os.path.dirname(os.path.abspath(__file__))}:/a2e:ro",
                "--entrypoint", f"{PX4_BIN}/px4",
                IMAGE, "-d", "-i", str(self.instance),
            ],
            check=True,
            capture_output=True,
        )

    def shell(self, *args: str) -> str:
        out = subprocess.run(
            ["docker", "exec", self.name, f"{PX4_BIN}/px4-{args[0]}", "--instance", str(self.instance), *args[1:]],
            capture_output=True,
            text=True,
            check=False,
        )
        return out.stdout + out.stderr

    def param(self, name: str, value: float | int) -> None:
        self.shell("param", "set", name, str(value))

    def start_nmea_gnss(self) -> None:
        """Replace the simulated GPS with PX4's NMEA driver on a pty we feed."""
        self.shell("sensor_gps_sim", "stop")
        subprocess.run(
            ["docker", "exec", "-d", self.name, "python3", "/a2e/nmea_bridge.py",
             "--port", str(self.gnss_port), "--link", "/tmp/gps0"],
            check=True,
        )
        time.sleep(0.5)
        self.shell("gps", "start", "-d", "/tmp/gps0", "-b", "115200", "-p", "nmea")
        self._gnss = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    @property
    def gnss_port(self) -> int:
        return 15600 + self.instance

    def send_fix(self, lat: float, lon: float, alt: float, vn: float, ve: float, hacc: float, fix: int = 3) -> None:
        payload = {"lat": lat, "lon": lon, "alt": alt, "vn": vn, "ve": ve, "hacc": hacc, "fix": fix}
        self._gnss.sendto(json.dumps(payload).encode(), ("127.0.0.1", self.gnss_port))

    def stop(self) -> None:
        subprocess.run(["docker", "rm", "-f", self.name], capture_output=True, check=False)


class Link:
    """MAVLink on the PX4 onboard port, as a companion computer would see it."""

    def __init__(self, port: int) -> None:
        self.m = mavutil.mavlink_connection(f"udpin:0.0.0.0:{port}", source_system=1, source_component=191)

    def wait_heartbeat(self, timeout: float = 30) -> None:
        if self.m.wait_heartbeat(timeout=timeout) is None:
            raise TimeoutError("no heartbeat from PX4")

    def interval(self, msg_id: int, hz: float) -> None:
        self.command(mavutil.mavlink.MAV_CMD_SET_MESSAGE_INTERVAL, msg_id, 1e6 / hz)

    def command(self, cmd: int, *params: float) -> None:
        p = list(params) + [0.0] * (7 - len(params))
        self.m.mav.command_long_send(self.m.target_system, self.m.target_component, cmd, 0, *p)

    def arm(self) -> None:
        self.command(mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 1)

    def offboard(self) -> None:
        self.command(mavutil.mavlink.MAV_CMD_DO_SET_MODE, 1, PX4_MODE_OFFBOARD)

    def setpoint(self, boot_ms: int, p: Ned, yaw: float = 0.0) -> None:
        mask = 0b0000_1001_1111_1000  # position and yaw only
        self.m.mav.set_position_target_local_ned_send(
            boot_ms, self.m.target_system, self.m.target_component,
            mavutil.mavlink.MAV_FRAME_LOCAL_NED, mask,
            p.n, p.e, p.d, 0, 0, 0, 0, 0, 0, yaw, 0,
        )

    def velocity(self, boot_ms: int, vn: float, ve: float, vd: float, yaw: float) -> None:
        mask = 0b0000_1001_1100_0111  # velocity and yaw only
        self.m.mav.set_position_target_local_ned_send(
            boot_ms, self.m.target_system, self.m.target_component,
            mavutil.mavlink.MAV_FRAME_LOCAL_NED, mask,
            0, 0, 0, vn, ve, vd, 0, 0, 0, yaw, 0,
        )

    def vision(self, usec: int, p: Ned, yaw: float, v: Ned, pos_var: float, vel_var: float) -> None:
        cov = [float("nan")] * 21
        cov[0] = cov[6] = cov[11] = pos_var
        self.m.mav.vision_position_estimate_send(usec, p.n, p.e, p.d, 0, 0, yaw, cov, 0)
        vcov = [vel_var, 0, 0, 0, vel_var, 0, 0, 0, vel_var]
        self.m.mav.vision_speed_estimate_send(usec, v.n, v.e, v.d, vcov, 0)

    def gps(self, usec: int, lat: float, lon: float, alt: float, v: Ned, hacc: float, fix: int = 3) -> None:
        self.m.mav.gps_input_send(
            usec, 0, 0, 0, 0, fix,
            int(lat * 1e7), int(lon * 1e7), alt,
            0.8, 1.2, v.n, v.e, v.d, 0.3, hacc, hacc * 1.5, 14, 0,
        )

    def recv(self, timeout: float = 1.0):  # type: ignore[no-untyped-def]
        return self.m.recv_match(blocking=True, timeout=timeout)


def wait_until(pred, timeout: float, step: float = 0.05) -> bool:  # type: ignore[no-untyped-def]
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if pred():
            return True
        time.sleep(step)
    return False
