# FIO Manager

Web application, running on OpenShift, to create, run, stop, monitor and delete [fio](https://fio.readthedocs.io) storage benchmarks. Each run gets its own PVC and Kubernetes Job. The UI shows live logs, lets you download them, and draws IOPS, bandwidth and latency graphs. Runs can be compared.

## Layout

| Path | Content |
|---|---|
| `backend/` | FastAPI app. `kube.py` is the Kubernetes layer, `manager.py` the run lifecycle and reconciler, `fio.py` the job file builder and result parser, `store.py` the SQLite persistence. |
| `frontend/` | React, TypeScript, Tailwind CSS v4, shadcn-style components (Radix UI) and Recharts. |
| `runner/` | Image run by each Job: fio plus `entrypoint.py`, which runs fio and pushes results and logs to the manager. |
| `deploy/` | `openshift.yaml` (all resources), `deploy.sh` (deploy the ghcr.io images), `build-and-deploy.sh` (in-cluster build fallback), `api.sh` (call the API from inside the pod). |
| `.github/workflows/` | `build-images.yml`: tests, then builds and publishes the images to ghcr.io. |
| `docs/api.md` | REST API contract. |

## How it works

1. The UI posts a run spec. The backend validates it and stores it in SQLite on a PVC (state `draft`).
2. **Start** creates the PVC (storage class, size and access mode from the spec), a ConfigMap holding the generated `job.fio`, and a Job. Each start is a new attempt.
3. The runner pod runs fio with 1-second averaged logs. It pushes progress and, at the end, the fio JSON to `POST /internal/runs/{id}/results` on a separate port (8081, per-run bearer token). The UI port is only reachable through the oauth-proxy.
4. A reconciler thread maps Job and Pod status to run state: `provisioning`, `running`, `succeeded`, `failed`, `stopped`. It also stores a copy of the pod log, so logs survive pod deletion.
5. **Stop** deletes the Job and keeps the PVC and any partial data. **Delete** removes the Job, ConfigMap, PVC and DB row.

Storage classes are listed live from the cluster. Provisioners that cannot provision PVCs (`no-provisioner`, bucket claims) are filtered out.

## Limits

- Volume mode is Filesystem only. Raw Block needs an extra SCC for the runner pod, so it is rejected for now.
- Everything runs in one namespace (the manager's own).
- One manager replica (SQLite on an RWO volume, `Recreate` strategy).
- Runs are not queued. Concurrent runs on the same backend will skew each other's results.

## Images (GitHub Actions + ghcr.io)

The workflow `.github/workflows/build-images.yml` runs the backend tests and the frontend typecheck/build, then builds two images for `linux/amd64`, `linux/arm64`, `linux/ppc64le` and `linux/s390x` (QEMU emulation for the non-native ones):

- `ghcr.io/gauthiersiri/fio-manager` (manager + UI)
- `ghcr.io/gauthiersiri/fio-manager-runner` (fio runner)

Pushes to `main` publish `latest` and `sha-<short>`; tags `v*` also publish semver tags. Pull requests build all platforms without pushing. The workflow only uses the automatic `GITHUB_TOKEN`, so there is no secret to configure.

One-time step: new ghcr.io packages are private. In GitHub, open each package (Package settings) and set the visibility to **Public**, so the cluster can pull without a pull secret.

## Deploy

```bash
oc login ...
oc project fio-manager
./deploy/deploy.sh                # applies the manifests (ghcr.io images) and rolls out
```

Fallback without ghcr.io (builds the UI and both images inside the cluster, then points the Deployment at the internal registry):

```bash
./deploy/build-and-deploy.sh
```

Running `deploy.sh` or `oc apply -f deploy/openshift.yaml` again switches back to the ghcr.io images.

The URL is printed at the end. Access goes through the OpenShift OAuth login, and any user who may `get` the `fio-manager` Service in the namespace is allowed.

The runner image is based on Fedora minimal, because fio is not in the UBI repositories.

## Develop

```bash
cd backend && python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest              # unit tests use a fake Kubernetes layer
cd ../frontend && npm install && npm run dev   # proxies /api to :8080 (npm run mock for a fake API)
```
