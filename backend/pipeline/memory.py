"""Self-monitoring 'memory' system: persists every run to SQLite, computes a
real running per-sensor-type baseline (mean/std of RMSE) from accumulated
history, and flags new results that fall outside that baseline. Also provides
a simple on-disk feature cache keyed by file hash + params.
"""
from __future__ import annotations

import json
import os
import pickle
import sqlite3
import time
from dataclasses import dataclass

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "outputs", "memory.sqlite3")
CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "outputs", "feature_cache")


def _connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL,
            src_path TEXT,
            ref_path TEXT,
            sensor_type TEXT,
            matcher_used TEXT,
            rmse REAL,
            rmse_refined REAL,
            inlier_count INTEGER,
            inlier_ratio REAL,
            total_matches INTEGER,
            uniformity_score REAL,
            global_rmse REAL,
            piecewise_rmse REAL,
            anomalous INTEGER,
            baseline_mean REAL,
            baseline_std REAL,
            result_json TEXT,
            run_dir TEXT
        )
    """)
    cols = [r[1] for r in conn.execute("PRAGMA table_info(runs)").fetchall()]
    if "run_dir" not in cols:
        conn.execute("ALTER TABLE runs ADD COLUMN run_dir TEXT")
    return conn


@dataclass
class RunRecord:
    src_path: str
    ref_path: str
    sensor_type: str
    matcher_used: str
    rmse: float
    rmse_refined: float
    inlier_count: int
    inlier_ratio: float
    total_matches: int
    uniformity_score: float
    global_rmse: float
    piecewise_rmse: float
    result_json: str = "{}"
    run_dir: str = ""


def get_baseline(sensor_type: str) -> tuple:
    conn = _connect()
    rows = conn.execute(
        "SELECT rmse FROM runs WHERE sensor_type = ? AND rmse IS NOT NULL", (sensor_type,)
    ).fetchall()
    conn.close()
    vals = [r[0] for r in rows if r[0] is not None and r[0] == r[0]]  # drop NaN
    if len(vals) < 2:
        return None, None
    import statistics
    return statistics.mean(vals), statistics.stdev(vals)


def save_run(rec: RunRecord, z_thresh: float = 2.0) -> dict:
    mean, std = get_baseline(rec.sensor_type)
    anomalous = False
    if mean is not None and std and std > 0:
        z = abs(rec.rmse - mean) / std
        anomalous = z > z_thresh

    conn = _connect()
    conn.execute(
        """INSERT INTO runs (timestamp, src_path, ref_path, sensor_type, matcher_used,
           rmse, rmse_refined, inlier_count, inlier_ratio, total_matches, uniformity_score,
           global_rmse, piecewise_rmse, anomalous, baseline_mean, baseline_std, result_json, run_dir)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (time.time(), rec.src_path, rec.ref_path, rec.sensor_type, rec.matcher_used,
         rec.rmse, rec.rmse_refined, rec.inlier_count, rec.inlier_ratio, rec.total_matches,
         rec.uniformity_score, rec.global_rmse, rec.piecewise_rmse, int(anomalous),
         mean, std, rec.result_json, rec.run_dir),
    )
    conn.commit()
    run_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.close()
    return {"anomalous": anomalous, "baseline_mean": mean, "baseline_std": std, "run_id": run_id}


def get_history(sensor_type: str | None = None, limit: int = 200) -> list:
    conn = _connect()
    conn.row_factory = sqlite3.Row
    if sensor_type:
        rows = conn.execute(
            "SELECT * FROM runs WHERE sensor_type = ? ORDER BY id DESC LIMIT ?",
            (sensor_type, limit)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM runs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_sensor_summary() -> list:
    conn = _connect()
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT sensor_type,
               COUNT(*) as n_runs,
               AVG(rmse) as mean_rmse,
               AVG(inlier_ratio) as mean_inlier_ratio,
               AVG(uniformity_score) as mean_uniformity,
               SUM(anomalous) as n_anomalous
        FROM runs GROUP BY sensor_type
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def cache_key(file_hash: str, params: dict) -> str:
    payload = file_hash + json.dumps(params, sort_keys=True)
    import hashlib
    return hashlib.sha1(payload.encode()).hexdigest()[:20]


def cache_get(key: str):
    path = os.path.join(CACHE_DIR, f"{key}.pkl")
    if os.path.exists(path):
        with open(path, "rb") as f:
            return pickle.load(f)
    return None


def cache_put(key: str, value) -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, f"{key}.pkl")
    with open(path, "wb") as f:
        pickle.dump(value, f)
