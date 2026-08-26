from __future__ import annotations

import os
import shutil
import uuid

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.pipeline.run_pipeline import run_registration, run_registration_manual_seed
from backend.pipeline import memory, synthetic, ingestion, preprocessing
import json as _json
import cv2 as _cv2

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "outputs", "uploads")
RUNS_DIR = os.path.join(BASE_DIR, "outputs", "runs")
SAMPLES_DIR = os.path.join(BASE_DIR, "data", "samples")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(RUNS_DIR, exist_ok=True)

app = FastAPI(title="Lunar Image Correspondence API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


_ENTRY_POINT_PRIORITY = (".xml", ".lbl")


def _save_upload_group(files: list[UploadFile]) -> str:
    """Saves a group of 1+ uploaded files (a detached PDS3/PDS4 product is
    label + companion binary = 2 files that must land in the same directory
    with their ORIGINAL names, since the label references the binary by
    relative filename — a single renamed-flat-file save silently breaks that
    reference) into their own subdirectory, and returns the path to whichever
    file is the format "entry point" (the .xml/.lbl label; for a single
    attached-label .IMG or a plain PNG/TIFF, that's just the one file)."""
    if not files:
        raise HTTPException(400, "no files uploaded")
    group_dir = os.path.join(UPLOAD_DIR, uuid.uuid4().hex[:16])
    os.makedirs(group_dir, exist_ok=True)

    saved = []
    for f in files:
        name = os.path.basename(f.filename or "upload.bin")
        path = os.path.join(group_dir, name)
        with open(path, "wb") as out:
            shutil.copyfileobj(f.file, out)
        saved.append(path)

    for ext in _ENTRY_POINT_PRIORITY:
        for p in saved:
            if p.lower().endswith(ext):
                return p
    if len(saved) > 1:
        raise HTTPException(
            400,
            f"Multiple files uploaded ({[os.path.basename(p) for p in saved]}) but none is a "
            f".xml/.lbl label — can't tell which one to read as the entry point. "
            f"Upload either a single self-contained file, or a detached label + its companion binary.",
        )
    return saved[0]


@app.post("/api/run")
async def api_run(
    source: list[UploadFile] = File(...),
    reference: list[UploadFile] = File(...),
    matcher: str = Form("auto"),
    illum_mode: str = Form("gradient"),
    sensor_type: str = Form("ohrc"),
):
    """`source`/`reference` each accept one or more files: a single PNG/JPG/TIFF
    or attached-label PDS3 .IMG, OR a detached-label pair (.xml/.lbl + its
    companion .img) uploaded together so the sibling-file reference resolves.
    `illum_mode`: none/clahe/gradient/both — see preprocessing.illumination_normalize."""
    src_path = _save_upload_group(source)
    ref_path = _save_upload_group(reference)
    run_id = uuid.uuid4().hex[:12]
    out_dir = os.path.join(RUNS_DIR, run_id)

    result = run_registration(src_path, ref_path, out_dir, matcher=matcher,
                               illum_mode=illum_mode, sensor_type=sensor_type)
    result["run_dir_id"] = run_id
    return result


@app.post("/api/prepare_manual")
async def api_prepare_manual(
    source: list[UploadFile] = File(...),
    reference: list[UploadFile] = File(...),
    illum_mode: str = Form("gradient"),
):
    """Ingests + illumination-normalizes a pair without matching anything, and
    returns the processed images (as PNGs) plus a `prep_id`. The frontend
    displays these for a human to click corresponding points on; the seed
    points are then submitted (in these exact processed-image pixel
    coordinates) to /api/run_manual."""
    src_path = _save_upload_group(source)
    ref_path = _save_upload_group(reference)

    src_img = ingestion.load_image(src_path)
    ref_img = ingestion.load_image(ref_path)
    src_proc = preprocessing.illumination_normalize(ingestion.to_uint8(src_img.gray), illum_mode)
    ref_proc = preprocessing.illumination_normalize(ingestion.to_uint8(ref_img.gray), illum_mode)

    prep_id = uuid.uuid4().hex[:12]
    prep_dir = os.path.join(RUNS_DIR, f"prep_{prep_id}")
    os.makedirs(prep_dir, exist_ok=True)
    _cv2.imwrite(os.path.join(prep_dir, "src_processed.png"), src_proc)
    _cv2.imwrite(os.path.join(prep_dir, "ref_processed.png"), ref_proc)
    manifest = {"src_path": src_path, "ref_path": ref_path, "illum_mode": illum_mode}
    with open(os.path.join(prep_dir, "manifest.json"), "w") as f:
        _json.dump(manifest, f)

    return {
        "prep_id": prep_id,
        "src_shape": list(src_proc.shape),
        "ref_shape": list(ref_proc.shape),
        "src_url": f"/api/runs/prep_{prep_id}/src_processed.png",
        "ref_url": f"/api/runs/prep_{prep_id}/ref_processed.png",
    }


@app.post("/api/run_manual")
async def api_run_manual(
    prep_id: str = Form(...),
    seed_points: str = Form(...),
    sensor_type: str = Form("ohrc"),
):
    """`seed_points`: JSON string, list of {"src": [x, y], "ref": [x, y]} in
    the processed-image coordinate space returned by /api/prepare_manual."""
    prep_dir = os.path.join(RUNS_DIR, f"prep_{prep_id}")
    manifest_path = os.path.join(prep_dir, "manifest.json")
    if not os.path.exists(manifest_path):
        raise HTTPException(404, f"unknown prep_id {prep_id} (did you call /api/prepare_manual first?)")
    with open(manifest_path) as f:
        manifest = _json.load(f)

    try:
        points = _json.loads(seed_points)
    except _json.JSONDecodeError:
        raise HTTPException(400, "seed_points must be a JSON string")

    run_id = uuid.uuid4().hex[:12]
    out_dir = os.path.join(RUNS_DIR, run_id)
    result = run_registration_manual_seed(
        manifest["src_path"], manifest["ref_path"], out_dir, points,
        illum_mode=manifest["illum_mode"], sensor_type=sensor_type)
    result["run_dir_id"] = run_id
    return result


@app.get("/api/runs/{run_id}/{filename}")
async def api_run_file(run_id: str, filename: str):
    from fastapi.responses import FileResponse
    path = os.path.join(RUNS_DIR, run_id, filename)
    if not os.path.exists(path):
        raise HTTPException(404, "not found")
    return FileResponse(path)


@app.get("/api/history")
async def api_history(sensor_type: str | None = None, limit: int = 200):
    return memory.get_history(sensor_type, limit)


@app.get("/api/sensor_summary")
async def api_sensor_summary():
    return memory.get_sensor_summary()


@app.get("/api/hardcases")
async def api_hardcases():
    """Pre-curated difficult pairs. Generated on first request if not present
    (no real dataset drop available yet — see TASKS.md notes)."""
    cases = [
        {"id": "hard_illum", "label": "High sun-angle delta (75deg simulated shift)",
         "dir": "pair_hard_illum", "params": dict(rotation_deg=18, scale=1.4, sun_angle_deg=75, noise_std=10, seed=41)},
        {"id": "hard_scale", "label": "Large scale ratio mismatch (2.1x)",
         "dir": "pair_hard_scale", "params": dict(rotation_deg=8, scale=2.1, sun_angle_deg=20, noise_std=5, seed=42)},
        {"id": "hard_rot", "label": "Large rotation + noise",
         "dir": "pair_hard_rot", "params": dict(rotation_deg=55, scale=1.2, sun_angle_deg=30, noise_std=14, seed=43)},
    ]
    out = []
    for c in cases:
        d = os.path.join(SAMPLES_DIR, c["dir"])
        src_path, ref_path = os.path.join(d, "src.png"), os.path.join(d, "ref.png")
        if not (os.path.exists(src_path) and os.path.exists(ref_path)):
            synthetic.generate_pair(d, **c["params"])
        out.append({"id": c["id"], "label": c["label"], "src_path": src_path, "ref_path": ref_path})
    return out


@app.post("/api/hardcases/{case_id}/run")
async def api_run_hardcase(case_id: str, matcher: str = "auto"):
    cases = await api_hardcases()
    case = next((c for c in cases if c["id"] == case_id), None)
    if case is None:
        raise HTTPException(404, "unknown hard case")
    run_id = f"hardcase_{case_id}_{uuid.uuid4().hex[:8]}"
    out_dir = os.path.join(RUNS_DIR, run_id)
    result = run_registration(case["src_path"], case["ref_path"], out_dir,
                               matcher=matcher, illum_mode="gradient", sensor_type="ohrc")
    result["run_dir_id"] = run_id
    result["hardcase_label"] = case["label"]
    return result


@app.get("/api/health")
async def health():
    return {"status": "ok"}
