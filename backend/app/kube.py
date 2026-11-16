"""Thin wrapper around the Kubernetes API for everything FIO Manager creates."""
import logging
from typing import Optional

from kubernetes import client, config
from kubernetes.client.rest import ApiException

from .config import settings
from .fio import build_job_file
from .models import Run, StorageClassInfo

log = logging.getLogger("fio.kube")

LABEL_MANAGED = "app.kubernetes.io/managed-by"
LABEL_RUN = "fio-manager/run-id"
DEFAULT_SC_ANNOTATIONS = ("storageclass.kubernetes.io/is-default-class",
                          "storageclass.beta.kubernetes.io/is-default-class")
# Provisioners that are not volume provisioners for PVCs.
_EXCLUDED_PROVISIONERS = ("kubernetes.io/no-provisioner",)
_EXCLUDED_SUFFIXES = ("/bucket", "/obc")


class KubeError(Exception):
    """A Kubernetes API call failed; message is safe to show to the user."""


def _api_error(exc: ApiException) -> KubeError:
    reason = exc.reason
    if exc.body:
        try:
            import json
            reason = json.loads(exc.body).get("message", reason)
        except Exception:  # noqa: BLE001
            pass
    return KubeError(f"Kubernetes API error ({exc.status}): {reason}")


def load_config() -> None:
    try:
        config.load_incluster_config()
    except config.ConfigException:
        config.load_kube_config()


def labels_for(run: Run) -> dict:
    return {LABEL_MANAGED: "fio-manager", LABEL_RUN: run.id}


class Kube:
    def __init__(self, namespace: str) -> None:
        self.ns = namespace
        self.core = client.CoreV1Api()
        self.batch = client.BatchV1Api()
        self.storage = client.StorageV1Api()

    # ---- storage classes -------------------------------------------------
    def list_storage_classes(self) -> list[StorageClassInfo]:
        try:
            items = self.storage.list_storage_class().items
        except ApiException as exc:
            raise _api_error(exc) from exc
        out = []
        for sc in items:
            prov = sc.provisioner or ""
            if prov in _EXCLUDED_PROVISIONERS or prov.endswith(_EXCLUDED_SUFFIXES):
                continue
            ann = sc.metadata.annotations or {}
            out.append(StorageClassInfo(
                name=sc.metadata.name, provisioner=prov,
                is_default=any(ann.get(a) == "true" for a in DEFAULT_SC_ANNOTATIONS),
                allow_volume_expansion=bool(sc.allow_volume_expansion),
                volume_binding_mode=sc.volume_binding_mode or "Immediate"))
        return sorted(out, key=lambda s: s.name)

    # ---- PVC --------------------------------------------------------------
    def get_pvc(self, name: str):
        try:
            return self.core.read_namespaced_persistent_volume_claim(name, self.ns)
        except ApiException as exc:
            if exc.status == 404:
                return None
            raise _api_error(exc) from exc

    def ensure_pvc(self, run: Run) -> None:
        """Create the PVC if missing; recreate it if its definition no longer matches."""
        spec = run.spec
        existing = self.get_pvc(run.pvc_name)
        if existing is not None:
            same = (existing.spec.storage_class_name == spec.storage_class
                    and existing.spec.access_modes == [spec.access_mode]
                    and existing.spec.resources.requests.get("storage") == f"{spec.pvc_size_gi}Gi")
            if same:
                return
            self.delete_pvc(run.pvc_name)
            self._wait_pvc_gone(run.pvc_name)
        pvc = client.V1PersistentVolumeClaim(
            metadata=client.V1ObjectMeta(name=run.pvc_name, labels=labels_for(run)),
            spec=client.V1PersistentVolumeClaimSpec(
                storage_class_name=spec.storage_class,
                access_modes=[spec.access_mode],
                volume_mode=spec.volume_mode,
                resources=client.V1VolumeResourceRequirements(
                    requests={"storage": f"{spec.pvc_size_gi}Gi"})))
        try:
            self.core.create_namespaced_persistent_volume_claim(self.ns, pvc)
        except ApiException as exc:
            raise _api_error(exc) from exc

    def _wait_pvc_gone(self, name: str, timeout: float = 60.0) -> None:
        import time
        end = time.time() + timeout
        while time.time() < end:
            if self.get_pvc(name) is None:
                return
            time.sleep(1)
        raise KubeError(f"timed out waiting for PVC {name} to be deleted")

    def delete_pvc(self, name: str) -> None:
        try:
            self.core.delete_namespaced_persistent_volume_claim(name, self.ns)
        except ApiException as exc:
            if exc.status != 404:
                raise _api_error(exc) from exc

    # ---- ConfigMap + Job --------------------------------------------------
    def apply_configmap(self, run: Run) -> None:
        name = f"fio-{run.id}-cfg"
        cm = client.V1ConfigMap(
            metadata=client.V1ObjectMeta(name=name, labels=labels_for(run)),
            data={"job.fio": build_job_file(run.spec)})
        try:
            self.core.create_namespaced_config_map(self.ns, cm)
        except ApiException as exc:
            if exc.status != 409:
                raise _api_error(exc) from exc
            try:
                self.core.replace_namespaced_config_map(name, self.ns, cm)
            except ApiException as exc2:
                raise _api_error(exc2) from exc2

    def delete_configmap(self, run_id: str) -> None:
        try:
            self.core.delete_namespaced_config_map(f"fio-{run_id}-cfg", self.ns)
        except ApiException as exc:
            if exc.status != 404:
                raise _api_error(exc) from exc

    def create_job(self, run: Run, token: str) -> None:
        spec = run.spec
        labels = labels_for(run)
        container = client.V1Container(
            name="fio", image=settings.runner_image, image_pull_policy="Always",
            env=[client.V1EnvVar(name="FIO_RUN_ID", value=run.id),
                 client.V1EnvVar(name="FIO_RUN_TOKEN", value=token),
                 client.V1EnvVar(name="FIO_MANAGER_URL", value=settings.internal_url),
                 client.V1EnvVar(name="FIO_JOB_FILE", value="/config/job.fio")],
            volume_mounts=[client.V1VolumeMount(name="data", mount_path="/data"),
                           client.V1VolumeMount(name="config", mount_path="/config", read_only=True),
                           client.V1VolumeMount(name="work", mount_path="/work")],
            resources=client.V1ResourceRequirements(
                requests={"cpu": "500m", "memory": "512Mi"},
                limits={"cpu": "4", "memory": "4Gi"}),
            security_context=client.V1SecurityContext(
                allow_privilege_escalation=False, run_as_non_root=True,
                capabilities=client.V1Capabilities(drop=["ALL"]),
                seccomp_profile=client.V1SeccompProfile(type="RuntimeDefault")))
        pod_spec = client.V1PodSpec(
            restart_policy="Never", automount_service_account_token=False,
            containers=[container],
            volumes=[
                client.V1Volume(name="data", persistent_volume_claim=
                                client.V1PersistentVolumeClaimVolumeSource(claim_name=run.pvc_name)),
                client.V1Volume(name="config", config_map=
                                client.V1ConfigMapVolumeSource(name=f"fio-{run.id}-cfg")),
                client.V1Volume(name="work", empty_dir=client.V1EmptyDirVolumeSource())])
        job = client.V1Job(
            metadata=client.V1ObjectMeta(name=run.job_name, labels=labels),
            spec=client.V1JobSpec(
                backoff_limit=0,
                active_deadline_seconds=spec.runtime_s + spec.ramp_time_s + 1800,
                template=client.V1PodTemplateSpec(
                    metadata=client.V1ObjectMeta(labels=labels), spec=pod_spec)))
        try:
            self.batch.create_namespaced_job(self.ns, job)
        except ApiException as exc:
            raise _api_error(exc) from exc

    def get_job(self, name: str):
        try:
            return self.batch.read_namespaced_job(name, self.ns)
        except ApiException as exc:
            if exc.status == 404:
                return None
            raise _api_error(exc) from exc

    def delete_job(self, name: str) -> None:
        try:
            self.batch.delete_namespaced_job(
                name, self.ns, propagation_policy="Foreground",
                body=client.V1DeleteOptions(propagation_policy="Foreground"))
        except ApiException as exc:
            if exc.status != 404:
                raise _api_error(exc) from exc

    def list_run_jobs(self, run_id: str) -> list:
        try:
            return self.batch.list_namespaced_job(
                self.ns, label_selector=f"{LABEL_RUN}={run_id}").items
        except ApiException as exc:
            raise _api_error(exc) from exc

    # ---- pods / logs ------------------------------------------------------
    def job_pod(self, job_name: str):
        """Most recent pod of a job, or None."""
        try:
            pods = self.core.list_namespaced_pod(self.ns, label_selector=f"job-name={job_name}").items
        except ApiException as exc:
            raise _api_error(exc) from exc
        if not pods:
            return None
        return sorted(pods, key=lambda p: p.metadata.creation_timestamp)[-1]

    def pod_log(self, pod_name: str, tail: Optional[int] = None) -> str:
        try:
            return self.core.read_namespaced_pod_log(
                pod_name, self.ns, container="fio",
                tail_lines=tail) or ""
        except ApiException as exc:
            if exc.status in (400, 404):  # container not started yet / pod gone
                return ""
            raise _api_error(exc) from exc

    def delete_run_resources(self, run_id: str, pvc_name: str) -> None:
        for job in self.list_run_jobs(run_id):
            self.delete_job(job.metadata.name)
        self.delete_configmap(run_id)
        self.delete_pvc(pvc_name)
