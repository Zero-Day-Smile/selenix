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
