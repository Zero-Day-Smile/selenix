"""Main orchestration: ties ingestion -> preprocessing -> matching -> geometric
verification -> uniform-distribution selection -> sub-pixel refinement ->
registration/warping -> metrics -> memory persistence -> outputs.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import time

import cv2
import numpy as np
from skimage.metrics import structural_similarity

from . import ingestion, preprocessing, matching, geometry, registration, refinement, metrics, memory


def _save_ssim_heatmap(ref_u8: np.ndarray, warped_u8: np.ndarray, H: np.ndarray,
                        src_shape: tuple, out_path: str) -> dict:
    """Structural-similarity dissimilarity map, on a FIXED [0,1] scale (SSIM
    is bounded by definition — no per-image auto-scaling needed or wanted,
    since auto-scaling can make a bad alignment's heatmap look deceptively
    similar to a good one's). Saved as a 2-channel-meaningful RGBA PNG: the
    grayscale value encodes dissimilarity (0=identical, 255=max dissimilar),
    the alpha channel encodes warp validity (0 = outside the warped source's
    footprint — no real data there, not a residual). That validity mask is
    what produces the sharp polygonal/diagonal artifact in the old raw-diff
    heatmap: cv2.warpPerspective fills outside the valid region with 0,
    which reads as maximum difference against real reference content at
    that boundary. This function keeps that boundary but labels it via alpha
    instead of letting it masquerade as real residual structure."""
    ssim_val, ssim_map = structural_similarity(ref_u8, warped_u8, full=True, data_range=255)
    dissimilarity = np.clip((1.0 - ssim_map) / 2.0, 0.0, 1.0)  # SSIM in [-1,1] -> [0,1]

    ones = np.ones(src_shape[:2], dtype=np.uint8) * 255
    valid_mask = cv2.warpPerspective(ones, H, (ref_u8.shape[1], ref_u8.shape[0]))

    gray = (dissimilarity * 255).astype(np.uint8)
    rgba = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGRA)
    rgba[:, :, 3] = valid_mask
    cv2.imwrite(out_path, rgba)

    valid_frac = valid_mask.astype(bool)
    mean_ssim_in_valid = float(ssim_map[valid_frac].mean()) if valid_frac.any() else float("nan")

    # Raw-data JSON export for the interactive Plotly heatmap. Full resolution
    # is impractical to ship as JSON -- measured 7.8MB/17.7MB for real test
    # images (1200x329 / 945x945), which would make the panel noticeably slow
    # to load. Downsampled so the longer axis is <=320 cells (~1-2MB,
    # still sub-second transfer, visibly sharper than the original 200-cell
    # cap; combined with Plotly's zsmooth interpolation on the frontend this
    # reads as a much less blocky heatmap). x_coords/y_coords give each
    # downsampled cell's center in ORIGINAL pixel space, so the frontend can
    # plot this on the same axes as match_points.json (already in
    # full-resolution pixel coordinates) with no transform needed.
    h, w = ssim_map.shape
    target_max = 320
    factor = max(1, int(np.ceil(max(h, w) / target_max)))
    ds_w, ds_h = max(1, w // factor), max(1, h // factor)
    ssim_ds = cv2.resize(ssim_map.astype(np.float32), (ds_w, ds_h), interpolation=cv2.INTER_AREA)
    # mask: average validity per block, then threshold -- a block counts as
    # valid only if most of its source pixels were inside the warped footprint
    mask_ds = cv2.resize((valid_mask.astype(np.float32) / 255.0), (ds_w, ds_h), interpolation=cv2.INTER_AREA) > 0.5

    x_coords = (np.arange(ds_w) + 0.5) * (w / ds_w)
    y_coords = (np.arange(ds_h) + 0.5) * (h / ds_h)

    data_path = out_path.replace(".png", "_data.json")
    with open(data_path, "w") as f:
        json.dump({
            "ssim": ssim_ds.round(4).tolist(),
            "valid_mask": mask_ds.tolist(),
            "x_coords": x_coords.round(1).tolist(),
            "y_coords": y_coords.round(1).tolist(),
            "orig_shape": [h, w],
            "downsampled_shape": [ds_h, ds_w],
            "downsample_factor": factor,
        }, f)

    return {"mean_ssim": ssim_val, "mean_ssim_valid_region": mean_ssim_in_valid,
            "valid_pixel_fraction": float(valid_frac.mean()),
            "data_json_path": data_path}


def _sensor_from_path(path: str) -> str:
    name = os.path.basename(path).lower()
    for key in ("ohrc", "tmc", "iirs", "nac"):
        if key in name:
            return key
    return "unknown"


def run_registration(src_path: str, ref_path: str, out_dir: str,
                      matcher: str = "auto", use_clahe: bool = True,
                      illum_mode: str | None = None,
                      sensor_type: str | None = None) -> dict:
    """`illum_mode`: 'none'/'clahe'/'gradient'/'both' — takes precedence if
    given. Otherwise derived from the legacy `use_clahe` bool for backward
    compatibility: True -> 'gradient' (the measured-best default, not 'clahe'
    — see preprocessing.illumination_normalize's docstring), False -> 'none'."""
    os.makedirs(out_dir, exist_ok=True)
    t0 = time.time()
    if illum_mode is None:
        illum_mode = "gradient" if use_clahe else "none"

    src_img = ingestion.load_image(src_path)
    ref_img = ingestion.load_image(ref_path)
    src_u8_raw = ingestion.to_uint8(src_img.gray)
    ref_u8_raw = ingestion.to_uint8(ref_img.gray)

    ingestion_warnings = list(src_img.warnings) + list(ref_img.warnings)
    for w in ingestion_warnings:
        print(f"[ingestion warning] {w}")
    print(f"[ingestion] source: format={src_img.source_format} shape={src_img.original_shape} "
          f"dtype={src_img.dtype} geometry={src_img.geometry}")
    print(f"[ingestion] reference: format={ref_img.source_format} shape={ref_img.original_shape} "
          f"dtype={ref_img.dtype} geometry={ref_img.geometry}")

    scale_est = preprocessing.estimate_scale_factor(src_img.original_shape, ref_img.original_shape)

    src_proc = preprocessing.illumination_normalize(src_u8_raw, illum_mode)
    ref_proc = preprocessing.illumination_normalize(ref_u8_raw, illum_mode)
    print(f"[illumination] mode={illum_mode}")

    # Explicit multi-scale handling: SIFT/LoFTR degrade sharply once the two
    # images differ by more than ~2x in effective resolution (measured: at a
    # 6x ratio, unleveled inlier ratio drops from ~95% to ~56% and refinement
    # can regress RMSE). Level whichever image is finer down toward the
    # coarser one's apparent resolution before detecting features.
    leveled = preprocessing.level_for_matching(src_proc, ref_proc, scale_est.factor)
    print(f"[multi-scale] dimension-based scale factor={scale_est.factor:.4f} -> "
          f"leveling applied: src_scale={leveled.src_scale_applied:.4f} "
          f"ref_scale={leveled.ref_scale_applied:.4f} "
          f"(leveled shapes: src={leveled.src_leveled.shape}, ref={leveled.ref_leveled.shape})")

    # feature cache key must reflect preprocessing + leveling, not just file identity
    preproc_tag = illum_mode
    src_cache_hash = f"{src_img.file_hash}_{preproc_tag}_lvl{leveled.src_scale_applied:.3f}"
    ref_cache_hash = f"{ref_img.file_hash}_{preproc_tag}_lvl{leveled.ref_scale_applied:.3f}"

    def _inlier_ratio_fn(mr: matching.MatchResult) -> float:
        if len(mr.src_pts) < 4:
            return 0.0
        g = geometry.estimate_homography(mr.src_pts, mr.ref_pts)
        if g.H is None:
            return 0.0
        return float(g.inlier_mask.mean())

    matcher_summary = None
    if matcher == "classical":
        match_res = matching.match_classical(leveled.src_leveled, leveled.ref_leveled, "sift",
                                               src_hash=src_cache_hash, ref_hash=ref_cache_hash)
    elif matcher == "deep":
        match_res = matching.match_deep_loftr(leveled.src_leveled, leveled.ref_leveled)
        if match_res is None:
            match_res = matching.match_classical(leveled.src_leveled, leveled.ref_leveled, "sift",
                                                   src_hash=src_cache_hash, ref_hash=ref_cache_hash)
            match_res.matcher_used += "_fallback_no_torch"
    else:  # auto
        match_res, matcher_summary = matching.match_auto(
            leveled.src_leveled, leveled.ref_leveled, _inlier_ratio_fn,
            src_hash=src_cache_hash, ref_hash=ref_cache_hash)

    # rescale matched keypoints from leveled-image coordinates back to full-resolution
    if len(match_res.src_pts):
        match_res.src_pts = match_res.src_pts * leveled.src_scale_applied
        match_res.ref_pts = match_res.ref_pts * leveled.ref_scale_applied

    geo = geometry.estimate_homography(match_res.src_pts, match_res.ref_pts)

    if geo.H is None:
        result = {
            "status": "failed",
            "reason": "Homography estimation failed (insufficient matches or degenerate configuration).",
            "total_matches": int(len(match_res.src_pts)),
            "matcher_used": match_res.matcher_used,
        }
        return result

    scale_refined = preprocessing.refine_scale_from_homography(geo.H)

    selected_mask = geometry.enforce_uniform_distribution(
        match_res.ref_pts, geo.inlier_mask, ref_proc.shape, grid_n=6, max_per_cell=12)
    u_score_all = geometry.uniformity_score(match_res.ref_pts, geo.inlier_mask, ref_proc.shape)
    u_score_selected = geometry.uniformity_score(match_res.ref_pts, selected_mask, ref_proc.shape)

    inlier_src = match_res.src_pts[geo.inlier_mask]
    inlier_ref = match_res.ref_pts[geo.inlier_mask]
    rmse_pre_refine = metrics.reprojection_rmse(inlier_src, inlier_ref, geo.H)

    refined_src, refine_stats = refinement.refine_points_phase_correlation(
        src_proc, ref_proc, inlier_src, inlier_ref, geo.H)
    if refine_stats.get("skipped_scale_guard"):
        print(f"[refinement] SKIPPED entirely — local homography scale ratio "
              f"{refine_stats.get('scale_ratio')} exceeds max_scale_ratio; no reliable "
              f"sub-pixel signal exists at this resolution mismatch (see refinement.py).")
    else:
        print(f"[refinement] attempted={refine_stats['attempted']} accepted={refine_stats['accepted']} "
              f"skipped_low_confidence={refine_stats['skipped_low_confidence']} "
              f"skipped_implausible_shift={refine_stats['skipped_implausible_shift']}")
    geo_refined = geometry.estimate_homography(refined_src, inlier_ref)
    H_final = geo_refined.H if geo_refined.H is not None else geo.H
    rmse_post_refine = metrics.reprojection_rmse(refined_src, inlier_ref, H_final)

    condition_ratio = metrics.homography_condition_ratio(H_final)
    homography_quality = {
        "condition_ratio": round(condition_ratio, 2),
        "degenerate": condition_ratio > metrics.DEGENERATE_HOMOGRAPHY_THRESHOLD,
        "threshold": metrics.DEGENERATE_HOMOGRAPHY_THRESHOLD,
    }

    warp_global = registration.warp_global_homography(src_proc, H_final, ref_proc.shape)
    warp_piece = registration.warp_piecewise(src_proc, refined_src, inlier_ref, ref_proc.shape)
    warp_tps_res = registration.warp_tps(src_proc, refined_src, inlier_ref, ref_proc.shape)

    rotation_consistency = metrics.pairwise_rotation_consistency(match_res.src_pts, match_res.ref_pts)
    validation = metrics.assess_validation(
        total_matches=int(len(match_res.src_pts)), inlier_count=int(geo.inlier_mask.sum()),
        inlier_ratio=float(geo.inlier_mask.mean()) if len(geo.inlier_mask) else 0.0,
        rmse_post_refinement=metrics.reprojection_rmse(refined_src, inlier_ref, H_final),
        rotation_std_deg=rotation_consistency["std_deg"])

    ssim_path = os.path.join(out_dir, "ssim_heatmap.png")
    ssim_stats = _save_ssim_heatmap(ref_proc, warp_global.warped, H_final, src_proc.shape, ssim_path)

    # Piecewise/TPS warps are computed and saved for visual + qualitative
    # comparison (registered_piecewise.png / registered_tps.png); a true
    # forward-projected piecewise RMSE would require inverse-mapping per
    # Delaunay triangle, which is not implemented — we report the global
    # homography RMSE as the quantitative number and let the images speak
    # for the local-warp quality, rather than fabricate a piecewise RMSE.
    piecewise_rmse = None

    registered_path = os.path.join(out_dir, "registered_global.png")
    cv2.imwrite(registered_path, warp_global.warped)
    registered_piecewise_path = None
    if warp_piece is not None:
        registered_piecewise_path = os.path.join(out_dir, "registered_piecewise.png")
        cv2.imwrite(registered_piecewise_path, warp_piece.warped)
    registered_tps_path = None
    if warp_tps_res is not None:
        registered_tps_path = os.path.join(out_dir, "registered_tps.png")
        cv2.imwrite(registered_tps_path, warp_tps_res.warped)

    cv2.imwrite(os.path.join(out_dir, "src_processed.png"), src_proc)
    cv2.imwrite(os.path.join(out_dir, "ref_processed.png"), ref_proc)

    n_inliers = int(geo.inlier_mask.sum())
    n_total = int(len(match_res.src_pts))
    inlier_ratio = float(n_inliers / n_total) if n_total else 0.0

    inlier_indices = np.where(geo.inlier_mask)[0]
    pos_in_inliers = {int(idx): k for k, idx in enumerate(inlier_indices)}

    match_points = []
    for i in range(n_total):
        entry = {
            "src_x": float(match_res.src_pts[i][0]), "src_y": float(match_res.src_pts[i][1]),
            "ref_x": float(match_res.ref_pts[i][0]), "ref_y": float(match_res.ref_pts[i][1]),
            "confidence": float(match_res.confidences[i]) if i < len(match_res.confidences) else None,
            "inlier": bool(geo.inlier_mask[i]),
            "uniform_selected": bool(selected_mask[i]),
            "refined_src_x": None, "refined_src_y": None, "refinement_offset_px": None,
        }
        if i in pos_in_inliers:
            k = pos_in_inliers[i]
            rx, ry = float(refined_src[k][0]), float(refined_src[k][1])
            entry["refined_src_x"], entry["refined_src_y"] = rx, ry
            entry["refinement_offset_px"] = float(np.hypot(rx - entry["src_x"], ry - entry["src_y"]))
        match_points.append(entry)

    with open(os.path.join(out_dir, "match_points.json"), "w") as f:
        json.dump(match_points, f, indent=2)
    with open(os.path.join(out_dir, "match_points.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(match_points[0].keys()) if match_points else
                            ["src_x", "src_y", "ref_x", "ref_y", "confidence", "inlier", "uniform_selected"])
        w.writeheader()
        w.writerows(match_points)

    sensor_type = sensor_type or _sensor_from_path(src_path)
    elapsed = time.time() - t0

    result = {
        "status": "ok",
        "sensor_type": sensor_type,
        "matcher_used": match_res.matcher_used,
        "matcher_selection": matcher_summary,
        "geometry_method": geo.method,
        "total_matches": n_total,
        "inlier_count": n_inliers,
        "inlier_ratio": round(inlier_ratio, 4),
        "rmse_pre_refinement": None if np.isnan(rmse_pre_refine) else round(rmse_pre_refine, 4),
        "rmse_post_refinement": None if np.isnan(rmse_post_refine) else round(rmse_post_refine, 4),
        "rmse_improvement_pct": (
            round(100 * (rmse_pre_refine - rmse_post_refine) / rmse_pre_refine, 2)
            if rmse_pre_refine and not np.isnan(rmse_pre_refine) and rmse_pre_refine > 0
            and not np.isnan(rmse_post_refine) else None
        ),
        "uniformity_score_all_inliers": None if np.isnan(u_score_all) else round(u_score_all, 4),
        "uniformity_score_selected": None if np.isnan(u_score_selected) else round(u_score_selected, 4),
        "n_uniform_selected": int(selected_mask.sum()),
        "estimated_scale_factor_dimension_based": round(scale_est.factor, 4),
        "estimated_scale_factor_from_homography": round(scale_refined, 4),
        "src_keypoints": match_res.n_keypoints_src,
        "ref_keypoints": match_res.n_keypoints_ref,
        "homography": H_final.tolist(),
        "warps_computed": {
            "global_homography": registered_path,
            "piecewise_affine": registered_piecewise_path,
            "thin_plate_spline": registered_tps_path,
            "ssim_heatmap": ssim_path,
            "ssim_data": ssim_stats.get("data_json_path"),
        },
        "rotation_consistency": rotation_consistency,
        "homography_quality": homography_quality,
        "ssim": ssim_stats,
        "validation": validation,
        "elapsed_seconds": round(elapsed, 3),
        "src_path": src_path,
        "ref_path": ref_path,
        "out_dir": out_dir,
        "refinement_stats": refine_stats,
        "multi_scale_leveling": {
            "dimension_based_factor": round(scale_est.factor, 4),
            "src_scale_applied": leveled.src_scale_applied,
            "ref_scale_applied": leveled.ref_scale_applied,
        },
        "ingestion": {
            "src_format": src_img.source_format,
            "ref_format": ref_img.source_format,
            "src_original_shape": src_img.original_shape,
            "ref_original_shape": ref_img.original_shape,
            "src_geometry": src_img.geometry,
            "ref_geometry": ref_img.geometry,
            "warnings": ingestion_warnings,
        },
    }

    with open(os.path.join(out_dir, "metrics.json"), "w") as f:
        json.dump(result, f, indent=2)

    mem_info = memory.save_run(memory.RunRecord(
        src_path=src_path, ref_path=ref_path, sensor_type=sensor_type,
        matcher_used=match_res.matcher_used,
        rmse=rmse_post_refine if not np.isnan(rmse_post_refine) else rmse_pre_refine,
        rmse_refined=rmse_post_refine, inlier_count=n_inliers, inlier_ratio=inlier_ratio,
        total_matches=n_total, uniformity_score=u_score_selected if not np.isnan(u_score_selected) else u_score_all,
        global_rmse=rmse_post_refine, piecewise_rmse=piecewise_rmse or 0.0,
        result_json=json.dumps({k: v for k, v in result.items() if k != "homography"}),
        run_dir=os.path.basename(os.path.normpath(out_dir)),
    ))
    result["memory"] = mem_info

    with open(os.path.join(out_dir, "metrics.json"), "w") as f:
        json.dump(result, f, indent=2)

    return result


def run_registration_manual_seed(src_path: str, ref_path: str, out_dir: str,
                                  seed_points: list, illum_mode: str | None = None,
                                  sensor_type: str | None = None,
                                  reproj_thresh: float = 8.0) -> dict:
    """Manual/semi-automated registration: skips automated feature matching
    entirely and instead takes human-clicked corresponding points (at least
    4), fits a homography from those, then runs the same automatic sub-pixel
    refinement (phase correlation) used in the automated path to tighten each
    seed click to real sub-pixel precision.

    Why this exists: automated appearance-based matching (SIFT, LoFTR,
    geometry-windowed template correlation, dense correlation) was tried and
    ruled out on real Chandrayaan-2/NAC pairs over repetitive lunar terrain
    (see TASKS.md) — the terrain itself is too self-similar for any tested
    matcher to disambiguate automatically. A past team tackling the identical
    TMC-2/NAC registration problem (astroclubiitk, Inter-IIT Tech Meet 2023)
    independently converged on the same conclusion and used fully manual
    point placement (GIMP) with no automated matching at all. This function
    is the automated-refinement-assisted version of that: a human supplies
    approximate correspondences (easy for a human eye, hard for a matcher on
    this terrain), and the machine still does the sub-pixel precision work,
    the geometric verification, and the warping — only the disambiguation
    step is human.

    `seed_points`: list of {"src": [x, y], "ref": [x, y]} in the *processed*
    (post illumination-normalization, full-resolution) image coordinate
    space — i.e. the same images returned by a prior prepare/preprocess call.
    A higher `reproj_thresh` than the automated path's default (3.0) is used
    because manual clicks on a screen-scaled image are inherently less
    precise than detector keypoints; MAGSAC++ still runs and can reject an
    obviously mis-clicked point as an outlier if enough other points agree.
    """
    os.makedirs(out_dir, exist_ok=True)
    t0 = time.time()
    if illum_mode is None:
        illum_mode = "gradient"

    if len(seed_points) < 4:
        return {"status": "failed",
                "reason": f"Need at least 4 seed point pairs, got {len(seed_points)}."}

    src_img = ingestion.load_image(src_path)
    ref_img = ingestion.load_image(ref_path)
    src_u8_raw = ingestion.to_uint8(src_img.gray)
    ref_u8_raw = ingestion.to_uint8(ref_img.gray)
    src_proc = preprocessing.illumination_normalize(src_u8_raw, illum_mode)
    ref_proc = preprocessing.illumination_normalize(ref_u8_raw, illum_mode)
    print(f"[manual seed] {len(seed_points)} seed points, illum_mode={illum_mode}")

    src_pts = np.array([p["src"] for p in seed_points], dtype=np.float32)
    ref_pts = np.array([p["ref"] for p in seed_points], dtype=np.float32)
    for name, pts, shape in (("src", src_pts, src_proc.shape), ("ref", ref_pts, ref_proc.shape)):
        h, w = shape[:2]
        if not np.all((pts[:, 0] >= 0) & (pts[:, 0] < w) & (pts[:, 1] >= 0) & (pts[:, 1] < h)):
            return {"status": "failed",
                    "reason": f"One or more {name} seed points fall outside the {name} image "
                              f"({w}x{h}) — check the coordinate space they were clicked in."}

    geo = geometry.estimate_homography(src_pts, ref_pts, reproj_thresh=reproj_thresh)
    if geo.H is None:
        return {"status": "failed",
                "reason": "Homography estimation failed from seed points (degenerate configuration "
                          "— check that points aren't collinear/clustered and correspond correctly).",
                "total_matches": len(seed_points)}

    n_inliers = int(geo.inlier_mask.sum())
    if n_inliers < 4:
        return {"status": "failed",
                "reason": f"Only {n_inliers}/{len(seed_points)} seed points were geometrically "
                          f"consistent (MAGSAC++ inliers) — need at least 4. Re-check your clicks.",
                "total_matches": len(seed_points), "inlier_count": n_inliers}

    inlier_src = src_pts[geo.inlier_mask]
    inlier_ref = ref_pts[geo.inlier_mask]
    rmse_pre_refine = metrics.reprojection_rmse(inlier_src, inlier_ref, geo.H)

    refined_src, refine_stats = refinement.refine_points_phase_correlation(
        src_proc, ref_proc, inlier_src, inlier_ref, geo.H)
    print(f"[refinement] attempted={refine_stats.get('attempted')} accepted={refine_stats.get('accepted')} "
          f"skipped_scale_guard={refine_stats.get('skipped_scale_guard')}")

    geo_refined = geometry.estimate_homography(refined_src, inlier_ref, reproj_thresh=reproj_thresh)
    H_final = geo_refined.H if geo_refined.H is not None else geo.H
    rmse_post_refine = metrics.reprojection_rmse(refined_src, inlier_ref, H_final)

    condition_ratio = metrics.homography_condition_ratio(H_final)
    homography_quality = {
        "condition_ratio": round(condition_ratio, 2),
        "degenerate": condition_ratio > metrics.DEGENERATE_HOMOGRAPHY_THRESHOLD,
        "threshold": metrics.DEGENERATE_HOMOGRAPHY_THRESHOLD,
    }

    warp_global = registration.warp_global_homography(src_proc, H_final, ref_proc.shape)
    warp_piece = registration.warp_piecewise(src_proc, refined_src, inlier_ref, ref_proc.shape)
    warp_tps_res = registration.warp_tps(src_proc, refined_src, inlier_ref, ref_proc.shape)

    rotation_consistency = metrics.pairwise_rotation_consistency(src_pts, ref_pts)
    validation = metrics.assess_validation(
        total_matches=len(seed_points), inlier_count=n_inliers,
        inlier_ratio=n_inliers / len(seed_points),
        rmse_post_refinement=rmse_post_refine, rotation_std_deg=rotation_consistency["std_deg"])

    ssim_path = os.path.join(out_dir, "ssim_heatmap.png")
    ssim_stats = _save_ssim_heatmap(ref_proc, warp_global.warped, H_final, src_proc.shape, ssim_path)

    registered_path = os.path.join(out_dir, "registered_global.png")
    cv2.imwrite(registered_path, warp_global.warped)
    registered_piecewise_path = None
    if warp_piece is not None:
        registered_piecewise_path = os.path.join(out_dir, "registered_piecewise.png")
        cv2.imwrite(registered_piecewise_path, warp_piece.warped)
    registered_tps_path = None
    if warp_tps_res is not None:
        registered_tps_path = os.path.join(out_dir, "registered_tps.png")
        cv2.imwrite(registered_tps_path, warp_tps_res.warped)
    cv2.imwrite(os.path.join(out_dir, "src_processed.png"), src_proc)
    cv2.imwrite(os.path.join(out_dir, "ref_processed.png"), ref_proc)

    inlier_pos = {int(idx): k for k, idx in enumerate(np.where(geo.inlier_mask)[0])}
    match_points = []
    for i in range(len(seed_points)):
        entry = {
            "src_x": float(src_pts[i][0]), "src_y": float(src_pts[i][1]),
            "ref_x": float(ref_pts[i][0]), "ref_y": float(ref_pts[i][1]),
            "confidence": None, "inlier": bool(geo.inlier_mask[i]), "uniform_selected": bool(geo.inlier_mask[i]),
            "refined_src_x": None, "refined_src_y": None, "refinement_offset_px": None,
        }
        if i in inlier_pos:
            k = inlier_pos[i]
            rx, ry = float(refined_src[k][0]), float(refined_src[k][1])
            entry["refined_src_x"], entry["refined_src_y"] = rx, ry
            entry["refinement_offset_px"] = float(np.hypot(rx - entry["src_x"], ry - entry["src_y"]))
        match_points.append(entry)
    with open(os.path.join(out_dir, "match_points.json"), "w") as f:
        json.dump(match_points, f, indent=2)

    sensor_type = sensor_type or _sensor_from_path(src_path)
    elapsed = time.time() - t0

    result = {
        "status": "ok",
        "mode": "manual_seed",
        "sensor_type": sensor_type,
        "matcher_used": "manual_seed",
        "geometry_method": geo.method,
        "total_matches": len(seed_points),
        "inlier_count": n_inliers,
        "inlier_ratio": round(n_inliers / len(seed_points), 4),
        "rmse_pre_refinement": None if np.isnan(rmse_pre_refine) else round(rmse_pre_refine, 4),
        "rmse_post_refinement": None if np.isnan(rmse_post_refine) else round(rmse_post_refine, 4),
        "rmse_improvement_pct": (
            round(100 * (rmse_pre_refine - rmse_post_refine) / rmse_pre_refine, 2)
            if rmse_pre_refine and not np.isnan(rmse_pre_refine) and rmse_pre_refine > 0
            and not np.isnan(rmse_post_refine) else None
        ),
        "homography": H_final.tolist(),
        "warps_computed": {
            "global_homography": registered_path,
            "piecewise_affine": registered_piecewise_path,
            "thin_plate_spline": registered_tps_path,
            "ssim_heatmap": ssim_path,
            "ssim_data": ssim_stats.get("data_json_path"),
        },
        "rotation_consistency": rotation_consistency,
        "homography_quality": homography_quality,
        "ssim": ssim_stats,
        "validation": validation,
        "elapsed_seconds": round(elapsed, 3),
        "src_path": src_path,
        "ref_path": ref_path,
        "out_dir": out_dir,
        "refinement_stats": refine_stats,
    }
    with open(os.path.join(out_dir, "metrics.json"), "w") as f:
        json.dump(result, f, indent=2)

    mem_info = memory.save_run(memory.RunRecord(
        src_path=src_path, ref_path=ref_path, sensor_type=sensor_type,
        matcher_used="manual_seed",
        rmse=rmse_post_refine if not np.isnan(rmse_post_refine) else rmse_pre_refine,
        rmse_refined=rmse_post_refine, inlier_count=n_inliers, inlier_ratio=n_inliers / len(seed_points),
        total_matches=len(seed_points), uniformity_score=float("nan"),
        global_rmse=rmse_post_refine, piecewise_rmse=0.0,
        result_json=json.dumps({k: v for k, v in result.items() if k != "homography"}),
        run_dir=os.path.basename(os.path.normpath(out_dir)),
    ))
    result["memory"] = mem_info
    with open(os.path.join(out_dir, "metrics.json"), "w") as f:
        json.dump(result, f, indent=2)

    return result


def main():
    ap = argparse.ArgumentParser(description="Lunar image correspondence pipeline")
    ap.add_argument("src")
    ap.add_argument("ref")
    ap.add_argument("--out", default="backend/outputs/run")
    ap.add_argument("--matcher", default="auto", choices=["classical", "deep", "auto"])
    ap.add_argument("--illum", default=None, choices=["none", "clahe", "gradient", "both"],
                     help="Illumination normalization mode (default: gradient — measured-best, see TASKS.md)")
    ap.add_argument("--no-clahe", action="store_true", help="Deprecated alias for --illum none")
    ap.add_argument("--sensor", default=None)
    args = ap.parse_args()

    illum_mode = args.illum if args.illum is not None else ("none" if args.no_clahe else None)
    result = run_registration(args.src, args.ref, args.out, matcher=args.matcher,
                               illum_mode=illum_mode, sensor_type=args.sensor)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
