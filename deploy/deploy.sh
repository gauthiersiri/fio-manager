#!/usr/bin/env bash
# Deploy (or update) fio-manager using the images published on ghcr.io by the GitHub
# workflow (.github/workflows/build-images.yml). No build happens here.
# Requires: oc logged in. For a build inside the cluster instead, see build-and-deploy.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
NS="${FIO_NAMESPACE:-fio-manager}"

echo "==> Applying manifests"
oc apply -n "$NS" -f deploy/openshift.yaml
# Session secret for oauth-proxy (created once, generated locally, never stored in the repo)
oc get secret fio-manager-proxy -n "$NS" >/dev/null 2>&1 || \
  oc create secret generic fio-manager-proxy -n "$NS" \
    --from-literal=session_secret="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"

echo "==> Rolling out (imagePullPolicy is Always, so :latest is re-pulled)"
oc rollout restart deployment/fio-manager -n "$NS"
oc rollout status deployment/fio-manager -n "$NS" --timeout=180s
echo "URL: https://$(oc get route fio-manager -n "$NS" -o jsonpath='{.spec.host}')"
