# Product context

## Problem
Comparing storage classes on a cluster means hand-writing PVCs, fio job files and Jobs, then collecting logs and plotting results by hand. It is slow and hard to repeat.

## What the product gives the user
- A form to define a benchmark (storage, IO profile, size, duration) with presets: random read 4k, random write 4k, random read/write 70/30 4k, sequential read 1M, sequential write 1M.
- One click to provision the volume and run fio, one click to stop, delete or re-run.
- Live logs while the run is active; logs stay available afterwards and can be downloaded.
- Graphs of IOPS, bandwidth and latency over time, plus latency percentiles (p50 to p99.9).
- A compare page to overlay several runs (the main use case: benchmarking different storage classes).

## UX goals
- Clean Tailwind/shadcn-style look (no IBM Carbon; project is not IBM).
- Safe by default: only allow-listed fio options, validation of file size against PVC size, clear error messages from Kubernetes.
- Runs are repeatable: a run keeps its spec, each start is a new attempt, results are replaced.

## User workflow
1. New run, pick a storage class from the live list, choose a preset or custom profile.
2. Save, or save and start.
3. Watch state, logs and graphs on the run page.
4. Download logs or raw fio JSON.
5. Compare runs, then delete runs (PVC is removed with them).

## Business context
Internal IBM tool for storage performance validation. No external customers or SLAs yet.
