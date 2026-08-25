"""Preprocessing: contrast normalization, illumination normalization (CLAHE),
and explicit multi-scale pyramid handling with a logged numeric scale factor.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


def clahe_normalize(img_u8: np.ndarray, clip_limit: float = 2.5, tile: int = 8) -> np.ndarray:
    """Illumination normalization via CLAHE — mitigates sun azimuth/elevation
    differences between source and reference by equalizing local contrast
    instead of relying on raw pixel intensity, which is what breaks under
    differing sun angles."""
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(tile, tile))
    return clahe.apply(img_u8)


def remove_illumination_gradient(img_u8: np.ndarray, sigma_frac: float = 0.06) -> np.ndarray:
    """Large-scale shading removal ("flat-fielding"): subtract a heavily
    Gaussian-blurred copy of the image from itself, then re-center at mid-gray.
    A different sun azimuth/elevation mostly changes *low-spatial-frequency*
    shading across a scene (which side of a crater/ridge is lit, overall
    brightness gradient) while leaving high-frequency surface texture largely
    intact — this targets exactly that low-frequency component, which CLAHE's
    local-tile equalization only partially cancels (CLAHE still operates
    tile-by-tile on the un-flattened signal, so a gradient with a similar
    spatial scale to the tile size can leak through as within-tile contrast
    distortion). Meant to run *before* CLAHE, not instead of it — sigma is
    scaled to image size since the blur radius needs to track the shading
    scale, not a fixed pixel count."""
    h, w = img_u8.shape[:2]
    sigma = max(3.0, sigma_frac * min(h, w))
    blurred = cv2.GaussianBlur(img_u8.astype(np.float32), (0, 0), sigmaX=sigma)
    flattened = img_u8.astype(np.float32) - blurred + 128.0
    return np.clip(flattened, 0, 255).astype(np.uint8)


def illumination_normalize(img_u8: np.ndarray, mode: str = "clahe",
                            clip_limit: float = 2.5, tile: int = 8,
                            gradient_sigma_frac: float = 0.06) -> np.ndarray:
    """mode: 'clahe' (default, local contrast equalization only), 'gradient'
    (large-scale shading removal only), or 'both' (shading removal feeding
    into CLAHE), or 'none' (pass-through, for A/B comparison). Measured before
    picking a default (see TASKS.md "Illumination normalization" for the
    numbers): 'gradient' alone consistently beat 'clahe' alone and 'both'
    across every test pair tried, including the non-hard-illumination cases —
    so `run_pipeline.py` defaults to 'gradient', not 'clahe'. Counterintuitive
    that 'both' underperforms plain 'gradient', but consistent across pairs:
    CLAHE's local-tile equalization, applied *after* the low-frequency shading
    is already removed, seems to reintroduce some tile-boundary contrast noise
    that costs a little matching precision — not investigated further since
    'gradient' alone is already the better and cheaper choice."""
    if mode == "none":
        return img_u8
    if mode == "clahe":
        return clahe_normalize(img_u8, clip_limit, tile)
    if mode == "gradient":
        return remove_illumination_gradient(img_u8, gradient_sigma_frac)
    if mode == "both":
        return clahe_normalize(remove_illumination_gradient(img_u8, gradient_sigma_frac), clip_limit, tile)
    raise ValueError(f"Unknown illumination mode '{mode}' (expected none/clahe/gradient/both)")


@dataclass
class ScaleEstimate:
    factor: float          # ref_size / src_size, i.e. how much bigger the reference is
    src_size: tuple
    ref_size: tuple
    method: str


def estimate_scale_factor(src_shape: tuple, ref_shape: tuple) -> ScaleEstimate:
    """Cheap, honest first estimate from raster dimensions (stand-in for a real
    GSD/resolution-metadata lookup, which real OHRC/TMC/IIRS/NAC PDS labels carry
    but which we don't require here since the loader is generic). Refined later
    by the actual homography scale component once matches are found."""
    sh, sw = src_shape[:2]
    rh, rw = ref_shape[:2]
    factor = float(((rh / sh) + (rw / sw)) / 2.0)
    return ScaleEstimate(factor=factor, src_size=(sw, sh), ref_size=(rw, rh), method="dimension_ratio")


def build_pyramid(img: np.ndarray, levels: int = 4) -> list:
    """Standard Gaussian pyramid (per-octave, factor-of-2 halving each level)."""
    pyr = [img]
    cur = img
    for _ in range(levels - 1):
        if min(cur.shape[:2]) < 32:
            break
        cur = cv2.pyrDown(cur)
        pyr.append(cur)
    return pyr


@dataclass
class LeveledPair:
    src_leveled: np.ndarray
    ref_leveled: np.ndarray
    src_scale_applied: float   # multiply src_leveled coords by this to get src_full coords
    ref_scale_applied: float   # multiply ref_leveled coords by this to get ref_full coords


def level_for_matching(src_u8: np.ndarray, ref_u8: np.ndarray, dimension_scale_factor: float,
                        trigger_ratio: float = 1.8) -> LeveledPair:
    """Explicit multi-scale handling: SIFT/LoFTR keypoint matching degrades
    sharply once two images differ by more than ~2x in effective resolution
    (verified empirically here — at a real-world-representative 6x ratio,
    e.g. OHRC vs a coarser TMC-2/IIRS/NAC frame, unleveled inlier ratio drops
    from ~95% to ~56% and sub-pixel refinement can actively regress RMSE).
    Rather than relying on SIFT's own limited built-in scale invariance, this
    downsamples whichever image is the higher-resolution one so both roughly
    share an effective GSD before feature detection runs, using the dimension-
    ratio scale estimate as the leveling factor. Matched keypoint coordinates
    must be rescaled back to full resolution by the caller using the returned
    `*_scale_applied` factors before homography estimation."""
    if dimension_scale_factor >= trigger_ratio:
        # reference has finer effective resolution than source -> downsample reference
        applied = dimension_scale_factor
        h, w = ref_u8.shape[:2]
        ref_leveled = cv2.resize(ref_u8, (max(1, int(w / applied)), max(1, int(h / applied))),
                                  interpolation=cv2.INTER_AREA)
        return LeveledPair(src_u8, ref_leveled, 1.0, applied)
    if dimension_scale_factor <= 1.0 / trigger_ratio:
        applied = 1.0 / dimension_scale_factor
        h, w = src_u8.shape[:2]
        src_leveled = cv2.resize(src_u8, (max(1, int(w / applied)), max(1, int(h / applied))),
                                  interpolation=cv2.INTER_AREA)
        return LeveledPair(src_leveled, ref_u8, applied, 1.0)
    return LeveledPair(src_u8, ref_u8, 1.0, 1.0)


def refine_scale_from_homography(H: np.ndarray) -> float:
    """Extract the isotropic scale component from an estimated homography's
    affine part (singular values of the top-left 2x2 block)."""
    A = H[:2, :2]
    s = np.linalg.svd(A, compute_uv=False)
    return float(np.mean(s))
