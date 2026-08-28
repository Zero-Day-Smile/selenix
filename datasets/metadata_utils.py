"""Shared helpers for the datasets/ package: coordinate convention, contrast
stretch, footprint overlap.

This project already validated two things the hard way that this module
deliberately reuses rather than re-deriving:

1. **Contrast stretch**: a fixed 2nd/98th-percentile stretch (the textbook
   default, implemented here as `fixed_percentile_stretch` for spec
   completeness) washes out real images whose dense pixel core is much
   narrower than that -- confirmed on ~1/3 of a real 21-frame NAC sample
   (see TASKS.md "Real bug fixed: systematic stretch-range issue"). The
   fix, `ingestion.to_uint8_adaptive()` (median +/- 3*IQR, floored by a
   safety percentile), already exists and is reused here as the DEFAULT
   stretch for this dataset package -- not reimplemented a second time.
2. **Longitude convention**: LRO NAC KML footprints use -180/180; both real
   crater catalogs (Robbins, USGS Gazetteer) and Chandrayaan-2 geometry
   CSVs use 0-360. `normalize_longitude_0_360` is the single place this
   conversion happens, matching the existing convention already
   established in backend/data/real/_overlap_maps.py::get_kml_corners.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.pipeline import ingestion  # noqa: E402  (path bootstrap above)


def normalize_longitude_0_360(lon: float) -> float:
    """LRO NAC KML footprints are -180/180; the Robbins catalog, the USGS
    Gazetteer, and Chandrayaan-2 geometry CSVs are all 0-360 (confirmed
    empirically against real catalog data, see crater_catalog.py). Apply
    this once, here, rather than re-deriving the same `if lon < 0: lon +=
    360` in every module that touches a longitude."""
    lon = float(lon) % 360.0
    return lon + 360.0 if lon < 0 else lon


def fixed_percentile_stretch(image: np.ndarray, low: float = 2.0, high: float = 98.0) -> np.ndarray:
    """The textbook 2nd/98th-percentile linear stretch, output range [0, 1]
    float32. Provided for spec completeness and for A/B comparison, but NOT
    the default this package's readers use -- see module docstring for why
    (real, measured failure mode on ~1/3 of a real dataset)."""
    p_lo, p_hi = np.percentile(image, [low, high])
    clipped = np.clip(image.astype(np.float32), p_lo, p_hi)
    return (clipped - p_lo) / (p_hi - p_lo + 1e-8)


def adaptive_stretch(image: np.ndarray) -> np.ndarray:
    """Default stretch for this package: reuses the already-validated
    median +/- 3*IQR adaptive stretch (ingestion.to_uint8_adaptive), then
    rescales its uint8 output to float32 [0, 1]. Applied per-image, never
    across a batch -- each real image's own dense-core statistics are what
    matter, not a batch-wide constant."""
    u8 = ingestion.to_uint8_adaptive(image)
    return u8.astype(np.float32) / 255.0


def footprint_overlap_guard(bbox1: tuple, bbox2: tuple, min_overlap_frac: float = 0.10):
    """bbox = (lon_min, lon_max, lat_min, lat_max), already normalized to
    0-360. Returns (overlaps: bool, overlap_frac: float, overlap_bbox or
    None). overlap_frac is the overlap area as a fraction of the SMALLER
    of the two footprints' own area -- rejecting a pair below
    min_overlap_frac (default 10%) prevents wasting real matching compute
    on pairs with no meaningful shared ground content, a real, confirmed
    issue in this project's own testing (8/20 previously-tested pairs had
    this problem before geo_extent_guard.py's verified_overlap_extent was
    built -- see TASKS.md)."""
    lon1_min, lon1_max, lat1_min, lat1_max = bbox1
    lon2_min, lon2_max, lat2_min, lat2_max = bbox2

    ov_lon_min, ov_lon_max = max(lon1_min, lon2_min), min(lon1_max, lon2_max)
    ov_lat_min, ov_lat_max = max(lat1_min, lat2_min), min(lat1_max, lat2_max)
    if ov_lon_max <= ov_lon_min or ov_lat_max <= ov_lat_min:
        return False, 0.0, None

    overlap_area = (ov_lon_max - ov_lon_min) * (ov_lat_max - ov_lat_min)
    area1 = (lon1_max - lon1_min) * (lat1_max - lat1_min)
    area2 = (lon2_max - lon2_min) * (lat2_max - lat2_min)
    smaller_area = min(area1, area2)
    if smaller_area <= 0:
        return False, 0.0, None

    overlap_frac = overlap_area / smaller_area
    overlap_bbox = (ov_lon_min, ov_lon_max, ov_lat_min, ov_lat_max)
    return overlap_frac >= min_overlap_frac, overlap_frac, overlap_bbox
