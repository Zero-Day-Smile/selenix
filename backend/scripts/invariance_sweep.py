"""Sun-angle / scale / rotation invariance sweep.

Generates synthetic same-source pairs with EXACT known ground truth
(see backend/pipeline/synthetic_invariance.py + relighting.py for how),
runs the real, completely unmodified pipeline (run_pipeline.run_registration)
on every pair, and records both the pipeline's own internal metrics AND
the true registration error against the known ground truth -- something
the project's 24 real cross-sensor pairs can never provide, since their
true transform isn't independently known.

This intentionally does NOT test cross-sensor or self-similar-terrain
correspondence (that remains the separately-documented finding from the
24 real pairs) -- it isolates illumination/scale/rotation tolerance using
same-source synthetic pairs only.

Run from the repo root:
    ./.venv/Scripts/python.exe backend/scripts/invariance_sweep.py
"""
from __future__ import annotations

import json
import math
import os
import time

import cv2
import numpy as np

from backend.pipeline import ancillary_readers, ingestion, run_pipeline as rp, synthetic_invariance as si

CH2_DIR = "backend/data/real/chandrayaan2"
NAC_DIR = "backend/data/real/lro_nac"
OUT_ROOT = "backend/outputs/invariance_sweep"
VARIANTS_DIR = os.path.join(OUT_ROOT, "variants")
RUNS_DIR = os.path.join(OUT_ROOT, "runs")
RESULTS_PATH = os.path.join(OUT_ROOT, "results.jsonl")

SOURCES = {
    "tmc2_20260811_1856": {"kind": "ch2"},
    "tmc2_20260803_0049": {"kind": "ch2"},
    "M1306094925LE": {"kind": "nac"},
}

SUN_DELTAS = [0, 15, 30, 45]      # degrees LOWER than the real baseline elevation
SCALES = [0.5, 0.7, 1.0, 1.5, 2.0]
ROTATIONS = [0, 15, 30, 45, 90]
COMPOUND_HARD_CASES = [
    {"sun_delta": 30, "scale": 1.5, "rotation": 30},
    {"sun_delta": 45, "scale": 2.0, "rotation": 45},
]


def load_source(source_id: str, kind: str):
    if kind == "ch2":
        preview_path = os.path.join(CH2_DIR, source_id, f"{source_id}_preview.png")
    else:
        preview_path = os.path.join(NAC_DIR, source_id, f"{source_id}_preview.png")
    img = ingestion.load_image(preview_path)
    gray = ingestion.to_uint8(img.gray)

    sun = None
    if kind == "ch2":
        spm_path = os.path.join(CH2_DIR, source_id, f"{source_id}_sun_angles.spm")
        s = ancillary_readers.read_spm(spm_path)
        sun = {"elevation": s.sun_elevation_mean, "azimuth": (s.sun_azimuth_start + s.sun_azimuth_end) / 2}
        gsd_info = si.real_gsd_ch2(source_id, CH2_DIR, gray.shape)
    else:
        gsd_info = si.real_gsd_nac_area_estimate(source_id, NAC_DIR, gray.shape)

    return {"gray": gray, "sun": sun, "gsd_info": gsd_info, "preview_path": preview_path}


# Variant generation + true-error helpers now live in synthetic_invariance.py
# (shared with the live per-pair sweep, backend/pipeline/live_invariance.py) --
# thin aliases kept here so the rest of this script doesn't need renaming.
make_variant = si.make_variant
decompose_h = si.decompose_h
corner_reprojection_error_px = si.corner_reprojection_error_px
angular_diff_deg = si.angular_diff_deg


def run_one_pair(source_id: str, variant_name: str, src_gray: np.ndarray, ref_gray: np.ndarray,
                  H_gt: np.ndarray, meta: dict, gsd_source_m_per_px: float) -> dict:
    pair_dir = os.path.join(VARIANTS_DIR, source_id)
    os.makedirs(pair_dir, exist_ok=True)
    src_path = os.path.join(pair_dir, f"{variant_name}__src.png")
    ref_path = os.path.join(pair_dir, f"{variant_name}__ref.png")
    cv2.imwrite(src_path, src_gray)
    cv2.imwrite(ref_path, ref_gray)

    gt_sidecar = {**meta, "H_gt": H_gt.tolist(), "src_shape": list(src_gray.shape[:2]),
                  "ref_shape": list(ref_gray.shape[:2]), "gsd_source_m_per_px": gsd_source_m_per_px}
    with open(os.path.join(pair_dir, f"{variant_name}__groundtruth.json"), "w") as f:
        json.dump(gt_sidecar, f, indent=2)

    run_id = f"{source_id}__{variant_name}"
    out_dir = os.path.join(RUNS_DIR, run_id)
    t0 = time.time()
    try:
        result = rp.run_registration(src_path, ref_path, out_dir, matcher="auto", illum_mode="gradient")
    except Exception as e:
        result = {"status": "error", "reason": str(e)}
    elapsed = time.time() - t0

    record = {"source_id": source_id, "variant_name": variant_name, "meta": meta,
              "elapsed_s": round(elapsed, 2), "pipeline_status": result.get("status")}

    if result.get("status") == "ok" and result.get("homography") is not None:
        H_est = result["homography"]
        gt_decomp = decompose_h(H_gt)
        est_decomp = decompose_h(H_est)
        reproj = corner_reprojection_error_px(H_est, H_gt, src_gray.shape)
        scale_factor = gt_decomp["scale"] if gt_decomp["scale"] > 0 else 1.0
        meters_per_ref_px = gsd_source_m_per_px / scale_factor
        record.update({
            "total_matches": result.get("total_matches"),
            "inlier_count": result.get("inlier_count"),
            "inlier_ratio": result.get("inlier_ratio"),
            "rotation_consistency_std": result.get("rotation_consistency", {}).get("std_deg"),
            "homography_quality": result.get("homography_quality"),
            "validated": result.get("validation", {}).get("validated"),
            "validation_label": result.get("validation", {}).get("label"),
            "true_rotation_error_deg": angular_diff_deg(est_decomp["rotation_deg"], gt_decomp["rotation_deg"]),
            "true_scale_error_ratio": (est_decomp["scale"] / gt_decomp["scale"]) if gt_decomp["scale"] else None,
            "true_translation_error_px": math.hypot(est_decomp["tx"] - gt_decomp["tx"], est_decomp["ty"] - gt_decomp["ty"]),
            "true_reprojection_error_px_mean": reproj["mean_px"],
            "true_reprojection_error_px_max": reproj["max_px"],
            "true_reprojection_error_m_mean": reproj["mean_px"] * meters_per_ref_px,
            "true_reprojection_error_m_max": reproj["max_px"] * meters_per_ref_px,
        })
    else:
        record.update({
            "validated": False, "true_reprojection_error_px_mean": None, "true_reprojection_error_m_mean": None,
            "failure_reason": result.get("reason"),
        })
    return record


def main():
    import sys
    os.makedirs(VARIANTS_DIR, exist_ok=True)
    os.makedirs(RUNS_DIR, exist_ok=True)

    only_sources = set(sys.argv[1:]) if len(sys.argv) > 1 else set(SOURCES.keys())
    active_sources = {sid: cfg for sid, cfg in SOURCES.items() if sid in only_sources}

    # Accumulate across separate per-source invocations rather than overwrite,
    # so the sweep can be split into several bounded runs without losing
    # earlier sources' results.
    results = []
    if os.path.exists(RESULTS_PATH):
        with open(RESULTS_PATH) as f:
            existing = [json.loads(line) for line in f if line.strip()]
        results = [r for r in existing if r["source_id"] not in active_sources]

    loaded = {sid: load_source(sid, cfg["kind"]) for sid, cfg in active_sources.items()}

    for sid, cfg in active_sources.items():
        src = loaded[sid]
        gray, sun, gsd = src["gray"], src["sun"], src["gsd_info"]["gsd_m_per_px"]
        print(f"=== {sid} (kind={cfg['kind']}, gsd={gsd:.2f} m/px, sun={sun}) ===")

        # PART A: sun-angle-only (CH2 sources only -- real telemetry required)
        if cfg["kind"] == "ch2":
            for delta in SUN_DELTAS:
                ref, H_gt, new_el = make_variant(gray, sun, delta, 1.0, 0)
                meta = {"category": "sun_only", "sun_delta": delta, "scale": 1.0, "rotation_deg": 0,
                        "real_elevation0": sun["elevation"], "real_azimuth0": sun["azimuth"], "new_elevation": new_el}
                rec = run_one_pair(sid, f"sun_delta_{delta}", gray, ref, H_gt, meta, gsd)
                print(" A", rec["variant_name"], "validated=", rec.get("validated"),
                      "reproj_m=", rec.get("true_reprojection_error_m_mean"))
                results.append(rec)

        # PART B: scale-only
        for scale in SCALES:
            ref, H_gt, _ = make_variant(gray, sun, 0, scale, 0)
            meta = {"category": "scale_only", "sun_delta": 0, "scale": scale, "rotation_deg": 0}
            rec = run_one_pair(sid, f"scale_{scale}", gray, ref, H_gt, meta, gsd)
            print(" B", rec["variant_name"], "validated=", rec.get("validated"),
                  "reproj_m=", rec.get("true_reprojection_error_m_mean"))
            results.append(rec)

        # PART C: rotation-only
        for rot in ROTATIONS:
            ref, H_gt, _ = make_variant(gray, sun, 0, 1.0, rot)
            meta = {"category": "rotation_only", "sun_delta": 0, "scale": 1.0, "rotation_deg": rot}
            rec = run_one_pair(sid, f"rotation_{rot}", gray, ref, H_gt, meta, gsd)
            print(" C", rec["variant_name"], "validated=", rec.get("validated"),
                  "reproj_m=", rec.get("true_reprojection_error_m_mean"))
            results.append(rec)

        # PART D: compound -- explicit hard cases + heatmap grid (CH2 only, real sun angle required)
        if cfg["kind"] == "ch2":
            for case in COMPOUND_HARD_CASES:
                ref, H_gt, new_el = make_variant(gray, sun, case["sun_delta"], case["scale"], case["rotation"])
                meta = {"category": "compound_hard", **case, "real_elevation0": sun["elevation"],
                        "real_azimuth0": sun["azimuth"], "new_elevation": new_el}
                name = f"compound_sun{case['sun_delta']}_scale{case['scale']}_rot{case['rotation']}"
                rec = run_one_pair(sid, name, gray, ref, H_gt, meta, gsd)
                print(" D-hard", rec["variant_name"], "validated=", rec.get("validated"))
                results.append(rec)

            for delta in SUN_DELTAS:
                for scale in SCALES:
                    ref, H_gt, new_el = make_variant(gray, sun, delta, scale, 30)
                    meta = {"category": "compound_grid", "sun_delta": delta, "scale": scale, "rotation_deg": 30,
                            "real_elevation0": sun["elevation"], "real_azimuth0": sun["azimuth"], "new_elevation": new_el}
                    name = f"compoundgrid_sun{delta}_scale{scale}_rot30"
                    rec = run_one_pair(sid, name, gray, ref, H_gt, meta, gsd)
                    print(" D-grid", rec["variant_name"], "validated=", rec.get("validated"))
                    results.append(rec)

        with open(RESULTS_PATH, "w") as f:
            for r in results:
                f.write(json.dumps(r) + "\n")

    print(f"\nTotal pairs run: {len(results)}. Results written to {RESULTS_PATH}")


if __name__ == "__main__":
    main()
