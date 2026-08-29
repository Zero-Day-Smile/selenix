"""DEM-Assisted Registration, Step 2 -- generate real per-NAC-frame
hillshade images from the real LOLA ldem_64.img, using each frame's real
sun incidence/azimuth (backend/scripts/dem_sun_geometry.py, SPICE-derived,
cross-checked against ODE's real Incidence_angle to within 0.02 deg).

Both the hillshade and a matching real-NAC-pixel crop are generated in the
SAME pixel grid (same crop-line range, same downsample factor) so Steps
3-5 can feed them directly into the existing matching pipeline with no
extra reprojection step -- alignment is guaranteed by construction, not
assumed.

Real per-pixel geo-referencing comes from the same bilinear corner-fit
convention already used and validated in geo_extent_guard.py (4 real KML
corners, fl=line fraction, fs=sample fraction) -- reused verbatim rather
than re-derived, since it's already the established, working convention
for real NAC frames with no per-pixel geometry beyond 4 corners.
"""
import numpy as np
import cv2

from backend.pipeline.pds_readers import read_pds4
import spiceypy as spice

DEM_PATH = "backend/data/lola_dem/ldem_64.img"
DEM_LINES, DEM_SAMPLES = 11520, 23040
DEM_LINE_OFFSET, DEM_SAMPLE_OFFSET = 5759.5, 11519.5
DEM_RES = 64  # px/deg
DEM_SCALING = 0.5
MOON_R_M = 1737400.0

TARGET_HEIGHT = 2000  # matches the established preview convention this session

FRAMES = {
    "M1412862267LE": {
        "xml": "backend/data/real/lro_nac/M1412862267LE/M1412862267LE.xml",
        "lines": 14336, "samples": 5064,
        # KML order: (l=0,s=0), (l=max,s=0), (l=max,s=max), (l=0,s=max)
        "corners": [(349.89, -42.26), (349.95, -41.88), (349.78, -41.87), (349.72, -42.25)],
        "utc_mid": "2022-07-19T09:30:04.021",
    },
    "M1315458185LE": {
        "xml": "backend/data/real/lro_nac/M1315458185LE/M1315458185LE.xml",
        "lines": 52224, "samples": 5064,
        "corners": [(349.73, -41.71), (349.82, -42.68), (349.95, -42.67), (349.85, -41.7)],
        "utc_mid": "2019-06-18T00:48:47.203",
    },
}

# Real overlap latitude band between the two frames (established this
# session from their real KML footprints).
OVERLAP_LAT_MIN, OVERLAP_LAT_MAX = -42.26, -41.87

KERNELS = [
    "backend/data/spice_kernels/naif0012.tls",
    "backend/data/spice_kernels/pck00011.tpc",
    "backend/data/spice_kernels/moon_pa_de421_1900-2050.bpc",
    "backend/data/spice_kernels/moon_080317.tf",
    "backend/data/spice_kernels/de440s.bsp",
]


def bilinear_lonlat(corners, fl, fs):
    P1, P2, P3, P4 = corners
    lon = (1-fl)*(1-fs)*P1[0] + (1-fl)*fs*P4[0] + fl*(1-fs)*P2[0] + fl*fs*P3[0]
    lat = (1-fl)*(1-fs)*P1[1] + (1-fl)*fs*P4[1] + fl*(1-fs)*P2[1] + fl*fs*P3[1]
    return lon, lat


def fl_for_lat(corners, lat_target):
    """Invert corner P1(l=0)/P2(l=max) lat to find fl, approximating the
    along-track lat relationship as linear -- reasonable for these narrow,
    near-nadir strips (matches this session's established method, verified
    against the previously-derived M1315458185LE overlap range 0.165-0.567)."""
    lat0, lat1 = corners[0][1], corners[1][1]
    return (lat_target - lat0) / (lat1 - lat0)


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


def dem_bilinear_sample(dem, lat_arr, lon_arr):
    """Real bilinear interpolation of the DEM at arbitrary (lat, lon)
    arrays, in the DEM's own real simple-cylindrical pixel convention."""
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


def main():
    for k in KERNELS:
        spice.furnsh(k)

    dem = np.fromfile(DEM_PATH, dtype="<i2").reshape(DEM_LINES, DEM_SAMPLES).astype(np.float32) * DEM_SCALING

    for name, f in FRAMES.items():
        lines, samples = f["lines"], f["samples"]
        corners = f["corners"]

        fl0 = np.clip(fl_for_lat(corners, OVERLAP_LAT_MIN), 0, 1)
        fl1 = np.clip(fl_for_lat(corners, OVERLAP_LAT_MAX), 0, 1)
        fl_lo, fl_hi = min(fl0, fl1), max(fl0, fl1)
        line_lo, line_hi = int(fl_lo * lines), int(fl_hi * lines)
        n_crop_lines = max(line_hi - line_lo, 1)
        downsample = max(n_crop_lines / TARGET_HEIGHT, 1.0)
        out_h = int(round(n_crop_lines / downsample))
        out_w = int(round(samples / downsample))
        print(f"{name}: crop lines [{line_lo}:{line_hi}] of {lines}, downsample={downsample:.3f}x, out={out_w}x{out_h}")

        row_out = np.arange(out_h)
        col_out = np.arange(out_w)
        ROW, COL = np.meshgrid(row_out, col_out, indexing="ij")
        native_line = line_lo + ROW * downsample
        native_sample = COL * downsample
        FL = native_line / lines
        FS = native_sample / samples
        lon, lat = bilinear_lonlat(corners, FL, FS)

        elev = dem_bilinear_sample(dem, lat, lon)

        # Real per-pixel ground spacing in this output grid, from the
        # frame's own real corner-derived ground extent (not the DEM's
        # native 473.8 m/px -- that would be wrong once resampled into a
        # different pixel grid).
        from backend.pipeline.geo_extent_guard import nac_ground_extent_km
        along_km, _cross_km = nac_ground_extent_km(corners, lines, samples)
        km_per_line = along_km / lines
        m_per_out_px = km_per_line * downsample * 1000
        print(f"  real ground spacing in this output grid: {m_per_out_px:.1f} m/px")

        gy, gx = np.gradient(elev, m_per_out_px)
        inc, az = real_sun_geometry_at(f["utc_mid"], float(np.mean(lat)), float(np.mean(lon)))
        print(f"  real sun: incidence={inc:.2f} deg, azimuth={az:.2f} deg")
        sun_el = np.radians(90 - inc)
        sun_az = np.radians(az)
        sun_dir = np.array([np.sin(sun_az)*np.cos(sun_el), np.cos(sun_az)*np.cos(sun_el), np.sin(sun_el)])
        normal = np.dstack([-gx, -gy, np.ones_like(elev)])
        normal /= np.linalg.norm(normal, axis=2, keepdims=True)
        shade = np.clip(normal @ sun_dir, 0, None)
        shade_u8 = (shade * 255).astype(np.uint8)
        cv2.imwrite(f"backend/outputs/dem_hillshade_{name}.png", shade_u8)

        # Matching real NAC crop, same exact pixel grid.
        result = read_pds4(f["xml"])
        arr = result.data
        crop = arr[line_lo:line_hi, :]
        crop_u8 = crop.astype(np.float32)
        p1, p99 = np.percentile(crop_u8, [1, 99])
        crop_u8 = np.clip((crop_u8 - p1) / max(p99 - p1, 1e-6) * 255, 0, 255).astype(np.uint8)
        crop_resized = cv2.resize(crop_u8, (out_w, out_h), interpolation=cv2.INTER_AREA)
        cv2.imwrite(f"backend/outputs/dem_realcrop_{name}.png", crop_resized)

        print(f"  saved dem_hillshade_{name}.png and dem_realcrop_{name}.png")


if __name__ == "__main__":
    main()
