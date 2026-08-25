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
