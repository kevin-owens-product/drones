"""A pretend flight controller that speaks real MAVLink over loopback UDP.

It exists so the bench's transport can be tested without hardware. It answers
the same requests a PX4 board would (stream rates, AUTOPILOT_VERSION, the
parameter list) and can be told to misbehave in the ways the bench should
catch. It is not a model of PX4; a pass against it says the plumbing works,
not that a board is good.
"""

from __future__ import annotations

import random
import threading
import time

from pymavlink import mavutil

PARAMS = {
    "NAV_RCL_ACT": 2.0, "NAV_DLL_ACT": 2.0, "COM_DL_LOSS_T": 10.0, "COM_RC_LOSS_T": 0.5,
    "COM_LOW_BAT_ACT": 3.0, "GF_ACTION": 3.0, "BAT_CRIT_THR": 0.07,
    "MPC_XY_VEL_MAX": 12.0, "MPC_Z_VEL_MAX_UP": 3.0, "SYS_AUTOSTART": 4001.0,
}
FAULTS = ("good", "bad-imu", "bad-param", "armed", "lossy", "no-mag")


def run(port: int, fault: str = "good", seconds: float = 30.0, seed: int = 1, stop: threading.Event | None = None) -> None:
    if fault not in FAULTS:
        raise ValueError(f"fault must be one of {FAULTS}")
    rng = random.Random(seed)
    m = mavutil.mavlink_connection(f"udpout:127.0.0.1:{port}", source_system=1, source_component=1)
    params = dict(PARAMS)
    if fault == "bad-param":
        params["NAV_DLL_ACT"] = 0.0
    gyro_sigma = 0.03 if fault == "bad-imu" else 0.003
    health = 0b1111 & ~(4 if fault == "no-mag" else 0)
    rate = {30: 10.0, 105: 10.0}
    due = {30: 0.0, 105: 0.0}
    param_queue: list[str] = []
    start = time.monotonic()
    next_hb = start

    def send(fn, *args):  # type: ignore[no-untyped-def]
        if fault == "lossy" and rng.random() < 0.05:
            m.mav.seq = (m.mav.seq + 1) % 256  # the packet "was sent" but never arrives
            return
        fn(*args)

    while time.monotonic() - start < seconds and not (stop and stop.is_set()):
        now = time.monotonic()
        t_ms = int((now - start) * 1000)
        if now >= next_hb:
            base = mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED | (128 if fault == "armed" else 0)
            send(m.mav.heartbeat_send, 2, 12, base, 0, 3)
            send(m.mav.sys_status_send, 0b1111, 0b1111, health, 200, 16000, -1, 90, 0, 0, 0, 0, 0, 0)
            next_hb += 1.0
        for mid in (30, 105):
            if now >= due[mid]:
                due[mid] = now + 1.0 / rate[mid]
                if mid == 30:
                    send(m.mav.attitude_send, t_ms, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
                else:
                    g = [rng.gauss(0.001, gyro_sigma) for _ in range(3)]
                    a = [rng.gauss(0, 0.03), rng.gauss(0, 0.03), rng.gauss(-9.81, 0.03)]
                    send(m.mav.highres_imu_send, t_ms * 1000, *a, *g, 0.2, 0.0, 0.4, 1013.0, 0.0, 30.0, 25.0, 0x1FFF)
        if param_queue:
            for _ in range(5):
                if not param_queue:
                    break
                name = param_queue.pop(0)
                keys = list(params)
                send(m.mav.param_value_send, name.encode(), params[name], 9, len(keys), keys.index(name))
        msg = m.recv_match(blocking=False)
        while msg is not None:
            kind = msg.get_type()
            if kind == "COMMAND_LONG":
                if msg.command == 511 and msg.param2 > 0:
                    rate[int(msg.param1)] = 1e6 / msg.param2
                elif msg.command == 512 and int(msg.param1) == 148:
                    send(m.mav.autopilot_version_send, 0, (1 << 24) | (18 << 16) | (0 << 8), 0, 0, 0, [0] * 8, [0] * 8, [0] * 8, 0, 0, 0)
                send(m.mav.command_ack_send, msg.command, 0)
            elif kind == "PARAM_REQUEST_LIST":
                param_queue.extend(params)
            elif kind == "PARAM_REQUEST_READ":
                name = msg.param_id.rstrip("\x00") if isinstance(msg.param_id, str) else msg.param_id.decode().rstrip("\x00")
                if name in params:
                    param_queue.append(name)
            msg = m.recv_match(blocking=False)
        time.sleep(0.001)
    m.close()


def start(port: int, fault: str = "good", seconds: float = 30.0) -> tuple[threading.Thread, threading.Event]:
    stop = threading.Event()
    th = threading.Thread(target=run, args=(port, fault, seconds), kwargs={"stop": stop}, daemon=True)
    th.start()
    return th, stop


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Emulated flight controller on loopback UDP")
    ap.add_argument("--port", type=int, default=14650)
    ap.add_argument("--fault", choices=FAULTS, default="good")
    ap.add_argument("--seconds", type=float, default=60)
    a = ap.parse_args()
    run(a.port, a.fault, a.seconds)
