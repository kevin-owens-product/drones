"""HLS playlist text for streams the video manager granted bandwidth."""

from __future__ import annotations


def playlist(stream_id: str, segments: list[tuple[float, str]]) -> str:
    lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:2", "#EXT-X-MEDIA-SEQUENCE:0"]
    for duration, name in segments:
        lines.append(f"#EXTINF:{duration:.3f},")
        lines.append(f"/v1/video/{stream_id}/{name}")
    lines.append("#EXT-X-ENDLIST")
    return "\n".join(lines) + "\n"
