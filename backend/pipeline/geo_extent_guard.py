"""Precondition guard: computes the TRUE geometric overlap between a real
Chandrayaan-2 TMC-2 image (which has real per-pixel lat/lon geometry) and a
real LRO NAC image (which only has a 4-corner footprint, from KML) — and
flags/clips crops that would otherwise include TMC-2 content with no
possible NAC correspondence.

Found as a real bug during diagnostic work: selecting a TMC-2 crop from the
axis-aligned lon/lat bounding box of "candidate points near the NAC
footprint" is not the same as verifying each point is actually inside NAC's
true (rotated) quadrilateral. A point can sit inside the bounding box while
being outside the real quadrilateral (the "corner-cut" gap), and blindly
taking the full bounding box's TMC scan/pixel extent as the crop can select
TMC content wider than NAC's actual native swath — content with no possible
NAC correspondence at all, regardless of resolution or matching method.

This module's `verified_overlap_extent()` is the fix: it checks every real
geometry-CSV candidate point's bilinear fit residual against the NAC
quadrilateral, keeps only the genuinely-inside ones, and derives the TMC
crop bounds from *those* — plus reports both frames' real ground extents
so a mismatch is visible and auditable, not silently wrong.
"""
from __future__ import annotations

import csv
from dataclasses import dataclass, field

import numpy as np

MOON_KM_PER_DEG = 2 * np.pi * 1737.4 / 360
RESIDUAL_OK_THRESHOLD = 1e-4


def load_tmc_geometry(csv_path: str) -> list:
    rows = []
    with open(csv_path) as f:
        for row in csv.DictReader(f):
            rows.append((int(row["Scan"]), int(row["Pixel"]), float(row["Longitude"]), float(row["Latitude"])))
    return rows


def nac_corner_bilinear_fit(corners, lines, samples, lon, lat, n_iter=30):
    """Returns (line, sample, residual). corners = [(lon,lat) x4] in KML
    order: (l=0,s=0), (l=max,s=0), (l=max,s=max), (l=0,s=max). High residual
    means (lon,lat) is outside the true quadrilateral even if it's inside
    the corners' axis-aligned bounding box."""
    P1, P2, P3, P4 = corners
    lo_fl, hi_fl, lo_fs, hi_fs = 0.0, 1.0, 0.0, 1.0
    best_fl = best_fs = 0.0
    d_best = np.inf
    for _ in range(n_iter):
        fl = np.linspace(lo_fl, hi_fl, 20)
        fs = np.linspace(lo_fs, hi_fs, 20)
        FL, FS = np.meshgrid(fl, fs, indexing="ij")
        LON = (1-FL)*(1-FS)*P1[0] + (1-FL)*FS*P4[0] + FL*(1-FS)*P2[0] + FL*FS*P3[0]
        LAT = (1-FL)*(1-FS)*P1[1] + (1-FL)*FS*P4[1] + FL*(1-FS)*P2[1] + FL*FS*P3[1]
        d = (LON-lon)**2 + (LAT-lat)**2
        idx = np.unravel_index(np.argmin(d), d.shape)
        best_fl, best_fs = float(FL[idx]), float(FS[idx])
        d_best = float(d[idx])
        span_l, span_s = (hi_fl-lo_fl)/10, (hi_fs-lo_fs)/10
        lo_fl, hi_fl = max(0, best_fl-span_l), min(1, best_fl+span_l)
        lo_fs, hi_fs = max(0, best_fs-span_s), min(1, best_fs+span_s)
    return best_fl*lines, best_fs*samples, d_best


def nac_ground_extent_km(corners, lines, samples):
    """Real ground extent of the NAC frame: (along_track_km, cross_track_km),
    derived from its own real corner geometry, not assumed."""
    P1, P2, P3, P4 = corners
    along_km = np.hypot(P2[0]-P1[0], P2[1]-P1[1]) * MOON_KM_PER_DEG
    cross_km = np.hypot(P4[0]-P1[0], P4[1]-P1[1]) * MOON_KM_PER_DEG
    return along_km, cross_km


@dataclass
class VerifiedOverlap:
    ok: bool
    reason: str = ""
    tmc_bounds: tuple | None = None       # (s0, s1, p0, p1)
    n_verified_points: int = 0
    n_rejected_points: int = 0
    tmc_crop_extent_km: tuple | None = None   # (along, cross)
    nac_frame_extent_km: tuple | None = None  # (along, cross)
    extent_mismatch: bool = False
    extent_mismatch_detail: str = ""


def verified_overlap_extent(tmc_geom_csv: str, nac_corners: list, nac_lines: int, nac_samples: int,
                             lon_box: tuple, lat_box: tuple, tmc_gsd_m: float,
                             min_verified_points: int = 10) -> VerifiedOverlap:
    """The guard function. Run this BEFORE cropping any TMC/NAC pair."""
    geom_rows = load_tmc_geometry(tmc_geom_csv)
    bbox_candidates = [r for r in geom_rows if lon_box[0] <= r[2] <= lon_box[1] and lat_box[0] <= r[3] <= lat_box[1]]
    if not bbox_candidates:
        return VerifiedOverlap(ok=False, reason="no geometry points in the given lon/lat box at all")

    verified, rejected = [], 0
    for r in bbox_candidates:
        _, _, resid = nac_corner_bilinear_fit(nac_corners, nac_lines, nac_samples, r[2], r[3])
        if resid < RESIDUAL_OK_THRESHOLD:
            verified.append(r)
        else:
            rejected += 1

    if len(verified) < min_verified_points:
        return VerifiedOverlap(ok=False, reason=f"only {len(verified)} verified points (need {min_verified_points}) "
                                                 f"-- most of this lon/lat box is outside NAC's true footprint",
                                n_verified_points=len(verified), n_rejected_points=rejected)

    scans = [r[0] for r in verified]; pixels = [r[1] for r in verified]
    s0, s1, p0, p1 = min(scans), max(scans), min(pixels), max(pixels)

    tmc_along_km = (s1 - s0) * tmc_gsd_m / 1000
    tmc_cross_km = (p1 - p0) * tmc_gsd_m / 1000
    nac_along_km, nac_cross_km = nac_ground_extent_km(nac_corners, nac_lines, nac_samples)

    mismatch = False
    detail = ""
    # a >15% overshoot in either axis relative to the NAC frame's own native
    # extent means real, non-trivial "TMC content NAC cannot possibly show"
    if tmc_cross_km > nac_cross_km * 1.15:
        mismatch = True
        detail += f"cross-track: TMC crop {tmc_cross_km:.2f}km > NAC native swath {nac_cross_km:.2f}km. "
    if tmc_along_km > nac_along_km * 1.15:
        mismatch = True
        detail += f"along-track: TMC crop {tmc_along_km:.2f}km > NAC native swath {nac_along_km:.2f}km. "

    return VerifiedOverlap(
        ok=True, tmc_bounds=(s0, s1, p0, p1),
        n_verified_points=len(verified), n_rejected_points=rejected,
        tmc_crop_extent_km=(tmc_along_km, tmc_cross_km),
        nac_frame_extent_km=(nac_along_km, nac_cross_km),
        extent_mismatch=mismatch, extent_mismatch_detail=detail.strip(),
    )
