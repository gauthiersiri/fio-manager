"""SQLite persistence (single file on the manager's PVC)."""
from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Optional

from .models import Run, RunSpec

_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    state TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    spec TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 0,
    token_hash TEXT,
    pvc_name TEXT NOT NULL,
    job_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    summary TEXT,
    result TEXT,
    metrics TEXT,
    logs TEXT
);
"""

_LIGHT = ("id,name,state,message,spec,attempt,pvc_name,job_name,created_at,updated_at,"
          "started_at,finished_at,summary,(result IS NOT NULL) AS has_results")

_UPDATABLE = {"name", "state", "message", "spec", "attempt", "token_hash", "job_name",
              "updated_at", "started_at", "finished_at", "summary", "result", "metrics", "logs"}


def _row_to_run(row: sqlite3.Row) -> Run:
    return Run(
        id=row["id"], name=row["name"], state=row["state"], message=row["message"],
        spec=RunSpec.model_validate_json(row["spec"]), attempt=row["attempt"],
        pvc_name=row["pvc_name"], job_name=row["job_name"],
        created_at=row["created_at"], updated_at=row["updated_at"],
        started_at=row["started_at"], finished_at=row["finished_at"],
        has_results=bool(row["has_results"]),
        summary=json.loads(row["summary"]) if row["summary"] else None,
    )


class Store:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        with self._lock:
            self._db.executescript(_SCHEMA)
            self._db.commit()

    def insert(self, run: Run) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO runs (id,name,state,message,spec,attempt,pvc_name,job_name,"
                "created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (run.id, run.name, run.state, run.message, run.spec.model_dump_json(),
                 run.attempt, run.pvc_name, run.job_name, run.created_at, run.updated_at),
            )
            self._db.commit()

    def get(self, run_id: str) -> Optional[Run]:
        with self._lock:
            row = self._db.execute(f"SELECT {_LIGHT} FROM runs WHERE id=?", (run_id,)).fetchone()
        return _row_to_run(row) if row else None

    def list(self) -> list[Run]:
        with self._lock:
            rows = self._db.execute(
                f"SELECT {_LIGHT} FROM runs ORDER BY created_at DESC, rowid DESC").fetchall()
        return [_row_to_run(r) for r in rows]

    def update(self, run_id: str, **fields) -> None:
        bad = set(fields) - _UPDATABLE
        if bad:
            raise ValueError(f"cannot update columns: {bad}")
        if not fields:
            return
        cols = ", ".join(f"{k}=?" for k in fields)
        with self._lock:
            self._db.execute(f"UPDATE runs SET {cols} WHERE id=?", (*fields.values(), run_id))
            self._db.commit()

    def delete(self, run_id: str) -> None:
        with self._lock:
            self._db.execute("DELETE FROM runs WHERE id=?", (run_id,))
            self._db.commit()

    def get_blob(self, run_id: str, column: str):
        if column not in ("token_hash", "result", "metrics", "logs"):
            raise ValueError(column)
        with self._lock:
            row = self._db.execute(f"SELECT {column} FROM runs WHERE id=?", (run_id,)).fetchone()
        if not row or row[0] is None:
            return None
        return row[0] if column in ("token_hash", "logs") else json.loads(row[0])
