"""Evaluation metrics: RMSE, inlier stats, uniformity, before/after refinement
and global-vs-piecewise comparisons."""
from __future__ import annotations

import numpy as np
import cv2


def reprojection_rmse(src_pts: np.ndarray, ref_pts: np.ndarray, H: np.ndarray) -> float:
    if len(src_pts) == 0 or H is None:
        return float("nan")
    pts = src_pts.reshape(-1, 1, 2).astype(np.float32)
    proj = cv2.perspectiveTransform(pts, H).reshape(-1, 2)
    err = np.linalg.norm(proj - ref_pts, axis=1)
    return float(np.sqrt(np.mean(err ** 2)))


def per_point_reprojection_error(src_pts: np.ndarray, ref_pts: np.ndarray, H: np.ndarray) -> np.ndarray:
    """Per-match reprojection error (px), one value per row of src_pts/ref_pts.

    Same quantity RANSAC/MAGSAC++ thresholds against when classifying inliers,
    exposed per-point so a UI can re-classify at an arbitrary threshold."""
    if len(src_pts) == 0 or H is None:
        return np.zeros(0)
    pts = src_pts.reshape(-1, 1, 2).astype(np.float32)
    proj = cv2.perspectiveTransform(pts, H).reshape(-1, 2)
    return np.linalg.norm(proj - ref_pts, axis=1)


def direct_rmse(pts_a: np.ndarray, pts_b: np.ndarray) -> float:
    """RMSE between two already-corresponding point sets (no reprojection),
    used to compare warp-method outputs directly."""
    if len(pts_a) == 0:
        return float("nan")
    err = np.linalg.norm(pts_a - pts_b, axis=1)
    return float(np.sqrt(np.mean(err ** 2)))


def homography_condition_ratio(H: np.ndarray) -> float:
    """Ratio of largest to smallest singular value of the homography's linear
    (2x2) part. A well-formed homography between two roughly-planar nadir
    views is close to isotropic (ratio near 1); a degenerate/near-singular
    fit -- the kind that throws part of the warped image toward the
    projective line at infinity, producing the split radiating-streak
    pattern seen on failed real pairs -- has a large ratio. Measured across
    this project's actual results: every legitimate case (synthetic
    ground-truth pairs, and the hard-case illum/rotation/2.1x-scale pairs,
    which land near 1:1 because multi-scale leveling already normalizes
    scale before this homography is fit) sits at ~1.00:1, while every
    confirmed-failed real pair sits at 24.75:1 or 43.74:1 -- a wide, clean
    gap with no observed cases in between."""
    if H is None:
        return float("inf")
    s = np.linalg.svd(H[:2, :2], compute_uv=False)
    return float(max(s) / max(min(s), 1e-9))


DEGENERATE_HOMOGRAPHY_THRESHOLD = 5.0  # see homography_condition_ratio docstring for the real data behind this


def scale_disagreement_ratio(scale_from_homography: float, scale_from_dimensions: float) -> float:
    """How far apart the two independent scale estimates are: the
    homography-derived scale (from the fitted transform's linear part) vs
    the dimension-based scale (from the two images' real pixel/GSD extents,
    computed before any matching happens). A genuine, correctly-fit
    transform should recover close to the same scale either way; a
    degenerate fit routinely does not, because the "scale" the homography
    implies is really an artifact of a bad point configuration, not a real
    physical relationship between the two images.

    Threshold derived from this project's actual stored runs (same source
    as homography_condition_ratio's threshold): every confirmed-valid case
    (condition ratio <= 5:1) disagrees by at most 2.95x (most sit at
    ~1.00x; the highest observed valid case was a condition ratio of 4.74,
    right at the edge of the pass threshold, with 2.95x disagreement). Every
    confirmed-degenerate case with a real scale distortion disagrees by
    7.88x-10.74x. That leaves a clean, wide, unoccupied gap from ~3x to
    ~7.9x in the real measured data, unlike condition_ratio this is NOT a
    perfect classifier on its own (one real degenerate case, condition
    ratio 35.04, has only 1.75x scale disagreement -- its distortion shows
    up in shape, not overall scale) -- so this is a second, independent
    cross-check alongside the condition-ratio gate, not a replacement for
    it."""
    if not scale_from_homography or not scale_from_dimensions:
        return float("inf")
    a, b = abs(scale_from_homography), abs(scale_from_dimensions)
    return float(max(a / b, b / a))


SCALE_DISAGREEMENT_THRESHOLD = 3.0  # see scale_disagreement_ratio docstring for the real data behind this


def pairwise_rotation_consistency(src_pts: np.ndarray, ref_pts: np.ndarray,
                                   max_pairs: int = 3000, seed: int = 0) -> dict:
    """The same diagnostic used throughout this project's real-data testing
    (see TASKS.md): for each pair of matched points, compute the angle
    between the src-side vector and the ref-side vector connecting them. A
    genuine match set clusters tightly around the true relative rotation;
    spurious/random matches scatter across the full +-180 degree range. This
    turns that manual diagnostic into a stored, reusable pipeline metric so
    the frontend can show real evidence instead of a hardcoded assumption.

    Returns {"std_deg": float, "n_pairs": int} — std_deg is NaN if fewer than
    2 points (no pairs possible)."""
    n = len(src_pts)
    if n < 2:
        return {"std_deg": float("nan"), "n_pairs": 0}

    rng = np.random.default_rng(seed)
    idx_i, idx_j = np.triu_indices(n, k=1)
    if len(idx_i) > max_pairs:
        sel = rng.choice(len(idx_i), size=max_pairs, replace=False)
        idx_i, idx_j = idx_i[sel], idx_j[sel]

    src_vec = src_pts[idx_j] - src_pts[idx_i]
    ref_vec = ref_pts[idx_j] - ref_pts[idx_i]
    valid = (np.linalg.norm(src_vec, axis=1) > 1e-3) & (np.linalg.norm(ref_vec, axis=1) > 1e-3)
    src_vec, ref_vec = src_vec[valid], ref_vec[valid]
    if len(src_vec) < 2:
        return {"std_deg": float("nan"), "n_pairs": int(len(src_vec))}

    src_ang = np.degrees(np.arctan2(src_vec[:, 1], src_vec[:, 0]))
    ref_ang = np.degrees(np.arctan2(ref_vec[:, 1], ref_vec[:, 0]))
    diff = (ref_ang - src_ang + 180) % 360 - 180  # wrap to [-180, 180]
    return {"std_deg": float(np.std(diff)), "n_pairs": int(len(diff))}


def assess_validation(total_matches: int, inlier_count: int, inlier_ratio: float,
                       rmse_post_refinement: float | None, rotation_std_deg: float,
                       min_inliers: int = 20, min_inlier_ratio: float = 0.5,
                       max_rotation_std_deg: float = 15.0, max_rmse: float = 3.0) -> dict:
    """Combines stored pipeline metrics into an explicit validated/unvalidated
    verdict, driven by real thresholds derived from this project's own
    documented findings (see TASKS.md) — not a hardcoded per-result guess.
    `min_inliers=20` specifically guards against the "8/9 points, RANSAC
    trivially finds a high inlier fraction by chance" failure mode already
    documented as statistically meaningless. `max_rotation_std_deg=15` is
    conservative relative to the real failure cases measured (std 40-96 deg,
    or full +-180 deg scatter) vs. what a true match set should show (near 0)."""
    reasons = []
    if total_matches < min_inliers or inlier_count < min_inliers:
        reasons.append(f"only {inlier_count} inliers ({total_matches} total matches) — "
                        f"need >={min_inliers} to rule out a statistically meaningless small-N fit")
    if inlier_ratio < min_inlier_ratio:
        reasons.append(f"inlier ratio {inlier_ratio:.2f} below {min_inlier_ratio}")
    if rmse_post_refinement is None or (isinstance(rmse_post_refinement, float) and np.isnan(rmse_post_refinement)):
        reasons.append("no valid post-refinement RMSE")
    elif rmse_post_refinement >= max_rmse:
        reasons.append(f"post-refinement RMSE {rmse_post_refinement:.2f}px >= {max_rmse}px")
    if np.isnan(rotation_std_deg):
        reasons.append("rotation-consistency could not be computed (too few points)")
    elif rotation_std_deg > max_rotation_std_deg:
        reasons.append(f"pairwise rotation-consistency std {rotation_std_deg:.1f}deg exceeds "
                        f"{max_rotation_std_deg}deg — matches disagree on relative rotation, "
                        f"the signature of a spurious/random match set, not a real alignment")

    validated = len(reasons) == 0
    return {
        "validated": validated,
        "label": "VALIDATED ALIGNMENT" if validated else "UNVALIDATED / EXPLORATORY — NOT A CONFIRMED MATCH",
        "reasons": reasons if not validated else ["passes all validation thresholds"],
        "thresholds": {"min_inliers": min_inliers, "min_inlier_ratio": min_inlier_ratio,
                        "max_rotation_std_deg": max_rotation_std_deg, "max_rmse": max_rmse},
    }
