"""JSON logs for a SIEM. Secrets and tokens are redacted."""

from __future__ import annotations

import logging
from typing import Any

import structlog

REDACT_KEYS = {
    "authorization",
    "cookie",
    "password",
    "token",
    "secret",
    "data_key",
    "session_secret",
}


def _redact(_: Any, __: str, event: dict[str, Any]) -> dict[str, Any]:
    for key in list(event):
        if key.lower() in REDACT_KEYS:
            event[key] = "[redacted]"
    return event


def setup_logging() -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            _redact,  # type: ignore[list-item]
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        cache_logger_on_first_use=True,
    )
