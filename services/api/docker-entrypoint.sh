#!/bin/sh
set -eu
python -m a2e.bootstrap
exec python -m uvicorn a2e.main:app --host 0.0.0.0 --port "${PORT:-8000}"
