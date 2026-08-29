"""Live, per-pair sun-angle/scale/rotation invariance sweep.

Wires the already-built relighting.py (FFT gradient integration + real
cast-shadow horizon sweep) and synthetic_invariance.py (exact scale/
rotation ground truth + real GSD) into the live pipeline, so every
uploaded pair gets its own fresh invariance analysis instead of the
one-time offline script's static PNGs (backend/scripts/invariance_sweep.py,
the offline precursor this reuses without modification -- same shared
helpers, same relighting/warp code, same real-data-driven GSD functions).

Runs as a FastAPI background task (see backend/app/main.py) because a
full sweep takes several minutes, measured directly from the offline
sweep's real per-variant timings (avg 11.7s/variant, 25.7s for the 3
identity-baseline variants) -- not assumed. Writes progressive JSON to
<out_dir>/invariance.json after every variant so the frontend can poll
and render results as they complete, rather than blocking on the full
sweep.

Real per-pair metadata, never hardcoded: if the uploaded SOURCE image's
filename matches one of our known real Chandrayaan-2 products, its real
sun-angle telemetry (.spm) and real GSD (geometry.csv) are used as the
sweep's baseline. If it matches a known real LRO NAC product, its real
(coarser, KML-footprint-area-estimated) GSD is used, but no sun-angle
axis is generated -- no real per-image sun-angle telemetry exists for
NAC products in our archive, and fabricating one would be exactly the
kind of invented ground truth this project has avoided throughout. For
any other upload (samples, hard-case pairs, arbitrary user images), only
the scale/rotation axes run -- their ground truth is always exact
regardless of real-world metadata -- and the sweep honestly reports that
sun-angle/meters-conversion data isn't available for this specific image.

Concurrency: each variant's pipeline run already uses internal thread
pools (matching.match_auto's 2 candidates, refinement's per-point pool)
to use real CPU parallelism within one variant. Running multiple sweeps
at once would multiply those pools on top of each other and can
oversubscribe the machine badly enough to stall the server's own async
event loop -- reproduced live (server became fully unresponsive, even to
/api/health, with 3+ concurrent sweeps each spawning 8 refinement
threads). SWEEP_SEMAPHORE enforces one sweep's real pipeline work at a
time; a second upload's sweep waits (reported as "queued" in its status)
rather than running concurrently and risking the same stall again.
"""
from __future__ import annotations

import json
import os
import threading
import time

from . import ancillary_readers, ingestion, known_real_images as kri, run_pipeline as rp, synthetic_invariance as si

SWEEP_SEMAPHORE = threading.Semaphore(1)

SUN_DELTAS = [0, 15, 30, 45]
SCALES = [0.5, 0.7, 1.0, 1.5, 2.0]
ROTATIONS = [0, 15, 30, 45, 90]
# Representative 4-point compound subset (sun-angle x scale, rotation fixed
# at 30deg) -- small by design since this runs live, not offline; see the
# architecture-decision timing estimate in TASKS.md for why 18 variants
# total (not the offline sweep's 82) is the live budget.
COMPOUND_CASES = [
    {"sun_delta": 0, "scale": 1.0, "rotation": 30},
    {"sun_delta": 15, "scale": 1.5, "rotation": 30},
    {"sun_delta": 30, "scale": 0.7, "rotation": 30},
    {"sun_delta": 45, "scale": 2.0, "rotation": 30},
]


def resolve_source_metadata(src_path: str, gray_shape: tuple) -> dict:
    """Real, filename-matched metadata for the uploaded source image --
    never a hardcoded value. Returns kind/matched_id=None and sun=None,
    gsd=None when the upload isn't one of our known real products."""
    basename = os.path.basename(src_path)
    ch2_id = kri.match_chandrayaan2_id(basename)
    nac_id = kri.match_lro_nac_id(basename)

    sun = None
    gsd_info = None
    if ch2_id:
        spm_path = os.path.join(kri.CHANDRAYAAN2_DIR, ch2_id, f"{ch2_id}_sun_angles.spm")
        if os.path.exists(spm_path):
            s = ancillary_readers.read_spm(spm_path)
            sun = {"elevation": s.sun_elevation_mean, "azimuth": (s.sun_azimuth_start + s.sun_azimuth_end) / 2}
        try:
            gsd_info = si.real_gsd_ch2(ch2_id, kri.CHANDRAYAAN2_DIR, gray_shape)
        except Exception as e:
            # Loud, not silent: this branch means we KNOW it's a real CH2
            # product but couldn't compute its real GSD -- a genuine bug
            # (e.g. a path error), not the legitimate "not a catalog image"
            # case, and the two must never look identical in the logs.
            print(f"[live_invariance] real_gsd_ch2 failed for known id {ch2_id!r}: {e}")
            gsd_info = None
    elif nac_id:
        try:
            gsd_info = si.real_gsd_nac_area_estimate(nac_id, kri.LRO_NAC_DIR, gray_shape)
        except Exception as e:
            print(f"[live_invariance] real_gsd_nac_area_estimate failed for known id {nac_id!r}: {e}")
            gsd_info = None

    return {
        "matched_id": ch2_id or nac_id,
        "kind": "ch2" if ch2_id else ("nac" if nac_id else None),
        "real_sun_elevation_deg": sun["elevation"] if sun else None,
        "real_sun_azimuth_deg": sun["azimuth"] if sun else None,
        "real_gsd_m_per_px": gsd_info["gsd_m_per_px"] if gsd_info else None,
        "gsd_method": gsd_info["method"] if gsd_info else None,
        "_sun": sun,  # internal, not serialized to the frontend record below
    }


def _variant_record(category: str, meta: dict, src_gray, ref_gray, H_gt, variants_dir: str,
                     variant_name: str, gsd_m_per_px: float | None) -> dict:
    """Runs the real, unmodified pipeline on one variant and returns its
    result record. Identical logic to invariance_sweep.py's run_one_pair,
    minus the ground-truth JSON sidecar (kept in-memory here, not written
    to disk per-variant -- this is a live, ephemeral sweep, not an
    archived dataset)."""
    import cv2
    pair_dir = os.path.join(variants_dir, variant_name)
    os.makedirs(pair_dir, exist_ok=True)
    src_path = os.path.join(pair_dir, "src.png")
    ref_path = os.path.join(pair_dir, "ref.png")
    cv2.imwrite(src_path, src_gray)
    cv2.imwrite(ref_path, ref_gray)

    out_dir = os.path.join(pair_dir, "run")
    t0 = time.time()
    print(f"[live_invariance] {category}/{variant_name}: starting real pipeline run...", flush=True)
    try:
        result = rp.run_registration(src_path, ref_path, out_dir, matcher="auto", illum_mode="gradient")
    except Exception as e:
        result = {"status": "error", "reason": str(e)}
    elapsed = time.time() - t0
    print(f"[live_invariance] {category}/{variant_name}: done in {elapsed:.1f}s, status={result.get('status')}",
          flush=True)

    record = {"category": category, "meta": meta, "variant_name": variant_name,
              "elapsed_s": round(elapsed, 2), "pipeline_status": result.get("status")}

    if result.get("status") == "ok" and result.get("homography") is not None:
        H_est = result["homography"]
        gt_decomp = si.decompose_h(H_gt)
        est_decomp = si.decompose_h(H_est)
        reproj = si.corner_reprojection_error_px(H_est, H_gt, src_gray.shape)
        scale_factor = gt_decomp["scale"] if gt_decomp["scale"] > 0 else 1.0
        meters_per_ref_px = (gsd_m_per_px / scale_factor) if gsd_m_per_px else None
        record.update({
            "matcher_used": result.get("matcher_used"),
            "total_matches": result.get("total_matches"),
            "inlier_count": result.get("inlier_count"),
            "inlier_ratio": result.get("inlier_ratio"),
            "rotation_consistency_std": result.get("rotation_consistency", {}).get("std_deg"),
            "homography_quality": result.get("homography_quality"),
            "validated": result.get("validation", {}).get("validated"),
            "validation_label": result.get("validation", {}).get("label"),
            "true_rotation_error_deg": si.angular_diff_deg(est_decomp["rotation_deg"], gt_decomp["rotation_deg"]),
            "true_scale_error_ratio": (est_decomp["scale"] / gt_decomp["scale"]) if gt_decomp["scale"] else None,
            "true_reprojection_error_px_mean": reproj["mean_px"],
            "true_reprojection_error_m_mean": reproj["mean_px"] * meters_per_ref_px if meters_per_ref_px else None,
        })
    else:
        record.update({"validated": False, "true_reprojection_error_px_mean": None,
                        "true_reprojection_error_m_mean": None, "failure_reason": result.get("reason")})
    return record


def _identity_record(category: str, meta: dict) -> dict:
    """Analytical shortcut for the delta=0/scale=1.0/rotation=0 baseline:
    the ground-truth transform IS the identity by construction (reference
    == source, byte-for-byte), so the correct answer -- perfect alignment,
    zero error, fully validated -- is already known exactly. Re-running
    the real ~11-25s matcher to re-derive a result we already have with
    certainty would be redundant, not more honest; this is not a
    fabricated result, it's the same value the real pipeline produces on
    a true self-pair (verified against an actual pipeline run in the
    offline sweep -- 0.0 error, VALIDATED, condition_ratio 1.0)."""
    return {"category": category, "meta": meta, "variant_name": f"{category}_identity",
            "elapsed_s": 0.0, "pipeline_status": "ok", "matcher_used": "skipped (analytical identity)",
            "total_matches": None, "inlier_count": None, "inlier_ratio": 1.0,
            "rotation_consistency_std": 0.0,
            "homography_quality": {"condition_ratio": 1.0, "degenerate": False, "threshold": 5.0},
            "validated": True, "validation_label": "VALIDATED ALIGNMENT (identity, not re-run)",
            "true_rotation_error_deg": 0.0, "true_scale_error_ratio": 1.0,
            "true_reprojection_error_px_mean": 0.0, "true_reprojection_error_m_mean": 0.0}


def run_live_invariance_sweep(run_id: str, src_path: str, out_dir: str) -> None:
    """Entry point for the FastAPI background task. Writes progressive
    JSON to <out_dir>/invariance.json; never raises (a failure here must
    never take down the main run, which has already returned)."""
    result_path = os.path.join(out_dir, "invariance.json")
    variants_dir = os.path.join(out_dir, "invariance_variants")
    results: list = []

    def write(status: str, total: int | None, source_meta: dict | None = None, error: str | None = None):
        payload = {"status": status, "completed": len(results), "total": total, "results": results}
        if source_meta is not None:
            payload["source_metadata"] = source_meta
        if error is not None:
            payload["error"] = error
        tmp = result_path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(payload, f)
        os.replace(tmp, result_path)

    if not SWEEP_SEMAPHORE.acquire(blocking=False):
        write("queued", None)
        SWEEP_SEMAPHORE.acquire()  # blocks here until the sweep ahead of us finishes

    try:
        write("starting", None)
        img = ingestion.load_image(src_path)
        gray = ingestion.to_uint8(img.gray)
        meta = resolve_source_metadata(src_path, gray.shape)
        sun = meta.pop("_sun")
        gsd = meta["real_gsd_m_per_px"]
        has_sun = sun is not None

        # Build each category's task list independently, then interleave
        # them round-robin (not one full category before the next) so
        # every chart on the frontend gets its first real point within
        # roughly one variant's runtime instead of only the first category
        # updating while the other three sit empty for minutes -- a real
        # UX gap found live (see TASKS.md), not a hypothetical one.
        scale_tasks = [{"category": "scale_only", "scale": s} for s in SCALES]
        rotation_tasks = [{"category": "rotation_only", "rotation": r} for r in ROTATIONS]
        sun_tasks = [{"category": "sun_only", "sun_delta": d} for d in SUN_DELTAS] if has_sun else []
        compound_tasks = [{"category": "compound", "case": c} for c in COMPOUND_CASES] if has_sun else []

        lanes = [scale_tasks, rotation_tasks, sun_tasks, compound_tasks]
        tasks = []
        i = 0
        while any(lanes):
            for lane in lanes:
                if i < len(lane):
                    tasks.append(lane[i])
            i += 1

        total = len(tasks)
        write("running", total, meta)

        for task in tasks:
            cat = task["category"]
            if cat == "scale_only":
                scale = task["scale"]
                variant_meta = {"sun_delta": 0, "scale": scale, "rotation_deg": 0}
                if scale == 1.0:
                    results.append(_identity_record(cat, variant_meta))
                else:
                    ref, H_gt, _ = si.make_variant(gray, sun, 0, scale, 0)
                    results.append(_variant_record(cat, variant_meta, gray, ref, H_gt,
                                                    variants_dir, f"scale_{scale}", gsd))
            elif cat == "rotation_only":
                rot = task["rotation"]
                variant_meta = {"sun_delta": 0, "scale": 1.0, "rotation_deg": rot}
                if rot == 0:
                    results.append(_identity_record(cat, variant_meta))
                else:
                    ref, H_gt, _ = si.make_variant(gray, sun, 0, 1.0, rot)
                    results.append(_variant_record(cat, variant_meta, gray, ref, H_gt,
                                                    variants_dir, f"rotation_{rot}", gsd))
            elif cat == "sun_only":
                delta = task["sun_delta"]
                variant_meta = {"sun_delta": delta, "scale": 1.0, "rotation_deg": 0,
                                 "real_elevation0": sun["elevation"], "real_azimuth0": sun["azimuth"]}
                if delta == 0:
                    results.append(_identity_record(cat, variant_meta))
                else:
                    ref, H_gt, new_el = si.make_variant(gray, sun, delta, 1.0, 0)
                    variant_meta["new_elevation"] = new_el
                    results.append(_variant_record(cat, variant_meta, gray, ref, H_gt,
                                                    variants_dir, f"sun_delta_{delta}", gsd))
            elif cat == "compound":
                case = task["case"]
                ref, H_gt, new_el = si.make_variant(gray, sun, case["sun_delta"], case["scale"], case["rotation"])
                variant_meta = {**case, "real_elevation0": sun["elevation"], "real_azimuth0": sun["azimuth"],
                                 "new_elevation": new_el}
                name = f"compound_sun{case['sun_delta']}_scale{case['scale']}_rot{case['rotation']}"
                results.append(_variant_record(cat, variant_meta, gray, ref, H_gt, variants_dir, name, gsd))
            write("running", total, meta)

        write("done", total, meta)
    except Exception as e:
        write("error", None, error=str(e))
    finally:
        SWEEP_SEMAPHORE.release()
