#!/bin/sh
# CycloneDX SBOM for the API image dependencies. Image signing is cosign, when a key is present.
set -eu
cd "$(dirname "$0")/.."
mkdir -p sbom
python -m pip install --quiet cyclonedx-bom
cyclonedx-py environment --output-format JSON --outfile sbom/a2e-api.cdx.json || \
  cyclonedx-py environment -o sbom/a2e-api.cdx.json
echo "wrote sbom/a2e-api.cdx.json"
if command -v syft >/dev/null 2>&1 && docker image inspect a2e-api >/dev/null 2>&1; then
  syft a2e-api -o cyclonedx-json > sbom/a2e-api-image.cdx.json
fi
if command -v cosign >/dev/null 2>&1 && [ -n "${COSIGN_KEY:-}" ]; then
  cosign sign --key "$COSIGN_KEY" "${IMAGE:-a2e-api:latest}"
else
  echo "cosign key not set; image not signed (see .github/workflows/ci.yml)"
fi
