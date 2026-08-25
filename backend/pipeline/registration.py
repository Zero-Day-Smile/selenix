"""Registration/warping: global homography (baseline) and piecewise-local /
TPS warp (primary — required because lunar relief violates the flat-scene
assumption of a single global homography)."""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from skimage.transform import PiecewiseAffineTransform, warp as sk_warp


@dataclass
class WarpResult:
    warped: np.ndarray
    method: str


def warp_global_homography(src_u8: np.ndarray, H: np.ndarray, ref_shape: tuple) -> WarpResult:
    h, w = ref_shape[:2]
    warped = cv2.warpPerspective(src_u8, H, (w, h))
    return WarpResult(warped, "global_homography")


def warp_piecewise(src_u8: np.ndarray, src_pts: np.ndarray, ref_pts: np.ndarray,
                    ref_shape: tuple) -> WarpResult | None:
    """Piecewise-affine warp via Delaunay triangulation of matched points —
    lets local regions (craters, ridges) deform independently instead of one
    rigid global transform. Requires at least ~6 well-spread points; returns
    None (caller keeps the global-homography result) if too few."""
    if len(src_pts) < 6:
        return None
    try:
        tform = PiecewiseAffineTransform.from_estimate(ref_pts, src_pts)  # skimage warp maps output->input
    except AttributeError:
        tform = PiecewiseAffineTransform()
        if not tform.estimate(ref_pts, src_pts):
            return None
    if tform is None:
        return None
    h, w = ref_shape[:2]
    warped = sk_warp(src_u8, tform, output_shape=(h, w), order=1, mode="constant", cval=0)
    warped_u8 = (warped * 255).astype(np.uint8) if warped.dtype != np.uint8 else warped
    return WarpResult(warped_u8, "piecewise_affine")


def warp_tps(src_u8: np.ndarray, src_pts: np.ndarray, ref_pts: np.ndarray,
             ref_shape: tuple) -> WarpResult | None:
    """Thin-plate-spline warp via OpenCV's ShapeTransformer — smooth global
    non-rigid deformation, alternative to piecewise-affine for local relief."""
    if len(src_pts) < 6:
        return None
    try:
        tps = cv2.createThinPlateSplineShapeTransformer()
        matches = [cv2.DMatch(i, i, 0) for i in range(len(src_pts))]
        src_shape_pts = src_pts.reshape(1, -1, 2).astype(np.float32)
        ref_shape_pts = ref_pts.reshape(1, -1, 2).astype(np.float32)
        tps.estimateTransformation(ref_shape_pts, src_shape_pts, matches)
        h, w = ref_shape[:2]
        warped = tps.warpImage(src_u8, flags=cv2.INTER_LINEAR,
                                borderMode=cv2.BORDER_CONSTANT, borderValue=(0,))
        if warped.shape[:2] != (h, w):
            warped = cv2.resize(warped, (w, h))
        return WarpResult(warped, "thin_plate_spline")
    except cv2.error:
        return None
