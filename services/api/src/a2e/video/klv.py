"""MISB ST 0601 local-set reader for the tags the map needs.

Checksum failures drop the frame. This is not a fire-control parser.
"""

from __future__ import annotations

from dataclasses import dataclass

UAS_LOCAL_SET = bytes.fromhex("060E2B34020B01010E01030101000000")


class KlvError(ValueError):
    pass


@dataclass(frozen=True)
class KlvFrame:
    precision_time_us: int | None
    sensor_lat: float | None
    sensor_lon: float | None
    frame_center_lat: float | None
    frame_center_lon: float | None
    checksum_ok: bool


def _imapb(raw: bytes, minimum: float, maximum: float) -> float:
    span = (1 << (8 * len(raw))) - 1
    return minimum + (int.from_bytes(raw, "big") / span) * (maximum - minimum)


def parse_uas_datalink(packet: bytes) -> KlvFrame:
    if len(packet) < 20 or packet[:16] != UAS_LOCAL_SET:
        raise KlvError("not a UAS datalink local set")
    length, consumed = _ber_length(packet[16:])
    start = 16 + consumed
    end = start + length
    if end > len(packet):
        raise KlvError("truncated local set")
    body = packet[start:end]
    values: dict[int, bytes] = {}
    offset = 0
    checksum_ok = False
    while offset < len(body):
        tag = body[offset]
        offset += 1
        if offset >= len(body):
            raise KlvError("truncated tag")
        size = body[offset]
        offset += 1
        raw = body[offset : offset + size]
        if len(raw) != size:
            raise KlvError("truncated value")
        offset += size
        if tag == 1:
            expected = sum(packet[: start + offset - size]) & 0xFFFF
            checksum_ok = int.from_bytes(raw, "big") == expected
        else:
            values[tag] = raw
    if not checksum_ok:
        raise KlvError("checksum failed")
    return KlvFrame(
        precision_time_us=int.from_bytes(values[2], "big") if 2 in values else None,
        sensor_lat=_imapb(values[13], -90, 90) if 13 in values else None,
        sensor_lon=_imapb(values[14], -180, 180) if 14 in values else None,
        frame_center_lat=_imapb(values[23], -90, 90) if 23 in values else None,
        frame_center_lon=_imapb(values[24], -180, 180) if 24 in values else None,
        checksum_ok=True,
    )


def _ber_length(data: bytes) -> tuple[int, int]:
    if not data:
        raise KlvError("missing length")
    first = data[0]
    if first < 128:
        return first, 1
    count = first & 0x7F
    if count == 0 or 1 + count > len(data):
        raise KlvError("bad length")
    return int.from_bytes(data[1 : 1 + count], "big"), 1 + count


def encode_uas_datalink(sensor_lat: float, sensor_lon: float, time_us: int = 0) -> bytes:
    """Build a checksummed local set for tests and the sim video path."""

    def imap_encode(value: float, minimum: float, maximum: float, size: int) -> bytes:
        span = (1 << (8 * size)) - 1
        encoded = round((value - minimum) / (maximum - minimum) * span)
        return int(encoded).to_bytes(size, "big")

    chunks = [
        bytes([2, 8]) + time_us.to_bytes(8, "big"),
        bytes([13, 4]) + imap_encode(sensor_lat, -90, 90, 4),
        bytes([14, 4]) + imap_encode(sensor_lon, -180, 180, 4),
    ]
    body = b"".join(chunks)
    # Checksum covers the key, the length byte, and the body including tag 1 header,
    # but not the checksum value itself. We append tag 1 after computing.
    packet_wo = UAS_LOCAL_SET + bytes([len(body) + 4]) + body + bytes([1, 2])
    checksum = sum(packet_wo) & 0xFFFF
    return packet_wo + checksum.to_bytes(2, "big")
