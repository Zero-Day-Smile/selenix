"""Layer A of the shadow/PSR feature: identifies pixels that are dark AT THE
MOMENT THIS SPECIFIC IMAGE WAS CAPTURED. This is NOT a permanent-shadow (PSR)
determination -- permanence can only be established by modeling illumination
over years (the real LOLA GDRPSR product, Mazarico et al. 2011), not a
single frame. Callers must label this "shadowed at time of capture," never
"permanent" or "PSR," unless independently cross-referenced against real
PSR ground truth (see backend/app/main.py's PSR-coverage check, which found
none of our real images fall within any published PSR product's latitude
coverage -- so that cross-reference currently has nothing to confirm
against on our real data, and this module's output must stand alone as
transient shadow only).

Reuses the exact sparse-dark-tail bound already validated as real
(non-noise, non-clipped) content in ingestion.to_uint8_adaptive's histogram
diagnostic work -- not a new, unvalidated threshold."""
from __future__ import annotations

import numpy as np
import cv2


def identify_shadow_mask(gray: np.ndarray, safety_percentile: tuple = (2, 98),
                          iqr_multiplier: float = 3.0) -> dict:
    """Boolean mask of pixels below the image's own sparse-dark-tail bound:
    max(safety-percentile floor, median - iqr_multiplier * IQR). Same bound
    ingestion.to_uint8_adaptive uses to decide what NOT to over-stretch --
    here used directly as the shadow criterion instead."""
    sample = gray
    if gray.size > 2_000_000:
        rng = np.random.default_rng(0)
        idx = rng.integers(0, gray.size, size=2_000_000)
        sample = gray.ravel()[idx]

    p_lo_safety, _ = np.percentile(sample, safety_percentile)
    median = np.median(sample)
    q1, q3 = np.percentile(sample, [25, 75])
    iqr = q3 - q1
    threshold = float(p_lo_safety) if iqr <= 0 else max(float(p_lo_safety), float(median - iqr_multiplier * iqr))

    mask = gray < threshold
    return {
        "mask": mask,
        "threshold": threshold,
        "shadow_pixel_count": int(mask.sum()),
        "shadow_fraction": float(mask.mean()),
        "method": f"sparse dark tail: gray < max(p{safety_percentile[0]}, median - {iqr_multiplier}*IQR)",
    }


def find_shadow_regions(mask: np.ndarray, min_area_px: int = 30, max_regions: int = 60) -> list[dict]:
    """Real connected-component segmentation of the shadow mask (cv2, 8-
    connectivity) -- one entry per distinct dark blob, with its real
    centroid and pixel area, so the UI can offer a clickable marker per
    region instead of only a passive raster tint. Capped to the largest
    `max_regions` by area for readability; every real blob still counts
    toward `shadow_pixel_count`/`shadow_fraction` in identify_shadow_mask,
    this cap only affects how many get their own marker."""
    num, _labels, stats, centroids = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    regions = []
    for i in range(1, num):  # label 0 is background
        area = int(stats[i, cv2.CC_STAT_AREA])
        if area < min_area_px:
            continue
        cx, cy = centroids[i]
        regions.append({
            "pixel_x": float(cx), "pixel_y": float(cy),
            "area_px": area,
            "bbox": {
                "x": int(stats[i, cv2.CC_STAT_LEFT]), "y": int(stats[i, cv2.CC_STAT_TOP]),
                "w": int(stats[i, cv2.CC_STAT_WIDTH]), "h": int(stats[i, cv2.CC_STAT_HEIGHT]),
            },
        })
    regions.sort(key=lambda r: -r["area_px"])
    return regions[:max_regions]


def render_shadow_overlay_png(mask: np.ndarray, out_path: str, color_bgr: tuple = (0, 140, 255), alpha: int = 160) -> None:
    """RGBA PNG, fully transparent where not-shadow, semi-opaque orange where
    shadow -- meant to be layered over the base image at partial opacity in
    the viewer, same pattern as the SSIM heatmap's validity-alpha channel."""
    h, w = mask.shape[:2]
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., 0] = color_bgr[0]
    rgba[..., 1] = color_bgr[1]
    rgba[..., 2] = color_bgr[2]
    rgba[..., 3] = np.where(mask, alpha, 0).astype(np.uint8)
    cv2.imwrite(out_path, rgba)
