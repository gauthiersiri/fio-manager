"""FastAPI applications.

Two apps are served by one process:
  * public app (port 8080): REST API + static UI, sits behind the OpenShift oauth-proxy
  * internal app (port 8081): only the runner results endpoint, token protected
"""
import asyncio
import logging
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import Body, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

from .config import settings
from .fio import PRESETS
from .kube import Kube, KubeError, load_config
from .manager import Conflict, Forbidden, Manager, NotFound
from .models import ResultsPush, Run, RunSpec, StorageClassInfo
from .store import Store

log = logging.getLogger("fio.api")


def _handle(exc: Exception) -> HTTPException:
    if isinstance(exc, NotFound):
        return HTTPException(404, str(exc))
    if isinstance(exc, Conflict):
        return HTTPException(409, str(exc))
    if isinstance(exc, Forbidden):
        return HTTPException(403, str(exc))
    if isinstance(exc, KubeError):
        return HTTPException(502, str(exc))
    raise exc


def create_public_app(mgr: Manager, static_dir: Optional[Path] = None,
                      start_reconciler: bool = True) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        stop = threading.Event()
        thread = None
        if start_reconciler:
            def loop() -> None:
                while not stop.wait(settings.reconcile_interval):
                    mgr.reconcile_all()
            thread = threading.Thread(target=loop, name="reconciler", daemon=True)
            thread.start()
        yield
        stop.set()

    app = FastAPI(title="FIO Manager", lifespan=lifespan)

    @app.exception_handler(NotFound)
    @app.exception_handler(Conflict)
    @app.exception_handler(Forbidden)
    @app.exception_handler(KubeError)
    async def _errors(_: Request, exc: Exception) -> JSONResponse:
        err = _handle(exc)
        return JSONResponse({"detail": err.detail}, status_code=err.status_code)

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/api/storageclasses", response_model=list[StorageClassInfo])
    def storage_classes():
        return mgr.kube.list_storage_classes()

    @app.get("/api/presets")
    def presets():
        return PRESETS

    @app.get("/api/runs", response_model=list[Run])
    def list_runs():
        return mgr.list()

    @app.post("/api/runs", response_model=Run, status_code=201)
    def create_run(spec: RunSpec):
        return mgr.create(spec)

    @app.get("/api/runs/{run_id}", response_model=Run)
    def get_run(run_id: str):
        return mgr.get(run_id)

    @app.put("/api/runs/{run_id}", response_model=Run)
    def update_run(run_id: str, spec: RunSpec):
        return mgr.update(run_id, spec)

    @app.delete("/api/runs/{run_id}", status_code=204)
    def delete_run(run_id: str):
        mgr.delete(run_id)
        return Response(status_code=204)

    @app.post("/api/runs/{run_id}/start", response_model=Run)
    def start_run(run_id: str):
        return mgr.start(run_id)

    @app.post("/api/runs/{run_id}/stop", response_model=Run)
    def stop_run(run_id: str):
        return mgr.stop(run_id)

    @app.get("/api/runs/{run_id}/logs")
    def run_logs(run_id: str, tail: Optional[int] = Query(None, ge=1)):
        return PlainTextResponse(mgr.logs(run_id, tail))

    @app.get("/api/runs/{run_id}/logs/download")
    def run_logs_download(run_id: str):
        run = mgr.get(run_id)
        fname = f"fio-{run.name}-{run.id}.log".replace(" ", "_")
        return PlainTextResponse(
            mgr.logs(run_id), headers={"Content-Disposition": f'attachment; filename="{fname}"'})

    @app.get("/api/runs/{run_id}/metrics")
    def run_metrics(run_id: str):
        return mgr.metrics(run_id)

    @app.get("/api/runs/{run_id}/results/download")
    def run_results_download(run_id: str):
        result = mgr.result(run_id)
        if result is None:
            raise HTTPException(404, "no results for this run")
        import json
        return Response(
            json.dumps(result, indent=2), media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="fio-{run_id}-result.json"'})

    @app.get("/api/compare")
    def compare(ids: str = Query(..., min_length=1)):
        return mgr.compare([i for i in ids.split(",") if i])

    if static_dir and (static_dir / "index.html").exists():
        if (static_dir / "assets").is_dir():
            app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")
        index = static_dir / "index.html"

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path.startswith("api/"):
                raise HTTPException(404, "not found")
            candidate = (static_dir / path).resolve()
            if path and candidate.is_file() and static_dir in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(index)

    return app


def create_internal_app(mgr: Manager) -> FastAPI:
    app = FastAPI(title="FIO Manager internal", docs_url=None, redoc_url=None, openapi_url=None)

    @app.post("/internal/runs/{run_id}/results", status_code=204)
    def push_results(run_id: str, payload: ResultsPush = Body(...),
                     authorization: str = Header("")):
        token = authorization.removeprefix("Bearer ").strip()
        try:
            mgr.accept_push(run_id, token, payload.result, payload.logs)
        except (NotFound, Conflict, Forbidden) as exc:
            raise _handle(exc)
        return Response(status_code=204)

    return app


async def _serve(app: FastAPI, host: str, port: int) -> None:
    server = uvicorn.Server(uvicorn.Config(app, host=host, port=port, log_level="info"))
    await server.serve()


def main() -> None:
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    load_config()
    store = Store(settings.data_dir / "fio-manager.db")
    mgr = Manager(store, Kube(settings.namespace))
    public = create_public_app(mgr, settings.static_dir)
    internal = create_internal_app(mgr)

    async def run_all() -> None:
        await asyncio.gather(
            _serve(public, settings.public_host, settings.public_port),
            _serve(internal, settings.internal_host, settings.internal_port))

    asyncio.run(run_all())


if __name__ == "__main__":
    main()
