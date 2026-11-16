#!/usr/bin/env bash
# FALLBACK: build both images in the cluster and (re)deploy from the internal registry.
# The default path is deploy/deploy.sh, which uses the ghcr.io images built by GitHub Actions.
# Requires: oc logged in, node/npm.
set -euo pipefail
cd "$(dirname "$0")/.."
NS="${FIO_NAMESPACE:-fio-manager}"

echo "==> Building frontend"
(cd frontend && npm ci --no-audit --no-fund && npm run build)

echo "==> Applying manifests"
oc apply -n "$NS" -f deploy/openshift.yaml
# Session secret for oauth-proxy (created once)
oc get secret fio-manager-proxy -n "$NS" >/dev/null 2>&1 || \
  oc create secret generic fio-manager-proxy -n "$NS" \
    --from-literal=session_secret="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"

echo "==> Building runner image"
oc start-build fio-runner -n "$NS" --from-dir=runner --follow

echo "==> Building manager image"
STAGE="$(mktemp -d)"
mkdir -p "$STAGE/backend" "$STAGE/frontend"
cp Containerfile "$STAGE/"
cp backend/requirements.txt "$STAGE/backend/"
cp -R backend/app "$STAGE/backend/app"
cp -R frontend/dist "$STAGE/frontend/dist"
find "$STAGE" -name __pycache__ -type d -prune -exec rm -rf {} +
oc start-build fio-manager -n "$NS" --from-dir="$STAGE" --follow
rm -rf "$STAGE"

echo "==> Pointing the Deployment at the in-cluster images (re-running deploy.sh or oc apply switches back to ghcr.io)"
REGISTRY="image-registry.openshift-image-registry.svc:5000/$NS"
oc set image deployment/fio-manager -n "$NS" manager="$REGISTRY/fio-manager:latest"
oc set env deployment/fio-manager -n "$NS" -c manager FIO_RUNNER_IMAGE="$REGISTRY/fio-runner:latest"

echo "==> Rolling out"
oc rollout restart deployment/fio-manager -n "$NS"
oc rollout status deployment/fio-manager -n "$NS" --timeout=180s
echo "URL: https://$(oc get route fio-manager -n "$NS" -o jsonpath='{.spec.host}')"
