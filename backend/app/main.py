from __future__ import annotations

import os
import shutil
import uuid

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.pipeline.run_pipeline import run_registration, run_registration_manual_seed
from backend.pipeline import memory, synthetic, ingestion, preprocessing, crater_catalog, geo_extent_guard, tmc_geometry, ancillary_readers
import json as _json
import cv2 as _cv2

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "outputs", "uploads")
RUNS_DIR = os.path.join(BASE_DIR, "outputs", "runs")
SAMPLES_DIR = os.path.join(BASE_DIR, "data", "samples")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(RUNS_DIR, exist_ok=True)

# The 4 real Chandrayaan-2 TMC-2 frames with real per-pixel geometry.csv
# files (see backend/data/real/chandrayaan2/). Deliberately a fixed
# allowlist, not a directory listing, so this endpoint can never be used to
# read arbitrary paths off disk.
CHANDRAYAAN2_DIR = os.path.join(BASE_DIR, "data", "real", "chandrayaan2")
CHANDRAYAAN2_IMAGE_IDS = [
    "tmc2_20260803_0049", "tmc2_20260809_1606", "tmc2_20260811_1856", "tmc2_20260812_0506",
]


def _chandrayaan2_paths(image_id: str) -> dict:
    if image_id not in CHANDRAYAAN2_IMAGE_IDS:
        raise HTTPException(404, f"unknown Chandrayaan-2 image id {image_id!r}")
    d = os.path.join(CHANDRAYAAN2_DIR, image_id)
    return {
        "preview": os.path.join(d, f"{image_id}_preview.png"),
        "geometry": os.path.join(d, f"{image_id}_geometry.csv"),
    }


def _sun_angle_context(uploaded_path: str) -> dict | None:
    """Real solar-geometry context for the shadow feature (Layer A), ONLY
    when the uploaded file is one of our 4 known real Chandrayaan-2 frames
    (matched by filename, same allowlist as the crater feature) -- never
    fabricated or estimated for anything else. Returns None, silently, when
    there's no real sun-angle file to attach; the shadow analysis itself
    still works either way, this is enrichment, not a dependency."""
    basename = os.path.basename(uploaded_path)
    image_id = next((i for i in CHANDRAYAAN2_IMAGE_IDS if i in basename), None)
    if image_id is None:
        return None
    spm_path = os.path.join(CHANDRAYAAN2_DIR, image_id, f"{image_id}_sun_angles.spm")
    if not os.path.exists(spm_path):
        return None
    try:
        summary = ancillary_readers.read_spm(spm_path)
    except Exception:
        return None
    return {
        "source": "Chandrayaan-2 real .spm ancillary telemetry (ISSDC)",
        "sun_elevation_mean_deg": round(summary.sun_elevation_mean, 2),
        "solar_incidence_mean_deg": round(summary.solar_incidence_mean, 2),
        "n_records": summary.n_records,
    }

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
    if "shadow_analysis" in result:
        result["shadow_analysis"]["src"]["sun_angle_context"] = _sun_angle_context(src_path)
        result["shadow_analysis"]["ref"]["sun_angle_context"] = _sun_angle_context(ref_path)

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


# Real plots from the sun-angle/scale/rotation invariance test suite
# (backend/scripts/invariance_sweep.py + invariance_plots.py, see TASKS.md
# "Sun-angle / scale / rotation invariance test suite"). Fixed allowlist,
# not a directory listing or arbitrary filename, same pattern as the
# Chandrayaan-2 image endpoints above -- this can never be used to read
# arbitrary paths off disk.
INVARIANCE_PLOTS_DIR = os.path.join(BASE_DIR, "outputs", "invariance_sweep", "plots")
INVARIANCE_PLOT_FILES = {
    "plot_a_sun_angle.png", "plot_b_scale.png", "plot_c_rotation.png", "plot_d_compound_heatmap.png",
}


@app.get("/api/invariance_plots/{filename}")
async def api_invariance_plot(filename: str):
    from fastapi.responses import FileResponse
    if filename not in INVARIANCE_PLOT_FILES:
        raise HTTPException(404, f"unknown invariance plot {filename!r}")
    path = os.path.join(INVARIANCE_PLOTS_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(404, "plot not generated yet -- run backend/scripts/invariance_sweep.py "
                                  "then invariance_plots.py")
    return FileResponse(path)


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


@app.get("/api/craters")
async def api_craters(lon_min: float, lon_max: float, lat_min: float, lat_max: float):
    """Real catalog craters (Robbins 2019 + USGS Gazetteer, queried
    separately and never merged/matched -- see crater_catalog.py) whose
    published center falls within the given 0-360 longitude / -90..90
    latitude bounding box. Caller must already have converted any -180/180
    source geometry (e.g. NAC KML footprints) to 0-360 -- this endpoint
    does not silently detect or correct a wrong convention."""
    if lon_min > lon_max or lat_min > lat_max:
        raise HTTPException(400, "lon_min must be <= lon_max and lat_min <= lat_max")
    craters = crater_catalog.query_bbox(lon_min, lon_max, lat_min, lat_max)
    return {"bbox": {"lon_min": lon_min, "lon_max": lon_max, "lat_min": lat_min, "lat_max": lat_max},
            "count": len(craters), "craters": craters,
            "catalog_status": crater_catalog.catalog_status()}


@app.get("/api/chandrayaan2_images")
async def list_chandrayaan2_images():
    """The 4 real Chandrayaan-2 TMC-2 frames with real per-pixel geometry
    available for the crater-overlay feature, each with its real lon/lat
    footprint (computed from geometry.csv, not assumed)."""
    out = []
    for image_id in CHANDRAYAAN2_IMAGE_IDS:
        paths = _chandrayaan2_paths(image_id)
        if not os.path.exists(paths["preview"]) or not os.path.exists(paths["geometry"]):
            continue
        rows = geo_extent_guard.load_tmc_geometry(paths["geometry"])
        lons = [r[2] for r in rows]
        lats = [r[3] for r in rows]
        out.append({
            "id": image_id,
            "image_url": f"/api/chandrayaan2_images/{image_id}/image.png",
            "bbox": {"lon_min": min(lons), "lon_max": max(lons), "lat_min": min(lats), "lat_max": max(lats)},
        })
    return {"images": out}


@app.get("/api/chandrayaan2_images/{image_id}/image.png")
async def chandrayaan2_image(image_id: str):
    from fastapi.responses import FileResponse
    paths = _chandrayaan2_paths(image_id)
    if not os.path.exists(paths["preview"]):
        raise HTTPException(404, "image not found")
    return FileResponse(paths["preview"])


@app.get("/api/chandrayaan2_images/{image_id}/craters")
async def chandrayaan2_image_craters(image_id: str):
    """Real catalog craters inside this specific image's real footprint,
    with each crater's real lat/lon already converted to this image's own
    displayed-pixel coordinates (via tmc_geometry's inverse geometry-grid
    mapping, verified against a known grid vertex to exact 0.0 residual and
    visually confirmed against real crater features -- see TASKS.md).
    An empty `craters` list is a valid, expected result: published catalogs
    are complete only down to ~1-2km diameter, and it's common for a
    targeted crop to contain zero catalog-sized craters."""
    paths = _chandrayaan2_paths(image_id)
    if not os.path.exists(paths["geometry"]) or not os.path.exists(paths["preview"]):
        raise HTTPException(404, "image not found")

    img = _cv2.imread(paths["preview"])
    h, w = img.shape[:2]
    rows = geo_extent_guard.load_tmc_geometry(paths["geometry"])
    lons = [r[2] for r in rows]
    lats = [r[3] for r in rows]
    lon_min, lon_max, lat_min, lat_max = min(lons), max(lons), min(lats), max(lats)

    matches = crater_catalog.query_bbox(lon_min, lon_max, lat_min, lat_max)
    grid = tmc_geometry.load_geometry_grid(paths["geometry"])
    craters = []
    for c in matches:
        x, y, resid = tmc_geometry.native_pixel_for_lonlat(grid, c["lon"], c["lat"])
        craters.append({
            **c,
            "pixel_x": x * w / grid["native_width"],
            "pixel_y": y * h / grid["native_height"],
        })

    # Real average ground sample distance for this frame, from its real
    # lon/lat span and real native pixel dimensions (cos(lat)-corrected for
    # longitude, since a degree of longitude covers less real ground away
    # from the equator) -- lets the frontend size each crater's marker to
    # its real diameter instead of a fixed, meaningless radius.
    import math
    moon_radius_km = 1737.4
    mean_lat_rad = math.radians((lat_min + lat_max) / 2)
    lon_span_km = math.radians(lon_max - lon_min) * moon_radius_km * math.cos(mean_lat_rad)
    lat_span_km = math.radians(lat_max - lat_min) * moon_radius_km
    gsd_x_m = (lon_span_km * 1000) / grid["native_width"]
    gsd_y_m = (lat_span_km * 1000) / grid["native_height"]
    gsd_m_per_px = (gsd_x_m + gsd_y_m) / 2

    return {
        "image_id": image_id, "image_width": w, "image_height": h,
        "bbox": {"lon_min": lon_min, "lon_max": lon_max, "lat_min": lat_min, "lat_max": lat_max},
        "count": len(craters), "craters": craters,
        "gsd_m_per_px": gsd_m_per_px,
        "catalog_status": crater_catalog.catalog_status(),
    }


@app.get("/api/health")
async def health():
    return {"status": "ok"}
