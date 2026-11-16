#!/usr/bin/env python3
"""Runner entrypoint: run fio, stream progress to stdout, push results to the manager."""
import glob
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

RUN_ID = os.environ["FIO_RUN_ID"]
TOKEN = os.environ["FIO_RUN_TOKEN"]
MANAGER = os.environ["FIO_MANAGER_URL"].rstrip("/")
JOB_FILE = os.environ.get("FIO_JOB_FILE", "/config/job.fio")
WORK = os.environ.get("FIO_WORK_DIR", "/work")
DATA = os.environ.get("FIO_DATA_DIR", "/data")
PUSH_INTERVAL = float(os.environ.get("FIO_PUSH_INTERVAL", "5"))
RESULT = os.path.join(WORK, "result.json")


def log(msg: str) -> None:
    print(f"[runner] {msg}", flush=True)


def collect_logs() -> dict:
    out = {}
    for path in glob.glob(os.path.join(WORK, "*.log")):
        try:
            with open(path, "r", errors="replace") as f:
                out[os.path.basename(path)] = f.read()
        except OSError:
            pass
    return out


def push(result, retries: int = 1) -> bool:
    body = json.dumps({"result": result, "logs": collect_logs()}).encode()
    req = urllib.request.Request(
        f"{MANAGER}/internal/runs/{RUN_ID}/results", data=body, method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOKEN}"})
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=30):
                return True
        except urllib.error.HTTPError as exc:
            log(f"push failed: HTTP {exc.code} {exc.read()[:200]!r}")
            if exc.code in (403, 404, 409):
                return False
        except Exception as exc:  # noqa: BLE001
            log(f"push failed: {exc}")
        if attempt < retries:
            time.sleep(min(2 * attempt, 10))
    return False


def main() -> int:
    os.makedirs(WORK, exist_ok=True)
    os.chdir(WORK)
    log(f"run {RUN_ID}: job file {JOB_FILE}")
    with open(JOB_FILE) as f:
        print(f.read(), flush=True)

    stop = threading.Event()

    def periodic() -> None:
        while not stop.wait(PUSH_INTERVAL):
            push(None)

    threading.Thread(target=periodic, daemon=True).start()

    cmd = ["fio", JOB_FILE, "--output-format=json", f"--output={RESULT}",
           "--eta=always", "--eta-newline=5"]
    log("exec: " + " ".join(cmd))
    code = subprocess.call(cmd)
    stop.set()
    log(f"fio exited with code {code}")

    result = None
    if os.path.exists(RESULT):
        try:
            with open(RESULT) as f:
                text = f.read()
            # fio may print warnings before the JSON object.
            result = json.loads(text[text.index("{"):])
        except (ValueError, OSError) as exc:
            log(f"cannot parse fio result: {exc}")

    # Free space on the volume so a re-run starts clean.
    for path in glob.glob(os.path.join(DATA, "fio.*")):
        try:
            os.remove(path)
        except OSError:
            pass

    if code == 0 and result is None:
        code = 1
    if result is not None or code != 0:
        if not push(result, retries=5):
            log("WARNING: results could not be delivered to the manager")
    return code


if __name__ == "__main__":
    sys.exit(main())
