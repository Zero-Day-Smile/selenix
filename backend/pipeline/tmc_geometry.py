"""Inverse mapping for real Chandrayaan-2 TMC-2 per-pixel geometry: given a
real lon/lat, find the corresponding pixel position in the DISPLAYED preview
image.

geometry.csv (loaded via geo_extent_guard.load_tmc_geometry, reused here --
not reimplemented) is a sparse regular grid of (scan, pixel, lon, lat)
samples in the NATIVE full-resolution image space (confirmed: pixel samples
every 100 columns up to 3999, i.e. native width 4000; scan samples spaced
~99 apart up to 16201, i.e. native height ~16202). The preview.png actually
served to the frontend is a uniformly downsampled version of that same
native frame (confirmed empirically: 493x2000 for a 4000x16202 native frame,
same aspect ratio, consistent ~8.11x downsample on both axes) -- not a crop,
not independently georeferenced. So placing a real lon/lat correctly on
preview.png requires (1) inverting the sparse geometry grid to get the
native (scan, pixel), then (2) scaling by the same ratio relating the native
frame to preview.png's actual pixel dimensions.
"""
from __future__ import annotations

import numpy as np

from . import geo_extent_guard


def load_geometry_grid(csv_path: str):
    """Reshapes the sparse geometry CSV into a proper 2D (n_scans, n_pixels)
    grid, sorted by scan then pixel, for cheap nearest+bilinear lookups."""
    rows = geo_extent_guard.load_tmc_geometry(csv_path)  # reuse existing loader
    scans = sorted(set(r[0] for r in rows))
    pixels = sorted(set(r[1] for r in rows))
    scan_idx = {s: i for i, s in enumerate(scans)}
    pixel_idx = {p: i for i, p in enumerate(pixels)}
    lon_grid = np.full((len(scans), len(pixels)), np.nan)
    lat_grid = np.full((len(scans), len(pixels)), np.nan)
    for scan, pixel, lon, lat in rows:
        lon_grid[scan_idx[scan], pixel_idx[pixel]] = lon
        lat_grid[scan_idx[scan], pixel_idx[pixel]] = lat
    return {
        "scans": np.array(scans), "pixels": np.array(pixels),
        "lon_grid": lon_grid, "lat_grid": lat_grid,
        "native_width": int(pixels[-1]) + 1, "native_height": int(scans[-1]) + 1,
    }


def native_pixel_for_lonlat(grid: dict, lon: float, lat: float):
    """Nearest grid sample + bilinear refinement within its cell, returning
    (native_x, native_y, residual_deg2). residual is the squared lon/lat
    distance of the interpolated position from the true (lon,lat) -- high
    residual means this point is genuinely outside the frame's real coverage
    (e.g. past the along-track ends), same signal geo_extent_guard uses for
    its NAC bilinear fit, just applied over a full grid instead of 4 corners."""
    lon_grid, lat_grid = grid["lon_grid"], grid["lat_grid"]
    d2 = (lon_grid - lon) ** 2 + (lat_grid - lat) ** 2
    si, pi = np.unravel_index(np.nanargmin(d2), d2.shape)
    n_scans, n_pixels = lon_grid.shape

    # Local bilinear refinement using the nearest cell that has the point
    # bracketed on both axes, falling back to the nearest sample if the
    # query is right at the grid's edge.
    si0 = min(max(si - 1, 0), n_scans - 2) if n_scans > 1 else 0
    pi0 = min(max(pi - 1, 0), n_pixels - 2) if n_pixels > 1 else 0
    best = None
    for ds in range(2):
        for dp in range(2):
            s0, p0 = si0 + ds, pi0 + dp
            if s0 + 1 >= n_scans or p0 + 1 >= n_pixels:
                continue
            corners_lon = [lon_grid[s0, p0], lon_grid[s0, p0 + 1], lon_grid[s0 + 1, p0 + 1], lon_grid[s0 + 1, p0]]
            corners_lat = [lat_grid[s0, p0], lat_grid[s0, p0 + 1], lat_grid[s0 + 1, p0 + 1], lat_grid[s0 + 1, p0]]
            if any(np.isnan(corners_lon)) or any(np.isnan(corners_lat)):
                continue
            P1, P2, P3, P4 = zip(corners_lon, corners_lat)
            # reuse the same bilinear-fit routine geo_extent_guard already
            # uses for NAC's 4-corner quad -- here applied to one grid cell
            # P1=(s0,p0), P2=(s0,p0+1), P3=(s0+1,p0+1), P4=(s0+1,p0) -- so in
            # nac_corner_bilinear_fit's own convention, FL interpolates along
            # P1->P2 (the pixel axis) and FS interpolates along P1->P4 (the
            # scan axis). Confirmed against its formula, not assumed.
            fl, fs, resid = geo_extent_guard.nac_corner_bilinear_fit(
                [P1, P2, P3, P4], 1.0, 1.0, lon, lat, n_iter=25)
            if best is None or resid < best[2]:
                pixel_val = grid["pixels"][p0] + fl * (grid["pixels"][p0 + 1] - grid["pixels"][p0])
                scan_val = grid["scans"][s0] + fs * (grid["scans"][s0 + 1] - grid["scans"][s0])
                best = (pixel_val, scan_val, resid)
    if best is None:
        # No valid bracketing cell (query outside the grid's true coverage) --
        # fall back to the single nearest sample, but the caller should treat
        # a large residual as "not really on this frame."
        return float(grid["pixels"][pi]), float(grid["scans"][si]), float(d2[si, pi])
    return best


def lonlat_to_preview_pixel(csv_path: str, preview_width: int, preview_height: int, lon: float, lat: float):
    """Real lon/lat -> pixel position in the actual displayed preview image.
    Returns (x, y, residual_deg2); a large residual means the point is
    outside this frame's real geometric coverage (caller should discard it,
    not just clip it into range)."""
    grid = load_geometry_grid(csv_path)
    native_x, native_y, resid = native_pixel_for_lonlat(grid, lon, lat)
    scale_x = preview_width / grid["native_width"]
    scale_y = preview_height / grid["native_height"]
    return native_x * scale_x, native_y * scale_y, resid
