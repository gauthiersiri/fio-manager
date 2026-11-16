"""Pydantic models: the REST contract (see docs/api.md)."""
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

RunState = Literal["draft", "provisioning", "running", "succeeded", "failed", "stopped"]
ACTIVE_STATES = ("provisioning", "running")


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Profile(BaseModel):
    preset: Optional[str] = None
    rw: Literal["read", "write", "randread", "randwrite", "rw", "randrw"]
    rwmixread: int = Field(50, ge=0, le=100)
    bs: str = Field("4k", pattern=r"^[0-9]+[kKmM]$")
    iodepth: int = Field(32, ge=1, le=256)
    numjobs: int = Field(1, ge=1, le=64)
    ioengine: Literal["libaio", "psync", "sync"] = "libaio"
    direct: bool = True


class RunSpec(BaseModel):
    name: str = Field(min_length=1, max_length=63)
    storage_class: str = Field(min_length=1)
    pvc_size_gi: int = Field(ge=1, le=10000)
    access_mode: Literal["ReadWriteOnce", "ReadWriteMany", "ReadWriteOncePod"] = "ReadWriteOnce"
    # Only Filesystem is supported for now (Block needs extra SCC permissions).
    volume_mode: Literal["Filesystem"] = "Filesystem"
    profile: Profile
    file_size_gi: float = Field(gt=0)
    runtime_s: int = Field(ge=5, le=86400)
    ramp_time_s: int = Field(0, ge=0, le=3600)

    @model_validator(mode="after")
    def _check_capacity(self) -> "RunSpec":
        needed = self.file_size_gi * self.profile.numjobs
        if needed > 0.9 * self.pvc_size_gi:
            raise ValueError(
                f"file_size_gi * numjobs ({needed:g} GiB) must not exceed 90% of "
                f"pvc_size_gi ({self.pvc_size_gi} GiB)"
            )
        return self


class Run(BaseModel):
    id: str
    name: str
    state: RunState = "draft"
    message: str = ""
    spec: RunSpec
    attempt: int = 0
    pvc_name: str
    job_name: str
    created_at: str
    updated_at: str
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    has_results: bool = False
    summary: Optional[dict] = None


class StorageClassInfo(BaseModel):
    name: str
    provisioner: str
    is_default: bool
    allow_volume_expansion: bool
    volume_binding_mode: str


class ResultsPush(BaseModel):
    """Payload posted by the runner pod: periodic progress (result=None) and final results."""
    result: Optional[dict] = None
    logs: dict[str, str] = {}
