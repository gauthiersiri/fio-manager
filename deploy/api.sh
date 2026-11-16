#!/usr/bin/env bash
# Call the manager API from inside its pod (bypasses oauth-proxy and port-forward).
# usage: deploy/api.sh METHOD PATH [JSON_BODY_FILE]
set -euo pipefail
NS="${FIO_NAMESPACE:-fio-manager}"
BODY=""
[ -n "${3:-}" ] && BODY="$(cat "$3")"
oc exec -n "$NS" deploy/fio-manager -c manager -- python -c '
import sys, urllib.request, urllib.error
m, p, b = sys.argv[1], sys.argv[2], sys.argv[3]
req = urllib.request.Request("http://127.0.0.1:8080" + p, method=m,
      data=b.encode() if b else None, headers={"Content-Type": "application/json"})
try:
    r = urllib.request.urlopen(req, timeout=60); code = r.status; out = r.read().decode()
except urllib.error.HTTPError as e:
    code = e.code; out = e.read().decode()
sys.stdout.write(out)
sys.stderr.write("HTTP %d\n" % code)
' "$1" "$2" "$BODY"
