"""Geometric verification (MAGSAC++), uniform spatial distribution enforcement,
and uniformity scoring."""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class GeometryResult:
    H: np.ndarray | None
    inlier_mask: np.ndarray   # bool, len == n input matches
    method: str


def estimate_homography(src_pts: np.ndarray, ref_pts: np.ndarray,
                         reproj_thresh: float = 3.0) -> GeometryResult:
    if len(src_pts) < 4:
        return GeometryResult(None, np.zeros((len(src_pts),), dtype=bool), "none")

    method_flag = getattr(cv2, "USAC_MAGSAC", None)
    method_name = "MAGSAC++"
    if method_flag is None:
        method_flag = cv2.RANSAC
        method_name = "RANSAC"

    try:
        H, mask = cv2.findHomography(src_pts, ref_pts, method_flag,
                                      ransacReprojThreshold=reproj_thresh,
                                      confidence=0.999, maxIters=10000)
    except cv2.error:
        H, mask = cv2.findHomography(src_pts, ref_pts, cv2.RANSAC,
                                      ransacReprojThreshold=reproj_thresh, confidence=0.999)
        method_name = "RANSAC (MAGSAC unsupported)"

    if H is None:
        return GeometryResult(None, np.zeros((len(src_pts),), dtype=bool), method_name)

    return GeometryResult(H, mask.ravel().astype(bool), method_name)


def enforce_uniform_distribution(pts: np.ndarray, inlier_mask: np.ndarray, image_shape: tuple,
                                  grid_n: int = 6, max_per_cell: int = 12) -> np.ndarray:
    """Explicit PS requirement: uniform distribution of match points across the
    image. Buckets inlier points into an NxN grid over `image_shape` and caps
    the number kept per cell, so dense clusters (e.g. one crater rim) don't
    dominate at the expense of coverage elsewhere. Returns a boolean 'selected'
    mask (subset of inlier_mask)."""
    h, w = image_shape[:2]
    selected = np.zeros_like(inlier_mask)
    if not inlier_mask.any():
        return selected

    cell_h, cell_w = h / grid_n, w / grid_n
    idx_inliers = np.where(inlier_mask)[0]
    buckets: dict[tuple, list] = {}
    for idx in idx_inliers:
        x, y = pts[idx]
        cx, cy = min(int(x // cell_w), grid_n - 1), min(int(y // cell_h), grid_n - 1)
        buckets.setdefault((cx, cy), []).append(idx)

    for key, idxs in buckets.items():
        for idx in idxs[:max_per_cell]:
            selected[idx] = True
    return selected


def uniformity_score(pts: np.ndarray, mask: np.ndarray, image_shape: tuple, grid_n: int = 6) -> float:
    """Std dev of match density across an NxN grid, normalized so 0 = perfectly
    uniform, higher = more clustered. Only points where mask is True count."""
    h, w = image_shape[:2]
    idxs = np.where(mask)[0]
    if len(idxs) == 0:
        return float("nan")
    counts = np.zeros((grid_n, grid_n), dtype=np.float64)
    cell_h, cell_w = h / grid_n, w / grid_n
    for idx in idxs:
        x, y = pts[idx]
        cx, cy = min(int(x // cell_w), grid_n - 1), min(int(y // cell_h), grid_n - 1)
        counts[cy, cx] += 1
    mean = counts.mean()
    std = counts.std()
    return float(std / mean) if mean > 0 else float("nan")
