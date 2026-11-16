# AGENTS.md

This file provides guidance to agents when working with code in this repository.

Read `memory-bank/` first (architecture, decisions, current state). If code and memory bank disagree, trust the code, then fix the memory bank. Update `memory-bank/activeContext.md` and `progress.md` at the end of a session. Never write credentials (cluster password) into any repo file.

## Commands
- Backend tests (run from `backend/`): `pytest` · single test: `pytest tests/test_api.py::test_name -q`. There is no linter or formatter configured. Local venv: `/tmp/fiovenv` (may be gone; `pip install -r requirements-dev.txt`).
- Frontend (from `frontend/`): `npm run build` runs `tsc --noEmit` before vite, so it is the typecheck. There are no frontend tests. `npm run mock` starts a mock API (`mock/server.mjs`) and `npm run dev` proxies `/api` to `localhost:8080`.
- Deploy: images are built by GitHub Actions and hosted on ghcr.io (multi-arch), so deploy with `./deploy/deploy.sh`. Fallback: `./deploy/build-and-deploy.sh` builds in-cluster with binary BuildConfigs (no local Podman); it takes more than 270 s, so run it in the background or step by step (see `memory-bank/techContext.md`).
- Public repo: never commit secrets or cluster identifiers (API URL, user, route host). `.gitignore` now exists at the repo root.
- Call the live API with `deploy/api.sh METHOD PATH [bodyfile]`. It runs curl inside the pod via `oc exec`. `oc port-forward` is flaky here, so don't use it.

## Code gotchas
- Local Python is 3.14 but the image is 3.12. Keep `from __future__ import annotations` in `backend/app/manager.py` and `store.py`, because 3.14 hid a `list[str]` crash. Don't rely on 3.13+ features.
- `Manager` (`manager.py`) is the only place that mutates run state. It is shared by API handlers and the reconciler thread, guarded by `self.lock` (RLock). New state transitions go there, not in `main.py`.
- Errors: manager raises `NotFound`, `Conflict` and `Forbidden`. `KubeError` comes from `kube.py`. `main.py` maps them to HTTP status codes through exception handlers. Don't raise `HTTPException` in the manager.
- Active states are `ACTIVE_STATES = ("provisioning", "running")` in `models.py`. Edit and delete are refused while active (`Conflict`).
- Two FastAPI apps: public (8080, behind oauth-proxy, `/api/*`) and internal (8081, `/internal/runs/{id}/results`, runner pushes with a per-run bearer token whose SHA-256 is stored). Keep the internal port off the Route.
- Tests use `FakeKube` in `backend/tests/conftest.py`. When you add a method to `kube.py` that the manager calls, add it to `FakeKube` too. The reconciler is disabled with `create_public_app(mgr, start_reconciler=False)`, so tests call `mgr.reconcile()` directly.
- `volume_mode` is `Literal["Filesystem"]` in `models.py`. Block is deliberately rejected (needs an SCC for the runner). Enabling it means a model change, an SCC and runner changes.
- fio quirks: with `group_reporting`, `job_runtime` is summed over jobs, so `parse_summary(result, numjobs)` divides it. Status lines use `\r`, which `Manager.logs()` converts to `\n`.
- The runner image is Fedora minimal, not UBI (fio is not in the UBI repos), and it needs `fio-engine-libaio` separately.
- The manager image copies `frontend/dist`, so rebuild the frontend before building the manager image.
- `.gitignore` can't be written with the editor tools, so create or change it with a shell command.
