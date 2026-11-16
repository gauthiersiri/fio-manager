"""Test fixtures: a fake Kube layer so the manager/API run without a cluster."""
import json
import sys
from pathlib import Path
from types import SimpleNamespace as NS

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_internal_app, create_public_app  # noqa: E402
from app.manager import Manager  # noqa: E402
from app.models import StorageClassInfo  # noqa: E402
from app.store import Store  # noqa: E402


class FakeKube:
    def __init__(self):
        self.pvcs, self.configmaps, self.jobs = {}, {}, {}
        self.job_state = {}   # job name -> "active" | "succeeded" | "failed"
        self.pod_phase = "Pending"
        self.log_text = "hello from fio\n"

    def list_storage_classes(self):
        return [StorageClassInfo(name="fast", provisioner="x.csi", is_default=True,
                                 allow_volume_expansion=True, volume_binding_mode="Immediate")]

    def ensure_pvc(self, run):
        self.pvcs[run.pvc_name] = run.spec.pvc_size_gi

    def apply_configmap(self, run):
        self.configmaps[run.id] = run.spec

    def create_job(self, run, token):
        self.jobs[run.job_name] = run.id
        self.job_state[run.job_name] = "active"
        self.token = token

    def get_job(self, name):
        if name not in self.jobs:
            return None
        st = self.job_state[name]
        return NS(status=NS(succeeded=1 if st == "succeeded" else 0,
                            failed=1 if st == "failed" else 0, conditions=[]))

    def delete_job(self, name):
        self.jobs.pop(name, None)

    def list_run_jobs(self, run_id):
        return [NS(metadata=NS(name=n)) for n, r in self.jobs.items() if r == run_id]

    def job_pod(self, job_name):
        if job_name not in self.jobs:
            return None
        return NS(metadata=NS(name=f"{job_name}-pod"),
                  status=NS(phase=self.pod_phase, conditions=[], container_statuses=[]))

    def pod_log(self, pod_name, tail=None):
        return self.log_text

    def delete_run_resources(self, run_id, pvc_name):
        for n in [n for n, r in self.jobs.items() if r == run_id]:
            self.jobs.pop(n)
        self.configmaps.pop(run_id, None)
        self.pvcs.pop(pvc_name, None)


@pytest.fixture
def kube():
    return FakeKube()


@pytest.fixture
def mgr(tmp_path, kube):
    return Manager(Store(tmp_path / "t.db"), kube)


@pytest.fixture
def client(mgr):
    return TestClient(create_public_app(mgr, start_reconciler=False))


@pytest.fixture
def internal(mgr):
    return TestClient(create_internal_app(mgr))


@pytest.fixture
def spec():
    return {
        "name": "t1", "storage_class": "fast", "pvc_size_gi": 10,
        "access_mode": "ReadWriteOnce", "volume_mode": "Filesystem",
        "profile": {"rw": "randrw", "rwmixread": 70, "bs": "4k", "iodepth": 8, "numjobs": 2,
                    "ioengine": "libaio", "direct": True},
        "file_size_gi": 1, "runtime_s": 10, "ramp_time_s": 0,
    }


FIO_RESULT = {"jobs": [{
    "job_runtime": 10000, "usr_cpu": 5.0, "sys_cpu": 3.0,
    "read": {"io_bytes": 104857600, "bw_bytes": 10485760, "iops": 2560.0,
             "lat_ns": {"mean": 800000.0},
             "clat_ns": {"percentile": {"50.000000": 700000, "90.000000": 1200000,
                                        "95.000000": 1500000, "99.000000": 2500000,
                                        "99.900000": 6000000}}},
    "write": {"io_bytes": 0},
}]}

FIO_LOGS = {
    "fio_iops.1.log": "1000, 100, 0, 4096, 0\n2000, 120, 0, 4096, 0\n",
    "fio_iops.2.log": "1000, 50, 0, 4096, 0\n2000, 60, 0, 4096, 0\n",
    "fio_bw.1.log": "1000, 2048, 0, 4096, 0\n2000, 4096, 0, 4096, 0\n",
    "fio_lat.1.log": "1000, 1000000, 0, 4096, 0\n2000, 2000000, 0, 4096, 0\n",
}
_ = json
