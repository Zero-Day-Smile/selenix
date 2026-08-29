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


MAX_TPS_CONTROL_POINTS = 300  # see warp_tps docstring for why this cap exists


def warp_tps(src_u8: np.ndarray, src_pts: np.ndarray, ref_pts: np.ndarray,
             ref_shape: tuple) -> WarpResult | None:
    """Thin-plate-spline warp via OpenCV's ShapeTransformer — smooth global
    non-rigid deformation, alternative to piecewise-affine for local relief.

    OpenCV's TPS solve is an (N+3)x(N+3) linear system in the control-point
    count N -- effectively O(N^3). Real cross-sensor pairs this project has
    tested rarely exceed a few hundred inliers, so this was never a problem
    in practice; a synthetic same-source pair (as used by the invariance
    sweep) can genuinely produce 1000+ inliers, since matching a real image
    against a known transform of itself is a far easier problem than
    matching two different sensors -- and at that point count this stage
    alone measured 27s on a real pair, dwarfing every other pipeline stage
    combined (match+geometry+refinement together: ~7s). This is a real,
    general pipeline cost, not something specific to synthetic pairs, so a
    real pair that happens to produce this many inliers would hit it too.

    Fix: when there are more than MAX_TPS_CONTROL_POINTS, use a fixed-seed
    uniform random subsample rather than all of them. A smooth global TPS
    deformation doesn't need every point once there are hundreds covering
    the frame -- they're spatially redundant for defining smooth relief,
    and a representative few hundred is the standard, honest mitigation
    for TPS at this point count (not a quality cut for real low-count
    pairs, which are never affected since they're already under the cap)."""
    if len(src_pts) < 6:
        return None
    if len(src_pts) > MAX_TPS_CONTROL_POINTS:
        idx = np.random.default_rng(0).choice(len(src_pts), size=MAX_TPS_CONTROL_POINTS, replace=False)
        src_pts, ref_pts = src_pts[idx], ref_pts[idx]
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
