# ADR 0010: MediaMTX for video

Status: Accepted
Date: 2026-10-28

## Context

The platform must ingest about 200 full-motion streams, parse STANAG 4609 / MISB ST 0601 KLV at full rate, and show HLS to operators under a link budget.

## Decision

MediaMTX terminates RTSP and SRT. A separate parser process writes KLV metadata to the track bus. GStreamer is the transcode path when a consumer cannot take the source codec. HLS is produced only for streams the mission-aware video manager has allocated. The manager's inputs are mission state, which consumers asked, and the link budget.

## Consequences

Phase 4 work. Pixels are not stored in Postgres. A failed KLV checksum drops metadata for that frame and does not move the map. Nothing in this path is allowed to grow a weapons or effects command.
