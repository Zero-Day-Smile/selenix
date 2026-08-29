"""DEM-Assisted Registration, Step 1 sanity check -- crop the real LOLA
ldem_64.img around Tycho crater and produce a visualization confirming
the crater bowl is actually visible at 64 px/deg (473.8 m/px) resolution,
BEFORE any hillshade/matching work (per the task's mandatory checkpoint).
"""
import numpy as np
import cv2

DEM_PATH = "backend/data/lola_dem/ldem_64.img"
LINES, SAMPLES = 11520, 23040
LINE_OFFSET = 5759.5
SAMPLE_OFFSET = 11519.5
RES = 64  # px/deg
SCALING_FACTOR = 0.5  # DN -> meters

# Real Tycho crater center (IAU Gazetteer): -43.31 N, 348.68 E (=-11.32 W), diameter ~85 km
TYCHO_LAT = -43.31
TYCHO_LON = 348.68


def lonlat_to_rc(lat: float, lon: float) -> tuple[float, float]:
    row = LINE_OFFSET - lat * RES
    col = (SAMPLE_OFFSET + lon * RES) % SAMPLES
    return row, col


def main():
    dem = np.fromfile(DEM_PATH, dtype="<i2").reshape(LINES, SAMPLES).astype(np.float32) * SCALING_FACTOR

    row, col = lonlat_to_rc(TYCHO_LAT, TYCHO_LON)
    print(f"Tycho center -> row={row:.1f}, col={col:.1f} (of {LINES}x{SAMPLES})")

    half_deg = 3.0  # +/- 3 degrees ~ generous margin around an 85km (~2.8deg) crater
    half_px = int(half_deg * RES)
    r0, r1 = int(row - half_px), int(row + half_px)
    c0, c1 = int(col - half_px), int(col + half_px)
    crop = dem[r0:r1, c0:c1]
    print(f"crop shape: {crop.shape}, elevation range: {crop.min():.1f}m to {crop.max():.1f}m")

    # Real min-max stretch for visualization (not the pipeline's adaptive
    # stretch -- this is a raw sanity check, want to see the true relief).
    norm = (crop - crop.min()) / (crop.max() - crop.min() + 1e-9)
    vis = (norm * 255).astype(np.uint8)
    cv2.imwrite("backend/outputs/_dem_tycho_elevation.png", vis)

    # Also a real hillshade at a simple fixed sun angle (45 deg elevation,
    # from the east) just for this sanity check -- Step 2 will use each
    # NAC frame's own real sun angle from its label.
    gy, gx = np.gradient(crop, 473.802)  # real per-pixel spacing in meters
    sun_az, sun_el = np.radians(90.0), np.radians(45.0)
    sun_dir = np.array([
        np.cos(sun_el) * np.sin(sun_az),
        -np.cos(sun_el) * np.cos(sun_az),
        np.sin(sun_el),
    ])
    normal = np.dstack([-gx, -gy, np.ones_like(crop)])
    normal /= np.linalg.norm(normal, axis=2, keepdims=True)
    shade = np.clip(normal @ sun_dir, 0, None)
    shade_u8 = (shade * 255).astype(np.uint8)
    cv2.imwrite("backend/outputs/_dem_tycho_hillshade_sanity.png", shade_u8)

    print("Saved backend/outputs/_dem_tycho_elevation.png and _dem_tycho_hillshade_sanity.png")
    print(f"Real GSD at this resolution: 473.802 m/px -- crop is {crop.shape[1]*473.802/1000:.1f} x {crop.shape[0]*473.802/1000:.1f} km")


if __name__ == "__main__":
    main()
