#!/bin/sh
# Save the images and charts needed to install without a registry.
set -eu
cd "$(dirname "$0")/.."
out="${1:-airgap-bundle}"
mkdir -p "$out/images" "$out/charts" "$out/policies"
images="
a2e-api:latest
a2e-opa:latest
a2e-postgres:latest
a2e-gateway:latest
"
for image in $images; do
  safe=$(echo "$image" | tr '/:' '__')
  if docker image inspect "$image" >/dev/null 2>&1; then
    docker save "$image" -o "$out/images/${safe}.tar"
  else
    echo "skip missing image $image"
  fi
done
cp -R deploy/helm/a2e "$out/charts/a2e"
cp -R policies "$out/policies"
cp .env.example "$out/env.example"
cat > "$out/INSTALL.txt" <<'EOF'
Load images with: docker load -i images/<file>.tar
Install with: helm upgrade --install a2e charts/a2e -f your-values.yaml
Do not use values-dev.yaml on a real network.
This bundle does not call out to a SaaS endpoint.
EOF
echo "wrote $out"
