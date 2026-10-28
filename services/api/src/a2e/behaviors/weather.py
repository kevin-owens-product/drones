"""GRIB2 reader for simple packing, and 3D avoidance volumes.

# STUB: complex packing templates, JPEG2000, and PNG packing are rejected.
Only GRIB edition 2, section 5 template 0 (simple packing) is decoded.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass


class GribError(ValueError):
    pass


@dataclass(frozen=True)
class ForecastField:
    parameter: str
    values: tuple[float, ...]
    ni: int
    nj: int


@dataclass(frozen=True)
class AvoidanceVolume:
    kind: str
    i0: int
    i1: int
    j0: int
    j1: int
    floor_m: float
    ceiling_m: float


def _read_uint(data: bytes, offset: int, size: int) -> int:
    chunk = data[offset : offset + size]
    if len(chunk) != size:
        raise GribError("truncated")
    return int.from_bytes(chunk, "big")


def parse_grib2(data: bytes) -> list[ForecastField]:
    if len(data) < 16 or data[:4] != b"GRIB" or data[7] != 2:
        raise GribError("not a GRIB2 message")
    if data[-4:] != b"7777":
        raise GribError("missing end section")
    total = _read_uint(data, 8, 8)
    if total != len(data):
        raise GribError("length mismatch")
    offset = 16
    parameter = "unknown"
    values: list[float] = []
    ni = nj = 0
    fields: list[ForecastField] = []
    while offset < len(data) - 4:
        length = _read_uint(data, offset, 4)
        number = data[offset + 4]
        body = offset + 5
        if number == 4 and length >= 11:
            parameter = f"cat-{data[body + 4]}-num-{data[body + 5]}"
        elif number == 5:
            count = _read_uint(data, body, 4)
            template = _read_uint(data, body + 4, 2)
            if template != 0:
                raise GribError("unsupported packing template")
            reference = struct.unpack(">f", data[body + 6 : body + 10])[0]
            binary_scale = struct.unpack(">h", data[body + 10 : body + 12])[0]
            decimal_scale = struct.unpack(">h", data[body + 12 : body + 14])[0]
            bits = data[body + 14]
            raw = data[body + 15 : offset + length]
            values = _unpack_simple(raw, count, bits, reference, binary_scale, decimal_scale)
            ni = count
            nj = 1
        elif number == 8 and values:
            fields.append(ForecastField(parameter, tuple(values), ni or len(values), nj or 1))
            parameter = "unknown"
            values = []
        offset += length
    if values:
        fields.append(ForecastField(parameter, tuple(values), ni or len(values), nj or 1))
    return fields


def _unpack_simple(
    raw: bytes,
    count: int,
    bits: int,
    reference: float,
    binary_scale: int,
    decimal_scale: int,
) -> list[float]:
    if bits == 0:
        scale = 10.0 ** (-decimal_scale)
        return [reference * scale for _ in range(count)]
    values: list[float] = []
    acc = 0
    acc_bits = 0
    index = 0
    for byte in raw:
        acc = (acc << 8) | byte
        acc_bits += 8
        while acc_bits >= bits and index < count:
            acc_bits -= bits
            unpacked = (acc >> acc_bits) & ((1 << bits) - 1)
            value = (reference + unpacked * (2.0**binary_scale)) / (10.0**decimal_scale)
            values.append(value)
            index += 1
    if index != count:
        raise GribError("value count mismatch")
    return values


def avoidance_volumes(
    field: ForecastField,
    *,
    kind: str,
    threshold: float,
    floor_m: float,
    ceiling_m: float,
) -> list[AvoidanceVolume]:
    volumes: list[AvoidanceVolume] = []
    width = max(field.ni, 1)
    for index, value in enumerate(field.values):
        if value < threshold:
            continue
        col = index % width
        row = index // width
        volumes.append(AvoidanceVolume(kind, col, col, row, row, floor_m, ceiling_m))
    return volumes


def build_simple_grib2(parameter_category: int, parameter_number: int, samples: list[int]) -> bytes:
    """Test helper. Writes one simple-packed field of small integers."""
    ref = struct.pack(">f", 0.0)
    payload = (
        struct.pack(">I", len(samples))
        + struct.pack(">H", 0)
        + ref
        + struct.pack(">hhB", 0, 0, 8)
        + bytes(sample & 0xFF for sample in samples)
    )
    section5 = struct.pack(">I", 5 + len(payload)) + b"\x05" + payload
    section4 = struct.pack(">I", 11) + bytes([4, 0, 0, 0, 0, parameter_category, parameter_number])
    body = section4 + section5
    total = 16 + len(body) + 4
    header = b"GRIB" + b"\x00\x00" + bytes([0, 2]) + struct.pack(">Q", total)
    return header + body + b"7777"
