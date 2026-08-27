"""Synthetic sun-angle / scale / rotation invariance test generator.

Builds same-source synthetic pairs with an EXACT known ground-truth
homography, so pipeline performance against illumination, scale, and
rotation changes can be measured directly -- decoupled from the separate,
harder, still-unsolved problem of crater self-similarity on real
cross-sensor pairs (see TASKS.md for that finding, from 24 real pairs).

Ground-truth convention matches the rest of this project: H_gt maps a
SOURCE image pixel coordinate to its location in the REFERENCE image,
same direction geometry.estimate_homography(src_pts, ref_pts) fits.

- Sun-angle-only variants: relighting.relight() does not move any pixel,
  so H_gt is exactly the identity matrix.
- Scale-only variants: cv2.resize by a known factor s maps (x,y) -> (sx,
  sy) with the same origin, so H_gt = diag(s, s, 1) exactly.
- Rotation (+ optional scale) variants: cv2.getRotationMatrix2D gives the
  exact combined rotate+scale affine about the image center; the canvas
  is expanded (not cropped) so no content is lost at large angles, with
  the translation adjusted to re-center content in the larger canvas.
  That adjusted affine, extended with a [0,0,1] row, IS H_gt exactly --
  not approximated, since we control the exact warp used to produce the
  reference image.

Real GSD (ground sample distance, for reporting reprojection error in
real meters, not just pixels):
- Chandrayaan-2 TMC-2 images: derived from the image's own real
  geometry.csv (native pixel span vs. real lon/lat span, cos(lat)-
  corrected), same math as the crater-catalog endpoint
  (backend/app/main.py), then rescaled by the real native/preview pixel
  ratio since the preview PNG we actually test on is a downsampled
  version of the native-resolution product.
- LRO NAC images: no per-pixel label GSD exists in the real archive
  product we have (its PDS3 label carries no MAP_SCALE/RESOLUTION field
  -- confirmed by reading it, not assumed). Falls back to an area-based
  average from the real KML-footprint-derived frame extent already
  computed earlier in this project (backend/data/real/lro_nac/*/
  *_overlap_info.json) divided by the preview's pixel area. This is a
  real, KML-derived number, but a coarser, axis-averaged estimate than
  the CH2 method -- document this when reporting NAC-based results.
"""
from __future__ import annotations

import json
import math
import os

import cv2
import numpy as np

from . import geo_extent_guard, tmc_geometry


def lanczos_resize(gray_u8: np.ndarray, scale: float) -> np.ndarray:
    if scale == 1.0:
        return gray_u8.copy()
    h, w = gray_u8.shape[:2]
    new_w, new_h = max(1, round(w * scale)), max(1, round(h * scale))
    return cv2.resize(gray_u8, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)


def warp_scale_rotate(gray_u8: np.ndarray, scale: float = 1.0, angle_deg: float = 0.0):
    """Exact combined scale+rotate warp with an expanded (non-cropping)
    canvas. Returns (warped_image, H_gt_3x3). Skips warpAffine entirely
    for the true-identity case (scale=1, angle=0) to avoid introducing any
    resampling artifact into a case that should be a byte-for-byte pass."""
    if scale == 1.0 and angle_deg == 0.0:
        return gray_u8.copy(), np.eye(3, dtype=np.float64)

    h, w = gray_u8.shape[:2]
    center = (w / 2.0, h / 2.0)
    M = cv2.getRotationMatrix2D(center, angle_deg, scale)
    cos, sin = abs(M[0, 0]), abs(M[0, 1])
    new_w = int(round(h * sin + w * cos))
    new_h = int(round(h * cos + w * sin))
    M[0, 2] += (new_w / 2.0) - center[0]
    M[1, 2] += (new_h / 2.0) - center[1]
    warped = cv2.warpAffine(gray_u8, M, (new_w, new_h), flags=cv2.INTER_LANCZOS4,
                             borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    H_gt = np.vstack([M, [0.0, 0.0, 1.0]])
    return warped, H_gt


def real_gsd_ch2(image_id: str, ch2_dir: str, preview_shape: tuple) -> dict:
    geometry_csv = os.path.join(ch2_dir, image_id, f"{image_id}_geometry.csv")
    rows = geo_extent_guard.load_tmc_geometry(geometry_csv)
    lons = [r[2] for r in rows]
    lats = [r[3] for r in rows]
    lon_min, lon_max, lat_min, lat_max = min(lons), max(lons), min(lats), max(lats)
    grid = tmc_geometry.load_geometry_grid(geometry_csv)

    moon_radius_km = 1737.4
    mean_lat_rad = math.radians((lat_min + lat_max) / 2)
    lon_span_km = math.radians(lon_max - lon_min) * moon_radius_km * math.cos(mean_lat_rad)
    lat_span_km = math.radians(lat_max - lat_min) * moon_radius_km
    gsd_x_native = (lon_span_km * 1000) / grid["native_width"]
    gsd_y_native = (lat_span_km * 1000) / grid["native_height"]
    gsd_native = (gsd_x_native + gsd_y_native) / 2

    preview_h, preview_w = preview_shape[:2]
    downsample_x = grid["native_width"] / preview_w
    downsample_y = grid["native_height"] / preview_h
    gsd_preview = gsd_native * (downsample_x + downsample_y) / 2
    return {"gsd_m_per_px": gsd_preview, "method": "ch2_geometry_csv_native_rescaled", "gsd_native_m_per_px": gsd_native}


def real_gsd_nac_area_estimate(image_id: str, nac_dir: str, preview_shape: tuple) -> dict:
    overlap_path = os.path.join(nac_dir, image_id, f"{image_id}_overlap_info.json")
    with open(overlap_path) as f:
        info = json.load(f)
    extent_km = info["overlaps_with"][0]["nac_frame_extent_km"]
    area_km2 = extent_km[0] * extent_km[1]
    h, w = preview_shape[:2]
    gsd = math.sqrt((area_km2 * 1e6) / (w * h))
    return {"gsd_m_per_px": gsd, "method": "nac_kml_frame_extent_area_average_APPROXIMATE"}
