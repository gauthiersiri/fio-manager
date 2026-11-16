# Active Context

_Last updated: after the first push to GitHub and the first successful image build on ghcr.io._

## Current state
- Application is deployed on the cluster and working (namespace `fio-manager`, Route behind OAuth).
- Backend API verified end to end via `deploy/api.sh`: storage-class listing, create/start/succeed on ceph-rbd, summary, time series, log and raw result download, stop on cephfs (RWX), delete (removes PVC + ConfigMap), validation errors, persistence across manager restart.
- 13 backend unit tests pass.
- No run resources are left on the cluster.
- Frontend migrated from IBM Carbon to Tailwind CSS v4 + shadcn-style components (`src/components/ui/`, Radix) + Recharts. `npm run build` passes (JS 202 kB + charts chunk 554 kB, CSS 28 kB, fonts bundled, no external URL in `dist/`). **The new UI has not been redeployed and the browser look has not been checked.**

## Immediate next steps
0. Code is on `gauthiersiri/fio-manager` (branch `main`). The first workflow run succeeded, and `ghcr.io/gauthiersiri/fio-manager{,-runner}:latest` exist for amd64, arm64, ppc64le and s390x and can be pulled anonymously. Push with the SSH alias `git@github.com-ibm:...` (the default key belongs to another GitHub account). The cluster Deployment still points at the internal registry until `./deploy/deploy.sh` (or `oc apply`) is run.
1. Redeploy (frontend dist is copied into the manager image), then open the Route in a browser and check Runs, RunForm, RunDetail (graphs, logs) and Compare. Fix visual or runtime issues.
2. Run one more real fio run from the UI to check live progress and graphs.

## Backlog / ideas
- Block volume mode (needs `anyuid` or a privileged SCC for the runner, then lift the validation rejection).
- Run queueing and a concurrency limit.
- Postgres or HA, if more than one manager replica is wanted (SQLite on a PVC is single-writer).
- Cleanup/TTL policy for old runs.
- Prometheus `/metrics`.
- Remove or isolate the mock dev server.

## Open questions
None.
