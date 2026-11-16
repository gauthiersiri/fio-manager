# Project brief

## What
FIO Manager is a containerized web application for OpenShift that runs storage benchmarks with [fio](https://fio.readthedocs.io). Users create, edit, delete, start, stop and monitor fio runs from a browser.

## Core requirements (from the original request)
- Create a run by defining: name, PVC storage class (fetched dynamically from the cluster), PVC size, PVC mode, IO profile, test size and test length.
- The manager creates the PVC and the Kubernetes Job that runs fio.
- View logs in the UI and download them.
- Generate relevant graphs (IOPS, bandwidth, latency).
- Everything runs in one namespace: `fio-manager`.

## Confirmed decisions from the requester
- "PVC mode" means both access mode (RWO, RWX, RWOP) and volume mode (Filesystem, Block).
- Volume mode: Filesystem first. Block is deferred (needs extra SCC for the runner).
- SQLite on a PVC is acceptable for persistence (single manager replica).
- Backend language: Python (FastAPI).
- A test cluster is available (see `techContext.md`), namespace `fio-manager`.

## Users
Storage and platform engineers who need to measure and compare PVC performance of storage classes on an OpenShift cluster (here: a Fusion/ODF/Spectrum Scale cluster).

## Non-goals (for now)
- Multi-namespace or multi-tenant runs.
- Raw Block volume mode.
- High availability of the manager.
- Run queueing or scheduling.
- Distributed multi-pod fio (client/server mode).
