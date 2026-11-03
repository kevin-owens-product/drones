"""Where captured flight logs live.

An editable install finds them next to the source tree. A regular install
(the API image, CI) does not, so the directory can be set with
A2E_FLIGHT_LOG_DIR, and the working directory is tried last.
"""

from __future__ import annotations

import os
from pathlib import Path


def fixture_root(kind: str) -> Path:
    env = os.environ.get("A2E_FLIGHT_LOG_DIR")
    candidates = []
    if env:
        candidates.append(Path(env))
    candidates.append(Path(__file__).resolve().parents[3] / "tests" / "fixtures")
    candidates.append(Path.cwd() / "tests" / "fixtures")
    for base in candidates:
        if (base / kind).is_dir():
            return base / kind
    return candidates[0] / kind
