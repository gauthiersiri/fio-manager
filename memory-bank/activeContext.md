# Active Context

_Last updated: after validating the in-cluster fallback `build-and-deploy.sh`._

## Current state
- Application is deployed on the cluster and working (namespace `fio-manager`, Route behind OAuth).
- The cluster currently runs the images built in-cluster by `deploy/build-and-deploy.sh` (Deployment points at `image-registry.openshift-image-registry.svc:5000/fio-manager/{fio-manager,fio-runner}:latest`). `./deploy/deploy.sh` switches back to the ghcr.io images.
- Backend API verified end to end via `deploy/api.sh`: storage-class listing, create/start/succeed on ceph-rbd, summary, time series, log and raw result download, stop on cephfs (RWX), delete (removes PVC + ConfigMap), validation errors, persistence across manager restart.
- 13 backend unit tests pass.
- No run resources are left on the cluster.
- Frontend migrated from IBM Carbon to Tailwind CSS v4 + shadcn-style components (`src/components/ui/`, Radix) + Recharts. `npm run build` passes (JS 202 kB + charts chunk 554 kB, CSS 28 kB, fonts bundled, no external URL in `dist/`). The new UI is now deployed (both the ghcr.io build and the in-cluster build include it). **The browser look has not been checked yet.**

## Immediate next steps
0. Code is on `gauthiersiri/fio-manager` (branch `main`). The workflow `build-images.yml` succeeded and `ghcr.io/gauthiersiri/fio-manager{,-runner}:latest` exist for amd64, arm64, ppc64le and s390x (anonymous pull works). Push with the SSH alias `git@github.com-ibm:...` (the default key belongs to another GitHub account). The cluster is deployed with `./deploy/deploy.sh`: the manager pod runs the ghcr.io image and a 10 s smoke run succeeded with the runner pulled from ghcr.io (run deleted afterwards; its summary was not read back). The cluster has only amd64 nodes, so the other architectures are built but not run-tested.
1. Open the Route in a browser and check Runs, RunForm, RunDetail (graphs, logs) and Compare. Fix visual or runtime issues. (The UI is already deployed.)
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
