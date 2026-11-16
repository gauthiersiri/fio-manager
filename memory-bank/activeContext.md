# Active Context

_Last updated: after adding the GitHub repo, `.gitignore` and the ghcr.io image workflow (not yet pushed or run)._

## Current state
- Application is deployed on the cluster and working (namespace `fio-manager`, Route behind OAuth).
- Backend API verified end to end via `deploy/api.sh`: storage-class listing, create/start/succeed on ceph-rbd, summary, time series, log and raw result download, stop on cephfs (RWX), delete (removes PVC + ConfigMap), validation errors, persistence across manager restart.
- 13 backend unit tests pass.
- No run resources are left on the cluster.
- Frontend migrated from IBM Carbon to Tailwind CSS v4 + shadcn-style components (`src/components/ui/`, Radix) + Recharts. `npm run build` passes (JS 202 kB + charts chunk 554 kB, CSS 28 kB, fonts bundled, no external URL in `dist/`). **The new UI has not been redeployed and the browser look has not been checked.**

## Immediate next steps
0. Publish: user reviews the file list, then first commit and `git push -u origin main` to `git@github.com:gauthiersiri/fio-manager.git`. Check the first Actions run (multi-arch builds through QEMU can be slow), set both ghcr.io packages to Public, then `./deploy/deploy.sh`. The cluster Deployment still points at the internal registry until `deploy.sh`/`oc apply` is run.
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
