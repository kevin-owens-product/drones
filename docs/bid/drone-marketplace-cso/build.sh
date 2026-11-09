#!/usr/bin/env bash
# Build the submission PDF from solution-brief.md: 12-point serif, 1-inch margins, US Letter.
# Usage: ./build.sh [source.md] [out.pdf]
# Needs pandoc and Chromium (Playwright's or system). The page check at the end
# counts pages: the title page and the IP statement do not count, so the PDF
# must be at most 7 pages (1 title + 5 body + 1 IP).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/solution-brief.md}"
out="${2:-$here/out/solution-brief.pdf}"
mkdir -p "$(dirname "$out")"
html="$(dirname "$out")/solution-brief.html"
pandoc "$src" --standalone --embed-resources --resource-path="$here" \
  --css="$here/print.css" --metadata pagetitle="Solution Brief" -o "$html"
node "$here/print.mjs" "$html" "$out"
if grep -v '^Do not\|^SOURCE\|^are Kevin' "$src" | grep -q '\[\['; then
  echo "WARNING: $src still has [[placeholders]]; do not submit this PDF:" >&2
  grep -v '^are Kevin' "$src" | grep -o '\[\[[^]]*\]\]' | sort -u >&2
fi
