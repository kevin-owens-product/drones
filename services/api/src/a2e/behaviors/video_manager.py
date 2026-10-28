"""Rank FMV streams and allocate a link budget. Pixels are not a weapons path."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class StreamNeed:
    stream_id: str
    bitrate_kbps: int
    mission_weight: float
    consumer_need: float


@dataclass(frozen=True)
class StreamGrant:
    stream_id: str
    bitrate_kbps: int
    score: float


def allocate_bandwidth(streams: list[StreamNeed], budget_kbps: int) -> list[StreamGrant]:
    if budget_kbps < 0:
        raise ValueError("budget must be non-negative")
    ranked = sorted(
        streams,
        key=lambda item: item.mission_weight * item.consumer_need,
        reverse=True,
    )
    granted: list[StreamGrant] = []
    left = budget_kbps
    for stream in ranked:
        score = stream.mission_weight * stream.consumer_need
        if stream.bitrate_kbps <= left and score > 0:
            granted.append(StreamGrant(stream.stream_id, stream.bitrate_kbps, score))
            left -= stream.bitrate_kbps
    return granted
