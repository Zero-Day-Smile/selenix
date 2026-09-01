# Backend — API & Pipeline Reference

For anyone wiring a frontend (including a different one from `frontend/` in this repo) against this
backend. Covers every route, the exact request/response shapes, and what each pipeline stage does.

## Server

FastAPI app at `backend/app/main.py`, run as:
```bash
PYTHONPATH=. .venv/Scripts/python.exe -m uvicorn backend.app.main:app --port 8000
```
CORS is wide open (`allow_origins=["*"]`), so any frontend origin can call it directly. Outputs are
served as static files under `/api/runs/{run_id}/{filename}`.

## Routes

### `POST /api/run` — main automated registration
**multipart/form-data:**
- `source`: 1+ files (source/moving image)
- `reference`: 1+ files (reference/fixed image)
- `matcher`: `"classical" | "deep" | "auto"` (default `"auto"`)
- `illum_mode`: `"none" | "clahe" | "gradient" | "both"` (default `"gradient"`)
- `sensor_type`: `"ohrc" | "tmc" | "iirs" | "nac"` (default `"ohrc"`)

File input notes: a single PNG/JPG/TIFF or attached-label PDS3 `.IMG` works as one file. A
detached-label product (PDS4 `.xml`/PDS3 `.lbl` + its companion binary) needs **both** files uploaded
together in the same field (multi-select) — the label references the binary by relative filename, so
they're saved into the same server-side directory.

Returns the full result object (see **Result shape** below), plus `run_dir_id` used to fetch output
files.

### `POST /api/prepare_manual` — manual seed-point mode, step 1
**multipart/form-data:** `source`, `reference` (file lists), `illum_mode`.

Ingests + illumination-normalizes only (no matching). Returns:
```json
{
  "prep_id": "...",
  "src_shape": [h, w], "ref_shape": [h, w],
  "src_url": "/api/runs/prep_<id>/src_processed.png",
  "ref_url": "/api/runs/prep_<id>/ref_processed.png"
}
```
Your frontend displays these two images and collects click coordinates **in this exact
processed-image pixel space** (not the original upload's pixel space).

### `POST /api/run_manual` — manual seed-point mode, step 2
**multipart/form-data (not JSON body — form fields):**
- `prep_id`: from step 1
- `seed_points`: a **JSON string** (not multipart nested objects) —
  `[{"src":[x,y],"ref":[x,y]}, ...]`, minimum 4 pairs
- `sensor_type`

Skips matching entirely, fits homography from your points, MAGSAC++-verifies them, then runs the
same sub-pixel phase-correlation refinement the automated path uses. Returns the same result shape
as `/api/run`, with `"mode": "manual_seed"` and `"matcher_used": "manual_seed"`.

### `GET /api/runs/{run_id}/{filename}` — fetch output files
Serves files from `backend/outputs/runs/{run_id}/`. Filenames you'll want:
- `src_processed.png`, `ref_processed.png` — post-ingestion, post-illumination-normalization
- `registered_global.png` — source warped into reference frame via the final homography
- `registered_piecewise.png`, `registered_tps.png` — alternate local warps (nullable — see
  `warps_computed` below)
- `ssim_heatmap.png` — **RGBA PNG**: R=G=B encode dissimilarity `(1-ssim)/2` on a fixed [0,1] scale
  (not per-image auto-scaled), **alpha channel encodes warp validity** (0 = outside the warped
  source's footprint, i.e. no real data — render this distinctly, don't treat it as a real residual
  value)
- `match_points.json` / `match_points.csv` — every match point (see shape below)
- `metrics.json` — the full result object, same as the API response, saved to disk

### `GET /api/history?sensor_type=&limit=` — past runs
Returns stored run summaries from the SQLite-backed memory store (`memory.get_history`).

### `GET /api/sensor_summary`
Aggregate stats grouped by sensor type.

### `GET /api/hardcases` / `POST /api/hardcases/{case_id}/run?matcher=`
Pre-curated synthetic stress-test pairs (illumination/scale/rotation extremes) — generates them on
first request if not already on disk, then runs the same pipeline.

### `GET /api/health`
`{"status": "ok"}`.

## Result object shape (from `/api/run`, `/api/run_manual`, `/api/hardcases/{id}/run`)

On failure:
```json
{"status": "failed", "reason": "...", "total_matches": 36, "matcher_used": "...", "inlier_count": 5}
```

On success:
```json
{
  "status": "ok",
  "sensor_type": "ohrc",
  "matcher_used": "classical_sift" | "deep_loftr" | "manual_seed",
  "matcher_selection": {"classical_sift": 0.94, "deep_loftr": 0.0, "chosen": "classical_sift"} | null,
  "geometry_method": "MAGSAC++",
  "total_matches": 336, "inlier_count": 332, "inlier_ratio": 0.988,
  "rmse_pre_refinement": 0.94, "rmse_post_refinement": 0.08, "rmse_improvement_pct": 91.2,
  "uniformity_score_all_inliers": 0.63, "uniformity_score_selected": 0.50, "n_uniform_selected": 305,
  "estimated_scale_factor_dimension_based": 1.35, "estimated_scale_factor_from_homography": 1.35,
  "src_keypoints": 1647, "ref_keypoints": 5229,
  "homography": [[3, 3, "matrix"]],
  "warps_computed": {
    "global_homography": "<abs path>", "piecewise_affine": "<path>|null",
    "thin_plate_spline": "<path>|null", "ssim_heatmap": "<path>"
  },
  "rotation_consistency": {"std_deg": 55.0, "n_pairs": 630},
  "ssim": {"mean_ssim": 0.07, "mean_ssim_valid_region": 0.08, "valid_pixel_fraction": 0.78},
  "validation": {
    "validated": false,
    "label": "UNVALIDATED / EXPLORATORY — NOT A CONFIRMED MATCH",
    "reasons": ["only 5 inliers (36 total matches) -- need >=20 to rule out a statistically meaningless small-N fit",
                "inlier ratio 0.14 below 0.5",
                "pairwise rotation-consistency std 55.0deg exceeds 15.0deg -- matches disagree on relative rotation, the signature of a spurious/random match set, not a real alignment"],
    "thresholds": {"min_inliers": 20, "min_inlier_ratio": 0.5, "max_rotation_std_deg": 15.0, "max_rmse": 3.0}
  },
  "elapsed_seconds": 3.3,
  "src_path": "...", "ref_path": "...", "out_dir": "...",
  "refinement_stats": {"attempted": 8, "accepted": 8, "skipped_scale_guard": false},
  "multi_scale_leveling": {"...": "..."}, "ingestion": {"...": "..."}
}
```

Important field for your UI: **`validation`** is the thing driving whether you should show a
"confirmed match" vs "exploratory only" state — it's computed from real thresholds (>=20 inliers,
>=0.5 inlier ratio, rotation-consistency std <=15deg, RMSE <3px), not hardcoded per result. Currently
**no real Chandrayaan-2/NAC pair passes this** — only synthetic/demo pairs do, so expect
red/unvalidated on all real data right now (see `TASKS.md` for why).

## `match_points.json` shape (array, one entry per raw match)
```json
{
  "src_x": 14.17, "src_y": 289.5, "ref_x": 46.11, "ref_y": 298.5,
  "confidence": 0.39, "inlier": true, "uniform_selected": true,
  "refined_src_x": 14.26, "refined_src_y": 289.91, "refinement_offset_px": 0.42
}
```
`refined_*` and `refinement_offset_px` are `null` for outlier points (refinement only runs on
MAGSAC++ inliers). Coordinates are in `src_processed.png`/`ref_processed.png` pixel space.

## Pipeline stages (in order, for context on what each metric measures)

1. **Ingestion** (`pipeline/ingestion.py`) — loads PNG/TIFF/PDS3/PDS4, converts to uint8 via
   percentile stretch
1.5. **Geographic-overlap gate** (`pipeline/geo_extent_guard.py::check_footprint_overlap`) — runs
   immediately after ingestion, before any preprocessing/matching. If both images match a known
   real product with real footprint geometry on disk (a `geometry.csv` for Chandrayaan-2, a real
   KML for LRO NAC), their footprints are tested for real polygon intersection — not a centroid-
   distance threshold, which isn't sufficient (two footprints ~30km apart by centroid can still be
   non-touching adjacent strips). No overlap → the run fails immediately with
   `"no geographic overlap: footprints are ~Xkm apart"`, before wasting any time on matching. Added
   after a real mistake found during development: a pair used for most of a working session
   (`tmc2_20260812_0506` x `M1412862267LE`) turned out to be ~97deg / ~2,947km apart — nowhere near
   overlapping — because nothing checked real footprint geometry before it was picked as a
   "cross-sensor test case". An image with no matched real footprint geometry (most arbitrary
   uploads) has nothing to check against and proceeds ungated, same as before this gate existed.
   `backend/scripts/check_pair_overlap.py` exposes the same check standalone, for screening
   candidate pairs before they're ever uploaded; `backend/scripts/sanity_check_overlap_gate.py`
   verifies it against pairs we already have real ground truth for.
2. **Illumination normalization** (`pipeline/preprocessing.py`) — shading removal (default), CLAHE,
   or both
3. **Multi-scale leveling** — downsamples the finer image toward the coarser one's apparent
   resolution before feature detection (SIFT/LoFTR degrade past ~2x resolution mismatch)
4. **Matching** (`pipeline/matching.py`) — classical SIFT, deep LoFTR (kornia, `outdoor` weights), or
   auto (best of both by post-RANSAC inlier ratio)
5. **Geometric verification** (`pipeline/geometry.py`) — MAGSAC++ homography fit + inlier mask
6. **Uniform-distribution selection** — caps matches-per-grid-cell so one dense cluster doesn't
   dominate
7. **Sub-pixel refinement** (`pipeline/refinement.py`) — phase-correlation on inlier patches, warped
   to the reference frame first
8. **Registration/warping** (`pipeline/registration.py`) — global homography + piecewise-affine +
   thin-plate-spline
9. **Metrics** (`pipeline/metrics.py`) — RMSE, rotation-consistency, SSIM, the `validation` verdict
10. **Memory** (`pipeline/memory.py`) — SQLite persistence, feeds `/api/history` and
    `/api/sensor_summary`
