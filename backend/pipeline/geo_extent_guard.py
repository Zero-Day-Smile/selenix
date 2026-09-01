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

`check_footprint_overlap()` is a second, more basic guard, added after a
real mistake found during development: pairs were being handed to the
matcher without ever checking whether they shared any ground at all. One
pair used as a "cross-sensor test case" for most of a working session
turned out to be ~97 degrees / ~2,947km apart on the Moon — nowhere near
overlapping — because nothing checked real footprint geometry before the
pair was selected. Unlike `verified_overlap_extent()` (which needs a full
TMC-2 per-pixel geometry.csv plus an NAC frame's line/sample counts, and
answers "how much of this crop is usable"), this one only needs the two
images' generic 4-corner footprints — the same [[lat, lon], ...] x4 shape
`orbital_geometry.py` already computes for the map panel — and answers a
cheaper, earlier question: "do these two frames touch at all?" It's meant
to run before *every* pair reaches the matcher, not just TMC/NAC pairs
with full geometry.csv data. A close centroid distance is deliberately not
used as the test: two footprints ~30km apart by centroid can still be
non-touching adjacent strips, so this does real polygon intersection
instead.
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


# ---------------------------------------------------------------------------
# check_footprint_overlap() and its plane-geometry helpers.
#
# Footprints here are small (at most a few degrees across) real satellite
# ground tracks, so an equirectangular local-tangent-plane projection
# (longitude scaled by cos(reference latitude)) is accurate enough to decide
# "do these touch" and to report a real separation distance in km — no need
# for a full spherical-polygon library or a new dependency (shapely isn't
# installed in this project; this problem doesn't need it).
# ---------------------------------------------------------------------------

def _unwrap_lon(lon_deg: float, ref_lon_deg: float) -> float:
    """Shifts lon_deg by a multiple of 360 so it lands within 180 degrees of
    ref_lon_deg -- otherwise two real footprints that are actually adjacent
    across the 0/360 seam would look ~360 degrees apart instead of ~0."""
    return ref_lon_deg + ((lon_deg - ref_lon_deg + 180) % 360 - 180)


def _footprint_to_local_km(footprint: list, ref_lat: float, ref_lon: float) -> list:
    """[[lat, lon], ...] -> [(x_km, y_km), ...] on a local tangent plane
    centered at (ref_lat, ref_lon)."""
    cos_ref = np.cos(np.radians(ref_lat))
    pts = []
    for lat, lon in footprint:
        lon_u = _unwrap_lon(lon, ref_lon)
        x_km = (lon_u - ref_lon) * MOON_KM_PER_DEG * cos_ref
        y_km = (lat - ref_lat) * MOON_KM_PER_DEG
        pts.append((x_km, y_km))
    return pts


def _cross(o, a, b) -> float:
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def _on_segment(p, a, b) -> bool:
    return (min(a[0], b[0]) - 1e-9 <= p[0] <= max(a[0], b[0]) + 1e-9 and
            min(a[1], b[1]) - 1e-9 <= p[1] <= max(a[1], b[1]) + 1e-9)


def _segments_intersect(a1, a2, b1, b2) -> bool:
    """Standard orientation-based segment intersection test, including the
    collinear/touching edge cases (real footprint corners can legitimately
    share an edge)."""
    d1, d2 = _cross(b1, b2, a1), _cross(b1, b2, a2)
    d3, d4 = _cross(a1, a2, b1), _cross(a1, a2, b2)
    if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
       ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
        return True
    if abs(d1) < 1e-9 and _on_segment(a1, b1, b2):
        return True
    if abs(d2) < 1e-9 and _on_segment(a2, b1, b2):
        return True
    if abs(d3) < 1e-9 and _on_segment(b1, a1, a2):
        return True
    if abs(d4) < 1e-9 and _on_segment(b2, a1, a2):
        return True
    return False


def _point_in_polygon(p, poly: list) -> bool:
    """Ray-casting test. Works for convex or concave simple polygons, which
    covers real (possibly slightly rotated/skewed) pushbroom footprints."""
    n = len(poly)
    inside = False
    x, y = p
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if ((y1 > y) != (y2 > y)) and (x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-15) + x1):
            inside = not inside
    return inside


def _polygons_intersect(poly_a: list, poly_b: list) -> bool:
    """True if the two simple polygons overlap at all -- edges crossing, or
    one fully containing the other (edges alone miss full containment)."""
    for i in range(len(poly_a)):
        a1, a2 = poly_a[i], poly_a[(i + 1) % len(poly_a)]
        for j in range(len(poly_b)):
            b1, b2 = poly_b[j], poly_b[(j + 1) % len(poly_b)]
            if _segments_intersect(a1, a2, b1, b2):
                return True
    if _point_in_polygon(poly_a[0], poly_b) or _point_in_polygon(poly_b[0], poly_a):
        return True
    return False


def _point_to_segment_distance(p, a, b) -> float:
    px, py = p; ax, ay = a; bx, by = b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return float(np.hypot(px - ax, py - ay))
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return float(np.hypot(px - (ax + t * dx), py - (ay + t * dy)))


def _min_distance_between_polygons(poly_a: list, poly_b: list) -> float:
    """Minimum distance (km, on the local tangent plane) between any edge of
    A and any edge of B -- only meaningful/called when they don't intersect."""
    best = float("inf")
    for i in range(len(poly_a)):
        a1, a2 = poly_a[i], poly_a[(i + 1) % len(poly_a)]
        for j in range(len(poly_b)):
            b1, b2 = poly_b[j], poly_b[(j + 1) % len(poly_b)]
            best = min(best,
                       _point_to_segment_distance(a1, b1, b2), _point_to_segment_distance(a2, b1, b2),
                       _point_to_segment_distance(b1, a1, a2), _point_to_segment_distance(b2, a1, a2))
    return best


def check_footprint_overlap(footprint_a: list, footprint_b: list) -> dict:
    """Real polygon-intersection overlap test between two footprints, each
    [[lat, lon], ...] with at least 3 corners (the same shape
    orbital_geometry.py's `_ch2_footprint_corners`/`_nac_footprint_corners`
    already produce). Deliberately NOT a centroid-distance threshold -- see
    this module's docstring for why that isn't sufficient on its own.

    Returns {"overlaps": bool, "separation_km": float, "reason": str}.
    separation_km is 0.0 when they overlap, otherwise the real minimum
    edge-to-edge distance (not centroid-to-centroid, which would overstate
    how far apart two large, oddly-shaped footprints really are)."""
    if not footprint_a or not footprint_b or len(footprint_a) < 3 or len(footprint_b) < 3:
        return {"overlaps": False, "separation_km": None,
                "reason": "one or both footprints have fewer than 3 corners -- cannot test overlap"}

    ref_lat = (float(np.mean([p[0] for p in footprint_a])) + float(np.mean([p[0] for p in footprint_b]))) / 2
    ref_lon = float(np.mean([p[1] for p in footprint_a]))

    poly_a = _footprint_to_local_km(footprint_a, ref_lat, ref_lon)
    poly_b = _footprint_to_local_km(footprint_b, ref_lat, ref_lon)

    if _polygons_intersect(poly_a, poly_b):
        return {"overlaps": True, "separation_km": 0.0, "reason": "footprints intersect"}

    sep_km = _min_distance_between_polygons(poly_a, poly_b)
    return {"overlaps": False, "separation_km": sep_km,
            "reason": f"no geographic overlap: footprints are ~{sep_km:.1f} km apart"}
