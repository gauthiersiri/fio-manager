from app.fio import build_job_file, parse_metrics, parse_summary
from app.models import RunSpec

from .conftest import FIO_LOGS, FIO_RESULT


def test_job_file(spec):
    text = build_job_file(RunSpec(**spec))
    assert "rw=randrw" in text and "rwmixread=70" in text
    assert "numjobs=2" in text and "size=1024m" in text and "runtime=10" in text
    assert "directory=/data" in text and "log_avg_msec=1000" in text


def test_job_file_no_mix_for_plain_read(spec):
    spec["profile"]["rw"] = "randread"
    assert "rwmixread" not in build_job_file(RunSpec(**spec))


def test_summary():
    s = parse_summary(FIO_RESULT)
    assert s["write"] is None
    assert s["read"]["iops"] == 2560.0
    assert abs(s["read"]["bw_mibs"] - 10.0) < 1e-6
    assert s["read"]["lat_p99_us"] == 2500.0 and s["read"]["lat_mean_us"] == 800.0


def test_metrics_aggregation():
    m = parse_metrics(FIO_LOGS)
    assert m["time"] == [1, 2]
    assert m["write"] is None
    assert m["read"]["iops"] == [150, 180]          # summed across jobs
    assert m["read"]["bw_mibs"] == [2.0, 4.0]        # KiB/s -> MiB/s
    assert m["read"]["lat_us"] == [1000.0, 2000.0]   # ns -> us


def test_metrics_empty():
    assert parse_metrics({}) is None


def test_summary_runtime_divided_by_numjobs():
    assert parse_summary(FIO_RESULT, numjobs=2)["runtime_s"] == 5.0
