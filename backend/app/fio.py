"""fio job file generation, result summary and time-series parsing, presets."""
import re
from collections import defaultdict
from typing import Optional

from .models import RunSpec

LOG_PREFIX = "fio"  # fio writes <prefix>_bw.N.log, <prefix>_iops.N.log, <prefix>_lat.N.log

PRESETS = [
    {"id": "randread-4k", "label": "Random read 4k",
     "profile": {"rw": "randread", "rwmixread": 100, "bs": "4k", "iodepth": 32, "numjobs": 4,
                 "ioengine": "libaio", "direct": True}},
    {"id": "randwrite-4k", "label": "Random write 4k",
     "profile": {"rw": "randwrite", "rwmixread": 0, "bs": "4k", "iodepth": 32, "numjobs": 4,
                 "ioengine": "libaio", "direct": True}},
    {"id": "randrw-70-30-4k", "label": "Random read/write 70/30 4k",
     "profile": {"rw": "randrw", "rwmixread": 70, "bs": "4k", "iodepth": 32, "numjobs": 4,
                 "ioengine": "libaio", "direct": True}},
    {"id": "seqread-1m", "label": "Sequential read 1M",
     "profile": {"rw": "read", "rwmixread": 100, "bs": "1m", "iodepth": 16, "numjobs": 1,
                 "ioengine": "libaio", "direct": True}},
    {"id": "seqwrite-1m", "label": "Sequential write 1M",
     "profile": {"rw": "write", "rwmixread": 0, "bs": "1m", "iodepth": 16, "numjobs": 1,
                 "ioengine": "libaio", "direct": True}},
]


def build_job_file(spec: RunSpec, data_dir: str = "/data") -> str:
    """Render the fio job file from a validated spec (no free-form options accepted)."""
    p = spec.profile
    lines = [
        "[global]",
        f"directory={data_dir}",
        f"ioengine={p.ioengine}",
        f"direct={1 if p.direct else 0}",
        f"rw={p.rw}",
    ]
    if p.rw in ("rw", "randrw"):
        lines.append(f"rwmixread={p.rwmixread}")
    lines += [
        f"bs={p.bs}",
        f"iodepth={p.iodepth}",
        f"numjobs={p.numjobs}",
        f"size={max(1, int(spec.file_size_gi * 1024))}m",
        "time_based=1",
        f"runtime={spec.runtime_s}",
        f"ramp_time={spec.ramp_time_s}",
        "group_reporting=1",
        f"write_bw_log={LOG_PREFIX}",
        f"write_iops_log={LOG_PREFIX}",
        f"write_lat_log={LOG_PREFIX}",
        "log_avg_msec=1000",
        "",
        "[fio]",
        "",
    ]
    return "\n".join(lines)


def _pct(percentiles: dict, wanted: float) -> Optional[float]:
    for key, value in percentiles.items():
        try:
            if abs(float(key) - wanted) < 1e-6:
                return value / 1000.0  # ns -> us
        except ValueError:
            continue
    return None


def _direction_summary(d: dict) -> Optional[dict]:
    if not d or not d.get("io_bytes"):
        return None
    pct = (d.get("clat_ns") or {}).get("percentile") or {}
    lat_mean_ns = (d.get("lat_ns") or d.get("clat_ns") or {}).get("mean")
    bw_bytes = d.get("bw_bytes")
    if bw_bytes is None:
        bw_bytes = d.get("bw", 0) * 1024
    return {
        "iops": d.get("iops", 0.0),
        "bw_mibs": bw_bytes / 1048576.0,
        "io_mib": d["io_bytes"] / 1048576.0,
        "lat_mean_us": lat_mean_ns / 1000.0 if lat_mean_ns is not None else None,
        "lat_p50_us": _pct(pct, 50.0),
        "lat_p90_us": _pct(pct, 90.0),
        "lat_p95_us": _pct(pct, 95.0),
        "lat_p99_us": _pct(pct, 99.0),
        "lat_p99_9_us": _pct(pct, 99.9),
    }


def parse_summary(result: dict, numjobs: int = 1) -> dict:
    """Reduce the fio JSON output (group_reporting => one job entry) to the summary.

    With group_reporting fio sums job_runtime over the jobs, hence the division.
    """
    jobs = result.get("jobs") or []
    if not jobs:
        raise ValueError("fio result contains no jobs")
    job = jobs[0]
    return {
        "runtime_s": job.get("job_runtime", 0) / 1000.0 / max(numjobs, 1),
        "cpu_usr": job.get("usr_cpu"),
        "cpu_sys": job.get("sys_cpu"),
        "read": _direction_summary(job.get("read")),
        "write": _direction_summary(job.get("write")),
    }


_LOG_RE = re.compile(r"_(bw|iops|lat)\.\d+\.log$")


def parse_metrics(logs: dict[str, str]) -> Optional[dict]:
    """Aggregate fio per-job logs into one time series per direction.

    Log line: ``msec, value, direction, blocksize, offset``. With log_avg_msec=1000
    there is about one line per second per job and direction.
    bw (KiB/s) and iops are summed across jobs; latency (ns) is averaged.
    """
    # kind -> direction -> bucket -> list of values
    data: dict = {k: {0: defaultdict(list), 1: defaultdict(list)} for k in ("bw", "iops", "lat")}
    for name, text in logs.items():
        m = _LOG_RE.search(name)
        if not m:
            continue
        kind = m.group(1)
        # per-file: keep one value per (direction, bucket)
        seen: dict = {}
        for line in text.splitlines():
            parts = [x.strip() for x in line.split(",")]
            if len(parts) < 3:
                continue
            try:
                msec, value, direction = float(parts[0]), float(parts[1]), int(parts[2])
            except ValueError:
                continue
            if direction not in (0, 1):
                continue
            seen[(direction, int(round(msec / 1000.0)))] = value
        for (direction, bucket), value in seen.items():
            data[kind][direction][bucket].append(value)

    buckets = sorted({b for kind in data.values() for d in kind.values() for b in d})
    if not buckets:
        return None

    def series(direction: int) -> Optional[dict]:
        if not any(data[k][direction] for k in data):
            return None
        out = {"iops": [], "bw_mibs": [], "lat_us": []}
        for b in buckets:
            iops = data["iops"][direction].get(b)
            bw = data["bw"][direction].get(b)
            lat = data["lat"][direction].get(b)
            out["iops"].append(sum(iops) if iops else None)
            out["bw_mibs"].append(sum(bw) / 1024.0 if bw else None)
            out["lat_us"].append(sum(lat) / len(lat) / 1000.0 if lat else None)
        return out

    return {"time": buckets, "read": series(0), "write": series(1)}
