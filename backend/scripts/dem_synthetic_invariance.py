"""DEM-Assisted Registration follow-up, Steps 2-4.

Step 2: real Wargentin NAC pair (M1417873284LE base + M1441326480LE, real,
verified-overlapping, different real sun angles/orbits -- see TASKS.md).
Step 3: synthetic DEM-hillshade variants of the BASE frame's own real
pixel grid, at controlled sun-elevation/azimuth deltas from its own real
sun angle (SPICE-derived, same method as dem_sun_geometry.py). Ground
truth transform between any two variants is the identity (same DEM grid,
same reprojection, only shading differs) -- ideal for isolating whether
DEM-derived structure survives illumination change, independent of any
real cross-frame geometry uncertainty.
Step 4: run the existing pipeline (matching.match_auto + geometry + the
rotation-consistency diagnostic) on every base-vs-variant pair, report
inlier count / rotation std / validation as a function of sun-angle delta.
"""
import json
import os

import cv2
import numpy as np
import spiceypy as spice

from backend.data.real._overlap_maps import get_kml_corners
from backend.pipeline.run_pipeline import run_registration

DEM_PATH = "backend/data/lola_dem/ldem_64.img"
DEM_LINES, DEM_SAMPLES = 11520, 23040
DEM_LINE_OFFSET, DEM_SAMPLE_OFFSET = 5759.5, 11519.5
DEM_RES = 64
DEM_SCALING = 0.5
TARGET_HEIGHT = 1000  # smaller than the Tycho 2000 -- speed, since we run ~8 pairs here

KERNELS = [
    "backend/data/spice_kernels/naif0012.tls",
    "backend/data/spice_kernels/pck00011.tpc",
    "backend/data/spice_kernels/moon_pa_de421_1900-2050.bpc",
    "backend/data/spice_kernels/moon_080317.tf",
    "backend/data/spice_kernels/de440s.bsp",
]

BASE_DIR = "backend/data/real/lro_nac/M1417873284LE"
BASE_XML = f"{BASE_DIR}/M1417873284LE.xml"
BASE_LINES, BASE_SAMPLES = 52224, 5064
BASE_UTC_MID = "2022-09-15T09:27:11.890"


def load_kernels():
    for k in KERNELS:
        spice.furnsh(k)


def real_sun_geometry_at(utc_iso, lat_deg, lon_deg):
    et = spice.str2et(utc_iso)
    sub_pt, _, _ = spice.subslr("INTERCEPT/ELLIPSOID", "MOON", et, "MOON_PA", "LT+S", "EARTH")
    _, sub_lon, sub_lat = spice.reclat(sub_pt)
    sub_lat, sub_lon = np.degrees(sub_lat), np.degrees(sub_lon) % 360
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    slat, slon = np.radians(sub_lat), np.radians(sub_lon)
    cos_inc = np.sin(lat)*np.sin(slat) + np.cos(lat)*np.cos(slat)*np.cos(lon-slon)
    incidence = np.degrees(np.arccos(np.clip(cos_inc, -1, 1)))
    dlon = slon - lon
    y = np.sin(dlon)*np.cos(slat)
    x = np.cos(lat)*np.sin(slat) - np.sin(lat)*np.cos(slat)*np.cos(dlon)
    azimuth = np.degrees(np.arctan2(y, x)) % 360
    return incidence, azimuth


def bilinear_lonlat(corners, fl, fs):
    P1, P2, P3, P4 = corners
    lon = (1-fl)*(1-fs)*P1[0] + (1-fl)*fs*P4[0] + fl*(1-fs)*P2[0] + fl*fs*P3[0]
    lat = (1-fl)*(1-fs)*P1[1] + (1-fl)*fs*P4[1] + fl*(1-fs)*P2[1] + fl*fs*P3[1]
    return lon, lat


def fl_for_lat(corners, lat_target):
    lat0, lat1 = corners[0][1], corners[1][1]
    return (lat_target - lat0) / (lat1 - lat0)


def dem_bilinear_sample(dem, lat_arr, lon_arr):
    row = DEM_LINE_OFFSET - lat_arr * DEM_RES
    col = (DEM_SAMPLE_OFFSET + lon_arr * DEM_RES) % DEM_SAMPLES
    row = np.clip(row, 0, DEM_LINES - 1.001)
    r0 = np.floor(row).astype(int)
    c0 = np.floor(col).astype(int)
    r1 = np.clip(r0 + 1, 0, DEM_LINES - 1)
    c1 = (c0 + 1) % DEM_SAMPLES
    fr = row - r0
    fc = col - c0
    v00 = dem[r0, c0]; v01 = dem[r0, c1]; v10 = dem[r1, c0]; v11 = dem[r1, c1]
    return (v00*(1-fr)*(1-fc) + v01*(1-fr)*fc + v10*fr*(1-fc) + v11*fr*fc)


def render_hillshade(elev, m_per_px, incidence_deg, azimuth_deg):
    gy, gx = np.gradient(elev, m_per_px)
    sun_el = np.radians(90 - incidence_deg)
    sun_az = np.radians(azimuth_deg)
    sun_dir = np.array([np.sin(sun_az)*np.cos(sun_el), np.cos(sun_az)*np.cos(sun_el), np.sin(sun_el)])
    normal = np.dstack([-gx, -gy, np.ones_like(elev)])
    normal /= np.linalg.norm(normal, axis=2, keepdims=True)
    shade = np.clip(normal @ sun_dir, 0, None)
    return (shade * 255).astype(np.uint8)


def run_pair(name_a, img_a, name_b, img_b, out_root):
    pair_dir = os.path.join(out_root, f"{name_a}_vs_{name_b}")
    os.makedirs(pair_dir, exist_ok=True)
    try:
        result = run_registration(img_a, img_b, pair_dir, matcher="auto", illum_mode="none", sensor_type="ohrc")
    except Exception as exc:  # noqa: BLE001 -- real failure reported, not swallowed
        return {"pair": f"{name_a}_vs_{name_b}", "error": str(exc), "matcher": None,
                "total_matches": 0, "inliers": 0, "validated": False, "rotation_std": None}
    rc = result.get("rotation_consistency") or {}
    validation = result.get("validation") or {}
    return {
        "pair": f"{name_a}_vs_{name_b}", "matcher": result.get("matcher_used"),
        "total_matches": result.get("total_matches"), "inliers": result.get("inlier_count"),
        "rotation_std": rc.get("std_deg"),
        "validated": bool(validation.get("validated")) if isinstance(validation, dict) else False,
    }


def main():
    load_kernels()
    dem = np.fromfile(DEM_PATH, dtype="<i2").reshape(DEM_LINES, DEM_SAMPLES).astype(np.float32) * DEM_SCALING

    corners = get_kml_corners(open(f"{BASE_DIR}/M1417873284LE_xml.kml").read())
    center_lat = float(np.mean([c[1] for c in corners]))
    center_lon = float(np.mean([c[0] for c in corners]))
    real_inc, real_az = real_sun_geometry_at(BASE_UTC_MID, center_lat, center_lon)
    print(f"Base frame M1417873284LE real sun: incidence={real_inc:.2f} deg, azimuth={real_az:.2f} deg")

    # Full-frame fl range (this frame's whole real extent is inside the
    # real cross-frame overlap band -- see TASKS.md derivation).
    fl_lo, fl_hi = 0.0, 1.0
    line_lo, line_hi = int(fl_lo * BASE_LINES), int(fl_hi * BASE_LINES)
    n_crop_lines = line_hi - line_lo
    downsample = max(n_crop_lines / TARGET_HEIGHT, 1.0)
    out_h = int(round(n_crop_lines / downsample))
    out_w = int(round(BASE_SAMPLES / downsample))
    print(f"Output grid: {out_w}x{out_h}, downsample={downsample:.2f}x")

    row_out = np.arange(out_h)
    col_out = np.arange(out_w)
    ROW, COL = np.meshgrid(row_out, col_out, indexing="ij")
    native_line = line_lo + ROW * downsample
    native_sample = COL * downsample
    FL = native_line / BASE_LINES
    FS = native_sample / BASE_SAMPLES
    lon, lat = bilinear_lonlat(corners, FL, FS)
    elev = dem_bilinear_sample(dem, lat, lon)

    from backend.pipeline.geo_extent_guard import nac_ground_extent_km
    along_km, _ = nac_ground_extent_km(corners, BASE_LINES, BASE_SAMPLES)
    m_per_px = along_km * 1000 / BASE_LINES * downsample
    print(f"Real ground spacing in this output grid: {m_per_px:.1f} m/px")

    out_dir = "backend/outputs/dem_invariance"
    os.makedirs(out_dir, exist_ok=True)

    base_shade = render_hillshade(elev, m_per_px, real_inc, real_az)
    base_path = f"{out_dir}/base_real_sun.png"
    cv2.imwrite(base_path, base_shade)

    results = []
    variants = (
        [("elev_delta", d, real_inc + d, real_az) for d in [-10, -20, -30, -45]] +
        [("az_delta", d, real_inc, (real_az + d) % 360) for d in [45, 90, 135]]
    )
    for kind, delta, inc, az in variants:
        shade = render_hillshade(elev, m_per_px, inc, az)
        name = f"{kind}_{delta:+d}"
        path = f"{out_dir}/variant_{name}.png"
        cv2.imwrite(path, shade)
        r = run_pair("base", base_path, name, path, out_dir)
        r["kind"] = kind
        r["delta"] = delta
        r["incidence"] = inc
        r["azimuth"] = az
        results.append(r)
        print(f"  {name}: matcher={r['matcher']} matches={r['total_matches']} inliers={r['inliers']} "
              f"rot_std={r['rotation_std']} validated={r['validated']}")

    with open(f"{out_dir}/results.json", "w") as f:
        json.dump({"base_incidence": real_inc, "base_azimuth": real_az, "results": results}, f, indent=2)
    print(f"\nSaved results to {out_dir}/results.json")


if __name__ == "__main__":
    main()
