"""Read a Betaflight blackbox log. The series is what the debrief plot draws."""

from __future__ import annotations

import re
from pathlib import Path
from typing import TypedDict

_NAME = re.compile(r"[A-Za-z0-9._-]+")
_FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "betaflight"

_SIGNED_VB = 0
_UNSIGNED_VB = 1
_TAG8_8SVB = 6
_TAG2_3S32 = 7
_TAG8_4S16 = 8
_NULL = 9


class BlackboxError(ValueError):
    pass


class _End(Exception):
    pass


class Summary(TypedDict):
    firmware: str
    frames: int
    duration_s: float


class _Reader:
    def __init__(self, data: bytes, offset: int) -> None:
        self.data = data
        self.i = offset

    def u8(self) -> int:
        if self.i >= len(self.data):
            raise _End
        value = self.data[self.i]
        self.i += 1
        return value

    def uvb(self) -> int:
        result = 0
        shift = 0
        while True:
            byte = self.u8()
            result |= (byte & 0x7F) << shift
            if byte < 128:
                return result
            shift += 7
            if shift > 28:
                raise BlackboxError("unsigned value is too wide")

    def svb(self) -> int:
        unsigned = self.uvb()
        return (unsigned >> 1) ^ -(unsigned & 1)

    def tag2_3s32(self) -> list[int]:
        selector = self.u8()
        kind = selector >> 6
        if kind == 0:
            return [_sign(selector >> 4, 2), _sign(selector >> 2, 2), _sign(selector, 2)]
        if kind == 1:
            second = self.u8()
            return [_sign(selector, 4), _sign(second >> 4, 4), _sign(second, 4)]
        if kind == 2:
            return [_sign(selector, 6), _sign(self.u8(), 8), _sign(self.u8(), 8)]
        field_sel = selector & 0x3F
        values: list[int] = []
        for _ in range(3):
            width = field_sel & 0x03
            field_sel >>= 2
            raw = 0
            for byte_i in range(width + 1):
                raw |= self.u8() << (8 * byte_i)
            values.append(_sign(raw, 8 * (width + 1)))
        return values

    def tag8_4s16(self) -> list[int]:
        selector = self.u8()
        values = [0, 0, 0, 0]
        nibble = -1
        for index in range(4):
            kind = selector & 0x03
            selector >>= 2
            if kind == 0:
                continue
            if kind == 1:
                if nibble < 0:
                    nibble = self.u8()
                    values[index] = _sign(nibble >> 4, 4)
                else:
                    values[index] = _sign(nibble, 4)
                    nibble = -1
            elif kind == 2:
                if nibble < 0:
                    values[index] = _sign(self.u8(), 8)
                else:
                    high = nibble & 0x0F
                    nibble = self.u8()
                    values[index] = _sign((high << 4) | (nibble >> 4), 8)
            else:
                if nibble < 0:
                    high = self.u8()
                    low = self.u8()
                    values[index] = _sign((high << 8) | low, 16)
                else:
                    top = nibble & 0x0F
                    mid = self.u8()
                    nibble = self.u8()
                    values[index] = _sign((top << 12) | (mid << 4) | (nibble >> 4), 16)
        return values

    def tag8_8svb(self, count: int) -> list[int]:
        if count == 1:
            return [self.svb()]
        header = self.u8()
        values: list[int] = []
        for index in range(count):
            if header & (1 << index):
                values.append(self.svb())
            else:
                values.append(0)
        return values


def _sign(value: int, bits: int) -> int:
    value &= (1 << bits) - 1
    sign = 1 << (bits - 1)
    if value & sign:
        return value - (1 << bits)
    return value


def _header(data: bytes) -> tuple[dict[str, str], dict[str, list[int]], int]:
    meta: dict[str, str] = {}
    fields: dict[str, list[int]] = {}
    names: dict[str, list[str]] = {}
    offset = 0
    while data[offset : offset + 2] == b"H ":
        newline = data.find(b"\n", offset)
        if newline < 0:
            raise BlackboxError("header does not end")
        line = data[offset:newline].decode("ascii")
        offset = newline + 1
        body = line[2:]
        key, _, value = body.partition(":")
        if key.startswith("Field "):
            kind, _, what = key.removeprefix("Field ").partition(" ")
            if what == "name":
                names[kind] = value.split(",")
            elif what == "encoding":
                fields[kind] = [int(item) for item in value.split(",") if item != ""]
            else:
                continue
        else:
            meta[key] = value
    if "P" in fields and "P" not in names and "I" in names:
        names["P"] = names["I"]
    for kind, encoding in fields.items():
        if kind in names and len(names[kind]) != len(encoding):
            raise BlackboxError(f"field {kind} name and encoding differ")
    return meta, fields, offset


def _read_encoded(reader: _Reader, encoding: list[int]) -> list[int]:
    values: list[int] = []
    index = 0
    while index < len(encoding):
        kind = encoding[index]
        if kind == _NULL:
            values.append(0)
            index += 1
        elif kind == _SIGNED_VB:
            values.append(reader.svb())
            index += 1
        elif kind == _UNSIGNED_VB:
            values.append(reader.uvb())
            index += 1
        elif kind == _TAG2_3S32:
            values.extend(reader.tag2_3s32())
            index += 3
        elif kind == _TAG8_4S16:
            values.extend(reader.tag8_4s16())
            index += 4
        elif kind == _TAG8_8SVB:
            count = 1
            while index + count < len(encoding) and encoding[index + count] == _TAG8_8SVB:
                count += 1
            values.extend(reader.tag8_8svb(count))
            index += count
        else:
            raise BlackboxError(f"encoding {kind} is not decoded")
    if len(values) != len(encoding):
        raise BlackboxError("decoded field count does not match the header")
    return values


def _apply_intra(raw: list[int], predictors: list[int], min_motor: int) -> list[int]:
    values = list(raw)
    for index, predictor in enumerate(predictors):
        if predictor == 0:
            continue
        if predictor == 11:
            values[index] = raw[index] + min_motor
        elif predictor == 5:
            values[index] = raw[index] + values[predictors.index(11)]
        else:
            raise BlackboxError(f"intra predictor {predictor} is not decoded")
    return values


def decode(path: str | Path) -> tuple[dict[str, str], list[str], list[list[int]]]:
    data = Path(path).read_bytes()
    meta, fields, offset = _header(data)
    if "I" not in fields:
        raise BlackboxError("log has no intra-frame fields")
    reader = _Reader(data, offset)
    names = _field_names(data)
    predictors = _predictors(data).get("I", [0] * len(fields["I"]))
    motor = meta.get("motorOutput", "0,0").split(",")
    min_motor = int(motor[0])
    frames: list[list[int]] = []
    try:
        while reader.i < len(data):
            marker = reader.u8()
            if marker == ord("I"):
                raw = _read_encoded(reader, fields["I"])
                frames.append(_apply_intra(raw, predictors, min_motor))
            elif marker == ord("P"):
                _read_encoded(reader, fields["P"])
            elif marker == ord("S"):
                _read_encoded(reader, fields["S"])
            elif marker == ord("G"):
                _read_encoded(reader, fields["G"])
            elif marker == ord("H"):
                _read_encoded(reader, fields["H"])
            elif marker == ord("E"):
                _skip_event(reader)
            else:
                break
    except _End:
        pass
    return meta, names, frames


def _field_names(data: bytes) -> list[str]:
    offset = 0
    while data[offset : offset + 2] == b"H ":
        newline = data.find(b"\n", offset)
        line = data[offset:newline].decode("ascii")
        offset = newline + 1
        if line.startswith("H Field I name:"):
            return line.split(":", 1)[1].split(",")
    raise BlackboxError("intra field names are missing")


def _predictors(data: bytes) -> dict[str, list[int]]:
    found: dict[str, list[int]] = {}
    offset = 0
    while data[offset : offset + 2] == b"H ":
        newline = data.find(b"\n", offset)
        line = data[offset:newline].decode("ascii")
        offset = newline + 1
        if line.startswith("H Field ") and " predictor:" in line:
            kind = line.split()[2]
            found[kind] = [int(item) for item in line.split(":", 1)[1].split(",") if item != ""]
    return found


def _skip_event(reader: _Reader) -> None:
    event = reader.u8()
    if event == 0:
        reader.uvb()
    elif event == 30:
        reader.uvb()
        reader.uvb()
    elif event == 15:
        reader.uvb()
    elif event == 14:
        reader.uvb()
        reader.uvb()
    elif event == 255:
        while reader.u8() != 0:
            pass
    elif event == 13:
        function = reader.u8()
        if function & 0x80:
            for _ in range(4):
                reader.u8()
        else:
            reader.svb()
    else:
        raise BlackboxError(f"event {event} is not decoded")


def summarize(path: str | Path) -> Summary:
    meta, names, frames = decode(path)
    time_i = names.index("time")
    duration_s = 0.0
    if frames:
        duration_s = (frames[-1][time_i] - frames[0][time_i]) / 1e6
    return {"firmware": meta.get("Firmware revision", ""), "frames": len(frames), "duration_s": duration_s}


def fixture_blackbox(name: str) -> Path | None:
    if _NAME.fullmatch(name) is None:
        return None
    root = _FIXTURES.resolve()
    candidate = (root / name).resolve()
    if root != candidate and root not in candidate.parents:
        return None
    if not candidate.is_file():
        return None
    return candidate


def plot_series(path: str | Path) -> dict[str, list[float]]:
    """Intra-frame time and roll gyro, in seconds from the first intra frame."""
    _meta, names, frames = decode(path)
    time_i = names.index("time")
    gyro_i = names.index("gyroADC[0]")
    start = frames[0][time_i] if frames else 0
    return {
        "t_s": [(frame[time_i] - start) / 1e6 for frame in frames],
        "gyro_roll": [float(frame[gyro_i]) for frame in frames],
    }
