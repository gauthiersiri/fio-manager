"""Run lifecycle: the single place that mutates run state (API calls + reconciler)."""
from __future__ import annotations

import hashlib
import json
import logging
import secrets
import threading
import uuid
from typing import Optional

from .fio import parse_metrics, parse_summary
from .kube import Kube, KubeError
from .models import ACTIVE_STATES, Run, RunSpec, utcnow
from .store import Store

log = logging.getLogger("fio.manager")


class Conflict(Exception):
    pass


class NotFound(Exception):
    pass


class Forbidden(Exception):
    pass


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Manager:
    def __init__(self, store: Store, kube: Kube) -> None:
        self.store = store
        self.kube = kube
        self.lock = threading.RLock()

    # ---- helpers ---------------------------------------------------------
    def _get(self, run_id: str) -> Run:
        run = self.store.get(run_id)
        if run is None:
            raise NotFound(f"run {run_id} not found")
        return run

    def get(self, run_id: str) -> Run:
        return self._get(run_id)

    def list(self) -> list[Run]:
        return self.store.list()

    # ---- CRUD ------------------------------------------------------------
    def create(self, spec: RunSpec) -> Run:
        run_id = uuid.uuid4().hex[:8]
        now = utcnow()
        run = Run(id=run_id, name=spec.name, spec=spec, pvc_name=f"fio-{run_id}-data",
                  job_name=f"fio-{run_id}", created_at=now, updated_at=now)
        with self.lock:
            self.store.insert(run)
        return run

    def update(self, run_id: str, spec: RunSpec) -> Run:
        with self.lock:
            run = self._get(run_id)
            if run.state in ACTIVE_STATES:
                raise Conflict("run is active; stop it before editing")
            self.store.update(run_id, name=spec.name, spec=spec.model_dump_json(),
                              updated_at=utcnow())
            return self._get(run_id)

    def delete(self, run_id: str) -> None:
        with self.lock:
            run = self._get(run_id)
            if run.state in ACTIVE_STATES:
                raise Conflict("run is active; stop it before deleting")
            self.kube.delete_run_resources(run.id, run.pvc_name)
            self.store.delete(run_id)

    # ---- start / stop ------------------------------------------------------
    def start(self, run_id: str) -> Run:
        with self.lock:
            run = self._get(run_id)
            if run.state in ACTIVE_STATES:
                raise Conflict("run is already active")
            attempt = run.attempt + 1
            job_name = f"fio-{run.id}-{attempt}"
            token = secrets.token_urlsafe(32)
            # Remove the previous attempt's job (its logs were stored when it finished).
            for job in self.kube.list_run_jobs(run.id):
                self.kube.delete_job(job.metadata.name)
            run = run.model_copy(update={"attempt": attempt, "job_name": job_name})
            try:
                self.kube.ensure_pvc(run)
                self.kube.apply_configmap(run)
                self.kube.create_job(run, token)
            except KubeError as exc:
                self.store.update(run_id, state="failed", message=str(exc),
                                  updated_at=utcnow(), finished_at=utcnow())
                raise
            now = utcnow()
            self.store.update(
                run_id, state="provisioning", message="Creating volume and pod", attempt=attempt,
                job_name=job_name, token_hash=_hash(token), updated_at=now,
                started_at=None, finished_at=None, summary=None, result=None,
                metrics=None, logs=None)
            return self._get(run_id)

    def stop(self, run_id: str) -> Run:
        with self.lock:
            run = self._get(run_id)
            if run.state not in ACTIVE_STATES:
                raise Conflict("run is not active")
            self._capture_logs(run)
            self.kube.delete_job(run.job_name)
            now = utcnow()
            self.store.update(run_id, state="stopped", message="Stopped by user",
                              updated_at=now, finished_at=now)
            return self._get(run_id)

    # ---- logs / metrics ----------------------------------------------------
    def _capture_logs(self, run: Run) -> None:
        try:
            pod = self.kube.job_pod(run.job_name)
            if pod is not None:
                text = self.kube.pod_log(pod.metadata.name)
                if text:
                    self.store.update(run.id, logs=text)
        except KubeError as exc:
            log.warning("could not capture logs for %s: %s", run.id, exc)

    def logs(self, run_id: str, tail: Optional[int] = None) -> str:
        run = self._get(run_id)
        if run.state in ACTIVE_STATES:
            pod = self.kube.job_pod(run.job_name)
            text = self.kube.pod_log(pod.metadata.name, tail) if pod else ""
        else:
            text = self.store.get_blob(run_id, "logs") or ""
            if tail:
                text = "\n".join(text.splitlines()[-tail:]) + ("\n" if text else "")
        # fio redraws its status line with carriage returns; make them real line breaks.
        return text.replace("\r\n", "\n").replace("\r", "\n")

    def metrics(self, run_id: str) -> Optional[dict]:
        self._get(run_id)
        return self.store.get_blob(run_id, "metrics")

    def result(self, run_id: str) -> Optional[dict]:
        self._get(run_id)
        return self.store.get_blob(run_id, "result")

    def compare(self, ids: list[str]) -> list[dict]:
        out = []
        for run_id in ids:
            run = self._get(run_id)
            out.append({"id": run.id, "name": run.name, "spec": run.spec.model_dump(),
                        "summary": run.summary, "metrics": self.store.get_blob(run.id, "metrics")})
        return out

    # ---- results pushed by the runner -------------------------------------
    def accept_push(self, run_id: str, token: str, result: Optional[dict],
                    logs: dict[str, str]) -> None:
        with self.lock:
            run = self.store.get(run_id)
            if run is None:
                raise NotFound("unknown run")
            expected = self.store.get_blob(run_id, "token_hash")
            if not expected or not secrets.compare_digest(expected, _hash(token)):
                raise Forbidden("invalid token")
            if run.state not in ACTIVE_STATES:
                raise Conflict("run is not active")
            fields: dict = {"updated_at": utcnow()}
            if logs:
                metrics = parse_metrics(logs)
                if metrics:
                    fields["metrics"] = json.dumps(metrics)
            if result is not None:
                try:
                    fields["summary"] = json.dumps(parse_summary(result, run.spec.profile.numjobs))
                except ValueError as exc:
                    raise Conflict(str(exc)) from exc
                fields["result"] = json.dumps(result)
            self.store.update(run_id, **fields)

    # ---- reconciliation ----------------------------------------------------
    def reconcile_all(self) -> None:
        for run in self.store.list():
            if run.state in ACTIVE_STATES:
                try:
                    self.reconcile(run.id)
                except Exception:  # noqa: BLE001
                    log.exception("reconcile failed for %s", run.id)

    def reconcile(self, run_id: str) -> None:
        with self.lock:
            run = self.store.get(run_id)
            if run is None or run.state not in ACTIVE_STATES:
                return
            job = self.kube.get_job(run.job_name)
            now = utcnow()
            if job is None:
                self.store.update(run_id, state="failed", message="Job no longer exists",
                                  updated_at=now, finished_at=now)
                return
            st = job.status
            if st.succeeded:
                self._capture_logs(run)
                has_summary = run.summary is not None or self.store.get_blob(run_id, "result")
                msg = "" if has_summary else "Job finished but no results were received"
                self.store.update(run_id, state="succeeded", message=msg,
                                  updated_at=now, finished_at=now)
                return
            if st.failed:
                self._capture_logs(run)
                self.store.update(run_id, state="failed", message=self._failure_message(run, job),
                                  updated_at=now, finished_at=now)
                return
            pod = self.kube.job_pod(run.job_name)
            if pod is None:
                self.store.update(run_id, message="Waiting for pod to be created", updated_at=now)
                return
            if pod.status.phase == "Running":
                fields = {"state": "running", "message": "", "updated_at": now}
                if run.started_at is None:
                    fields["started_at"] = now
                self.store.update(run_id, **fields)
            else:
                self.store.update(run_id, state="provisioning",
                                  message=self._pending_message(pod), updated_at=now)

    @staticmethod
    def _pending_message(pod) -> str:
        for cond in pod.status.conditions or []:
            if cond.type == "PodScheduled" and cond.status == "False" and cond.message:
                return cond.message
        for cs in pod.status.container_statuses or []:
            w = cs.state.waiting if cs.state else None
            if w and w.reason:
                return f"{w.reason}: {w.message}" if w.message else w.reason
        return "Waiting for pod to start"

    def _failure_message(self, run: Run, job) -> str:
        try:
            pod = self.kube.job_pod(run.job_name)
        except KubeError:
            pod = None
        if pod is not None:
            for cs in pod.status.container_statuses or []:
                t = cs.state.terminated if cs.state else None
                if t:
                    detail = t.message or t.reason or ""
                    return f"fio container exited with code {t.exit_code}. {detail}".strip()
        for cond in job.status.conditions or []:
            if cond.type == "Failed" and cond.message:
                return cond.message
        return "Job failed"
