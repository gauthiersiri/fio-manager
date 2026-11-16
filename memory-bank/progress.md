# Progress

## Completed
- Architecture and decisions agreed with the user (see `systemPatterns.md`).
- Backend: FastAPI app on two ports (public 8080 behind oauth-proxy, internal 8081 for runner pushes with a per-run bearer token), SQLite store, Kubernetes layer, manager with reconciler thread.
- Runner image and `entrypoint.py`: runs fio, pushes progress every 5 s, pushes final results with retries.
- Frontend (React/TS/Tailwind): Runs list, create/edit form, run detail with graphs and logs, Compare page.
- Deployment manifests: ImageStreams, BuildConfigs, RBAC, PVC, Deployment (manager + oauth-proxy), 2 Services, Route, NetworkPolicy.
- Scripts: `deploy/deploy.sh` (ghcr.io images), `deploy/build-and-deploy.sh` (in-cluster fallback), `deploy/api.sh`.
- GitHub repo `gauthiersiri/fio-manager` (public) with workflow `.github/workflows/build-images.yml` (tests, frontend build, multi-arch images to ghcr.io).
- Docs: `README.md`, `docs/api.md`, this memory bank.
- 13 unit tests with a fake Kubernetes layer.
- Cluster validation of the API (see `activeContext.md`).

## Decision log
| Decision | Reason |
|---|---|
| "Mode" = access mode (RWO/RWX/RWOP) + volume mode (Filesystem/Block) | User-confirmed |
| Single namespace `fio-manager` | Simpler RBAC; user-confirmed |
| SQLite on a PVC | Enough for a single replica; user-confirmed |
| Python/FastAPI backend | User-confirmed |
| Filesystem mode first, Block deferred | Block needs an SCC for the runner |
| Images built by GitHub Actions and hosted on ghcr.io (amd64, arm64, ppc64le, s390x), used by default | User-confirmed; public repo and packages, no pull secret |
| In-cluster builds (binary BuildConfig) kept as fallback | No local Podman VM; user-confirmed to keep both |
| Never commit secrets or cluster identifiers (API URL, user, route host) | Repo is public; `.gitignore` excludes `.env*`, keys, kubeconfig |
| Runner pushes results to an internal port with per-run token | Keeps runner off the OAuth path and avoids shared storage |
| API tested through `oc exec` | `oc port-forward` is unreliable |
| Fedora minimal runner | fio is not in UBI repos |

## Lessons learned
- Python 3.14 locally hid a `list[str]` annotation crash that appeared on 3.12 in the cluster. Fixed with `from __future__ import annotations` in `manager.py` and `store.py`.
- `fio-engine-libaio` is a separate package. Without it the libaio engine fails.
- `job_runtime` is summed across jobs with `group_reporting`. The manager divides by `numjobs`.
- fio status uses `\r`. Convert to `\n` when serving logs.
- Sample result: 20 s randrw 4k on ceph-rbd gave about 3.7k read and 1.6k write IOPS.

- Frontend UI library switched from Carbon to Tailwind v4 + shadcn-style components + Recharts (air-gapped friendly: bundled fonts, no CDN).
