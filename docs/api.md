# FIO Manager REST API (contract)

Base path: `/api`. JSON unless stated. Same origin as the UI. Timestamps are ISO-8601 UTC strings.
Errors: HTTP 4xx/5xx with body `{"detail": "<message>"}` (FastAPI style; for validation errors `detail` may be a list of `{loc,msg,type}`).

## Run spec (`RunSpec`)

```json
{
  "name": "ceph-rbd-4k-randrw",
  "storage_class": "ocs-storagecluster-ceph-rbd",
  "pvc_size_gi": 50,
  "access_mode": "ReadWriteOnce",
  "volume_mode": "Filesystem",
  "profile": {
    "preset": "randrw-70-30-4k",
    "rw": "randrw",
    "rwmixread": 70,
    "bs": "4k",
    "iodepth": 32,
    "numjobs": 4,
    "ioengine": "libaio",
    "direct": true
  },
  "file_size_gi": 5,
  "runtime_s": 120,
  "ramp_time_s": 5
}
```

Constraints (enforced server side, mirror them in the UI form):
- `name`: 1-63 chars.
- `access_mode`: `ReadWriteOnce` | `ReadWriteMany` | `ReadWriteOncePod`.
- `volume_mode`: only `Filesystem` is supported for now (Block is rejected with 422). Show the field disabled/with a single option.
- `profile.rw`: `read` | `write` | `randread` | `randwrite` | `rw` | `randrw`.
- `profile.rwmixread`: integer 0-100 (only meaningful for `rw`/`randrw`; send 50 otherwise).
- `profile.bs`: regex `^[0-9]+[kKmM]$` (e.g. `4k`, `1m`).
- `profile.iodepth`: 1-256. `profile.numjobs`: 1-64.
- `profile.ioengine`: `libaio` | `psync` | `sync`.
- `profile.direct`: boolean (O_DIRECT).
- `profile.preset`: optional string, informational (id from `/api/presets`, or `custom`).
- `pvc_size_gi`: integer 1-10000. `file_size_gi`: number > 0 (size of the test file **per job**).
- Rule: `file_size_gi * numjobs <= 0.9 * pvc_size_gi`.
- `runtime_s`: integer 5-86400. `ramp_time_s`: integer 0-3600.

## Run object (`Run`)

```json
{
  "id": "a1b2c3d4",
  "name": "ceph-rbd-4k-randrw",
  "state": "draft",
  "message": "",
  "spec": { "...RunSpec..." },
  "attempt": 0,
  "pvc_name": "fio-a1b2c3d4-data",
  "job_name": "fio-a1b2c3d4",
  "created_at": "2026-11-13T17:40:00Z",
  "updated_at": "2026-11-13T17:40:00Z",
  "started_at": null,
  "finished_at": null,
  "has_results": false,
  "summary": null
}
```

`state` is one of: `draft`, `provisioning` (PVC/pod being created), `running`, `succeeded`, `failed`, `stopped`.
- `draft`, `succeeded`, `failed`, `stopped`: editable, startable (start again = new attempt), deletable.
- `provisioning`, `running`: can be stopped; cannot be edited or deleted (409).
`message` carries a human readable detail (failure reason, pending reason...).

`summary` (null until results are in):

```json
{
  "runtime_s": 120.0,
  "cpu_usr": 12.3,
  "cpu_sys": 8.1,
  "read":  { "iops": 12000.5, "bw_mibs": 46.9, "io_mib": 5600.0,
             "lat_mean_us": 800.1, "lat_p50_us": 700, "lat_p90_us": 1200,
             "lat_p95_us": 1500, "lat_p99_us": 2500, "lat_p99_9_us": 6000 },
  "write": { "...same keys..." }
}
```
`read` or `write` may be null when that direction did no IO.

## Endpoints

| Method + path | Body / query | Response |
|---|---|---|
| `GET /api/health` | | `{"status":"ok"}` |
| `GET /api/storageclasses` | | `[{"name","provisioner","is_default":bool,"allow_volume_expansion":bool,"volume_binding_mode"}]` (dynamic fetch from the cluster; non-provisionable classes already filtered) |
| `GET /api/presets` | | `[{"id","label","profile":{...profile fields without preset...}}]` |
| `GET /api/runs` | | `Run[]` newest first |
| `POST /api/runs` | `RunSpec` | `201 Run` (state `draft`) |
| `GET /api/runs/{id}` | | `Run` |
| `PUT /api/runs/{id}` | `RunSpec` | `Run` (409 if provisioning/running) |
| `DELETE /api/runs/{id}` | | `204` (removes Job, PVC, ConfigMap, DB row; 409 if active) |
| `POST /api/runs/{id}/start` | | `Run` (409 if already active) |
| `POST /api/runs/{id}/stop` | | `Run` (409 if not active) |
| `GET /api/runs/{id}/logs` | `?tail=<n>` optional | `text/plain` full log (live from the pod while active, stored copy afterwards). Poll every ~2s while the run is active. Empty body if nothing yet. |
| `GET /api/runs/{id}/logs/download` | | `text/plain` attachment `fio-<name>-<id>.log` |
| `GET /api/runs/{id}/metrics` | | `Metrics` or `null` |
| `GET /api/runs/{id}/results/download` | | attachment: raw fio `result.json` (404 if none) |
| `GET /api/compare` | `?ids=a,b,c` | `[{"id","name","spec","summary","metrics"}]` |

`Metrics` (time series, 1 sample per second, aligned arrays, `time` is seconds since test start):

```json
{
  "time": [0, 1, 2],
  "read":  { "iops": [..], "bw_mibs": [..], "lat_us": [..] },
  "write": { "iops": [..], "bw_mibs": [..], "lat_us": [..] }
}
```
`read`/`write` may be `null`. `lat_us` values are mean latency in microseconds; individual entries may be `null`.

## Static UI
The backend serves the built UI (`index.html` + assets) from `/` with SPA fallback; the UI must call the API with relative URLs (`/api/...`). In dev, Vite proxies `/api` to `http://localhost:8080`.
