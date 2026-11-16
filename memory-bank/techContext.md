# Tech Context

## Stack
| Layer | Tech |
|---|---|
| Backend | Python (3.12 in the image), FastAPI, uvicorn, `kubernetes` client (>=30,<36), pydantic v2, SQLite (stdlib) |
| Frontend | React 18, TypeScript, Vite 5, Tailwind CSS v4, Radix UI, Recharts, Node 22 for builds |
| Runner | Fedora minimal, `fio` + `fio-engine-libaio`, `python3`, `entrypoint.py` |
| Manager image | UBI python-312 (`Containerfile` at repo root), copies `backend/app` + `frontend/dist` |
| Auth | `openshift/oauth-proxy:v4.4` sidecar (ImageStream already on the cluster) |

## Environment variables (`backend/app/config.py`)
| Var | Default | Purpose |
|---|---|---|
| `FIO_NAMESPACE` | SA namespace file, else `fio-manager` | Namespace for all resources |
| `FIO_RUNNER_IMAGE` | `fio-runner:latest` | Image used by Jobs |
| `FIO_INTERNAL_URL` | `http://fio-manager-internal:8081` | URL runners push to |
| `FIO_PUBLIC_HOST` / `FIO_PUBLIC_PORT` | `0.0.0.0` / `8080` | UI + API (behind oauth-proxy) |
| `FIO_INTERNAL_HOST` / `FIO_INTERNAL_PORT` | `0.0.0.0` / `8081` | Runner push API (per-run bearer token) |
| `FIO_DATA_DIR` | `./data` | SQLite + result/log storage (PVC in cluster) |
| `FIO_STATIC_DIR` | `./static` | Built frontend |
| `FIO_RECONCILE_INTERVAL` | `3` (s) | Reconciler loop period |

## Cluster facts
- OpenShift 4.21.24, namespace `fio-manager`. API URL, user and password are **not stored in this repo**. `oc` is expected to be logged in (ask the user for the cluster URL and credentials each session).
- Route: `https://fio-manager-<namespace>.apps.<cluster-domain>` (get it with `oc get route fio-manager -n fio-manager -o jsonpath='{.spec.host}'`).
- Storage classes: `ocs-storagecluster-ceph-rbd` (default), `ocs-storagecluster-cephfs`, `ocs-storagecluster-ceph-nfs`, `ocs-storagecluster-ceph-rbd-virtualization`, `lvms-hcp-etcd`, `san-myfs`, `san-myfs-vm`.

## Build & deploy
Default: images are built by GitHub Actions (`.github/workflows/build-images.yml`, 4 platforms: amd64, arm64, ppc64le, s390x) and published to `ghcr.io/gauthiersiri/fio-manager` and `ghcr.io/gauthiersiri/fio-manager-runner` (public packages, no pull secret). `deploy/openshift.yaml` points at them. Deploy with `./deploy/deploy.sh` (apply + rollout restart, no build).

Fallback: images built in-cluster (binary BuildConfigs), because there is no local Podman.
- Full: `./deploy/build-and-deploy.sh` (frontend build, apply manifests, build runner, build manager, repoint the Deployment at the internal registry, rollout). Each image build is about 1 min, so total can exceed a 270 s tool timeout. Run it in the background or step by step. A later `deploy.sh` or `oc apply` switches back to ghcr.io.
- Validated on 2026-11-16: `build-and-deploy.sh` ran end to end in the background (about 3 min in total): frontend build, both in-cluster builds pushed, Deployment repointed at the internal registry, rollout done, `/api/health` returned 200. It needs no commit, no push and no GitHub Action: it uploads the local working tree. Caveats: it builds for the cluster architecture only (amd64), it runs `oc apply` first (which resets the images to ghcr.io) and then `oc set image`/`oc set env`, so there can be an extra rollout, and no fio run was started with the in-cluster runner image.
- Manual runner rebuild: `oc start-build fio-runner -n fio-manager --from-dir=runner --follow`
- Manual manager rebuild: stage `Containerfile`, `backend/requirements.txt`, `backend/app`, `frontend/dist` in a temp dir, then `oc start-build fio-manager -n fio-manager --from-dir=<dir> --follow` and `oc rollout restart deployment/fio-manager -n fio-manager`.
- Call the API: `deploy/api.sh METHOD PATH [bodyfile]`. It runs curl inside the manager pod through `oc exec`.

## Dev setup
- Backend tests: `cd backend && pip install -r requirements-dev.txt && pytest` (13 tests, fake Kubernetes layer).
- Frontend: `cd frontend && npm ci && npm run dev` (Vite). `npm run mock` starts a mock API (`mock/server.mjs`). `npm run build` outputs `dist/`.
- API contract: `docs/api.md`.

## Constraints and gotchas
- No Podman locally, so in-cluster builds only.
- `oc port-forward` is flaky ("lost connection to pod"). Use `oc exec` or the Route.
- Local Python is 3.14, image is 3.12. Keep `from __future__ import annotations` in `manager.py` and `store.py`. Test with the 3.12 behavior in mind.
- fio is not in UBI repos, so the runner is Fedora. The libaio engine is a separate package, `fio-engine-libaio`.
- With `group_reporting`, fio's `job_runtime` is summed across jobs, so the manager divides by `numjobs`.
- fio status lines use `\r`. The manager converts them to `\n` when reading logs.
- Block volume mode is rejected by validation for now (needs an SCC for the runner).
- The workspace is not a git repo. Writing `.gitignore` through the editor tool is blocked, so the user must create it.
