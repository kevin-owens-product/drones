"""Build CRSF fixtures from the public frame layout.

Field order matches Betaflight's telemetry CRSF test comments (GPS, battery,
link statistics, attitude, flight mode). The CRC is the DVB-S2 CRC8 over
type and payload, computed here so the C parser is not tested against its
own helper.
"""

from __future__ import annotations

import struct
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "testdata"


def crc8(data: bytes) -> int:
    crc = 0
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 0x80:
                crc = ((crc << 1) ^ 0xD5) & 0xFF
            else:
                crc = (crc << 1) & 0xFF
    return crc


def frame(address: int, type_id: int, payload: bytes) -> bytes:
    body = bytes([type_id]) + payload
    length = len(body) + 1
    return bytes([address, length]) + body + bytes([crc8(body)])


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    gps = frame(
        0xC8,
        0x02,
        struct.pack(">iiHHHB", 377749000, -1224194000, 123, 27450, 1125, 11),
    )
    battery = frame(0xC8, 0x08, struct.pack(">HH", 168, 42) + bytes([0x00, 0x05, 0xDC, 73]))
    link = frame(0xEA, 0x14, bytes([80, 90, 98, 256 - 5, 1, 2, 3, 70, 95, 256 - 2]))
    attitude = frame(0xC8, 0x1E, struct.pack(">hhh", 120, -40, 9000))
    mode = frame(0xC8, 0x21, b"ANGLE\x00")
    stream = bytes([0x00, 0x11, 0x22]) + gps + battery + link + attitude + mode
    (OUT / "stream.bin").write_bytes(stream)
    bad = bytearray(gps)
    bad[-1] ^= 0xFF
    (OUT / "bad_then_gps.bin").write_bytes(bytes(bad) + gps)
    print(f"wrote {OUT} gps={gps.hex()} len={len(stream)}")


if __name__ == "__main__":
    main()
