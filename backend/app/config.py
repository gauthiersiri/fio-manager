"""Runtime configuration, read from environment variables."""
import os
from pathlib import Path

_NS_FILE = Path("/var/run/secrets/kubernetes.io/serviceaccount/namespace")


def _detect_namespace() -> str:
    if os.environ.get("FIO_NAMESPACE"):
        return os.environ["FIO_NAMESPACE"]
    if _NS_FILE.exists():
        return _NS_FILE.read_text().strip()
    return "fio-manager"


class Settings:
    def __init__(self) -> None:
        env = os.environ.get
        self.data_dir = Path(env("FIO_DATA_DIR", "./data")).resolve()
        self.namespace = _detect_namespace()
        self.runner_image = env("FIO_RUNNER_IMAGE", "fio-runner:latest")
        # URL the runner pods use to push results (internal Service, port below).
        self.internal_url = env("FIO_INTERNAL_URL", "http://fio-manager-internal:8081")
        self.public_host = env("FIO_PUBLIC_HOST", "0.0.0.0")
        self.public_port = int(env("FIO_PUBLIC_PORT", "8080"))
        self.internal_host = env("FIO_INTERNAL_HOST", "0.0.0.0")
        self.internal_port = int(env("FIO_INTERNAL_PORT", "8081"))
        self.static_dir = Path(env("FIO_STATIC_DIR", "./static")).resolve()
        self.reconcile_interval = float(env("FIO_RECONCILE_INTERVAL", "3"))


settings = Settings()
