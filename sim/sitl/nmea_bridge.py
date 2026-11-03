"""A fake GNSS receiver on a serial line, for PX4's real gps driver.

Runs inside the PX4 container. It opens a pseudo-terminal, links its slave
end to a fixed path, and writes NMEA (GGA, RMC, GSA, GST) for every fix it
receives as JSON on a UDP port. PX4 reads it with `gps start -p nmea`, the
same driver and parser a cheap NMEA receiver on a real flight controller uses.

A fix with "fix": 0 is written as a no-fix GGA, which is what a jammed
receiver reports.
"""

from __future__ import annotations

import argparse
import json
import os
import pty
import socket
import time


def checksum(body: str) -> str:
    c = 0
    for ch in body:
        c ^= ord(ch)
    return f"${body}*{c:02X}\r\n"


def dm(value: float, lat: bool) -> tuple[str, str]:
    hemi = ("N" if value >= 0 else "S") if lat else ("E" if value >= 0 else "W")
    value = abs(value)
    deg = int(value)
    minutes = (value - deg) * 60
    if lat:
        return f"{deg:02d}{minutes:07.4f}", hemi
    return f"{deg:03d}{minutes:07.4f}", hemi


def sentences(fix: dict[str, float]) -> list[str]:
    now = time.gmtime()
    frac = time.time() % 1
    hms = time.strftime("%H%M%S", now) + f".{int(frac * 100):02d}"
    date = time.strftime("%d%m%y", now)
    if int(fix.get("fix", 3)) == 0:
        return [
            checksum(f"GPGGA,{hms},,,,,0,00,99.9,,M,,M,,"),
            checksum(f"GPRMC,{hms},V,,,,,,,{date},,,N"),
        ]
    lat, ns = dm(fix["lat"], True)
    lon, ew = dm(fix["lon"], False)
    alt = fix["alt"]
    vn, ve = fix.get("vn", 0.0), fix.get("ve", 0.0)
    knots = (vn * vn + ve * ve) ** 0.5 * 1.943844
    course = (__import__("math").degrees(__import__("math").atan2(ve, vn)) + 360) % 360
    hacc = fix.get("hacc", 1.0)
    return [
        checksum(f"GPGGA,{hms},{lat},{ns},{lon},{ew},1,14,0.8,{alt:.2f},M,0.0,M,,"),
        checksum(f"GPRMC,{hms},A,{lat},{ns},{lon},{ew},{knots:.2f},{course:.1f},{date},,,A"),
        checksum("GPGSA,A,3,01,02,03,04,05,06,07,08,09,10,11,12,1.4,0.8,1.2"),
        checksum(f"GPGST,{hms},{hacc:.2f},{hacc:.2f},{hacc:.2f},0.0,{hacc:.2f},{hacc:.2f},{hacc * 1.5:.2f}"),
    ]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--link", default="/tmp/gps0")
    args = ap.parse_args()
    master, slave = pty.openpty()
    name = os.ttyname(slave)
    if os.path.lexists(args.link):
        os.unlink(args.link)
    os.symlink(name, args.link)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", args.port))
    while True:
        data, _ = sock.recvfrom(4096)
        try:
            fix = json.loads(data)
        except ValueError:
            continue
        for line in sentences(fix):
            os.write(master, line.encode())


if __name__ == "__main__":
    main()
