"""Builds real YOLO-format crater detection training data from the Robbins
(2019) Lunar Crater Database, cross-referenced against this project's real
images via each image's own real geometry -- CH2 TMC-2 frames use their
real per-pixel geometry.csv (tmc_geometry.native_pixel_for_lonlat); LRO NAC
frames use their real 4-corner KML footprint (geo_extent_guard.
nac_corner_bilinear_fit). No synthetic images, no fabricated labels --
every bounding box here is a real catalog crater's real measured diameter,
converted to pixels via that specific image's own real GSD.

Real, honest constraint (per the task spec): Robbins is complete only to
~1-2km diameter. Most craters visible in a close NAC/TMC-2 crop are much
smaller (50-200m) and have no catalog entry -- this script only emits boxes
for craters the catalog actually covers, which will be a small fraction of
what's visually present. Reported honestly, not padded.
"""
from __future__ import annotations

import json
import math
import os

import cv2
import numpy as np

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from backend.pipeline import crater_catalog, tmc_geometry, geo_extent_guard, ingestion
from datasets.pds3_reader import read_pds3_full

OUT_DIR = "datasets/crater_yolo"
CH2_DIR = "backend/data/real/chandrayaan2"
NAC_DIR = "backend/data/real/lro_nac"

CH2_IMAGE_IDS = ["tmc2_20260803_0049", "tmc2_20260809_1606", "tmc2_20260811_1856", "tmc2_20260812_0506"]
# Only real NAC frames with a real, locally-downloaded KML footprint (see
# build script's own check below -- never guessed for frames without one).


def _ch2_labels(image_id: str) -> tuple:
    preview_path = os.path.join(CH2_DIR, image_id, f"{image_id}_preview.png")
    geometry_csv = os.path.join(CH2_DIR, image_id, f"{image_id}_geometry.csv")
    if not (os.path.exists(preview_path) and os.path.exists(geometry_csv)):
        return None, []

    img = cv2.imread(preview_path, cv2.IMREAD_GRAYSCALE)
    prev_h, prev_w = img.shape
    grid = tmc_geometry.load_geometry_grid(geometry_csv)
    native_w, native_h = grid["native_width"], grid["native_height"]

    rows = geo_extent_guard.load_tmc_geometry(geometry_csv)
    lons = [r[2] for r in rows]
    lats = [r[3] for r in rows]
    lon_min, lon_max, lat_min, lat_max = min(lons), max(lons), min(lats), max(lats)
    craters = crater_catalog.query_bbox(lon_min, lon_max, lat_min, lat_max)

    moon_r_km = 1737.4
    mean_lat_rad = math.radians((lat_min + lat_max) / 2)
    lon_span_km = math.radians(lon_max - lon_min) * moon_r_km * math.cos(mean_lat_rad)
    lat_span_km = math.radians(lat_max - lat_min) * moon_r_km
    gsd_native_m = ((lon_span_km * 1000 / native_w) + (lat_span_km * 1000 / native_h)) / 2
    gsd_preview_m = gsd_native_m * (native_w / prev_w)  # preview is downsampled from native

    labels = []
    for c in craters:
        if not c.get("diameter_km"):
            continue
        x, y, resid = tmc_geometry.native_pixel_for_lonlat(grid, c["lon"], c["lat"])
        if resid > 1e-2:  # real residual check -- outside the true (possibly rotated) footprint
            continue
        px, py = x * prev_w / native_w, y * prev_h / native_h
        r_px = (c["diameter_km"] * 1000 / 2) / gsd_preview_m
        if r_px < 3 or px - r_px < 0 or py - r_px < 0 or px + r_px > prev_w or py + r_px > prev_h:
            continue  # too small to be a meaningful box, or falls outside the actual raster
        labels.append((px, py, r_px))
    return (preview_path, img.shape), labels


def _nac_labels(nac_id: str) -> tuple:
    kml_path = os.path.join(NAC_DIR, nac_id, f"{nac_id}_xml.kml")
    preview_path = os.path.join(NAC_DIR, nac_id, f"{nac_id}_preview.png")
    img_path = os.path.join(NAC_DIR, nac_id, f"{nac_id}.IMG")
    if not (os.path.exists(kml_path) and os.path.exists(preview_path) and os.path.exists(img_path)):
        return None, []

    from backend.data.real._overlap_maps import get_kml_corners
    with open(kml_path) as f:
        corners = get_kml_corners(f.read())

    raw = read_pds3_full(img_path)  # reuses our new datasets/ reader for real native LINES/SAMPLES
    native_h, native_w = raw["lines"], raw["samples"]

    img = cv2.imread(preview_path, cv2.IMREAD_GRAYSCALE)
    prev_h, prev_w = img.shape

    lons = [c[0] for c in corners]
    lats = [c[1] for c in corners]
    lon_min, lon_max, lat_min, lat_max = min(lons), max(lons), min(lats), max(lats)
    craters = crater_catalog.query_bbox(lon_min, lon_max, lat_min, lat_max)

    def haversine_km(lo1, la1, lo2, la2):
        lo1, la1, lo2, la2 = map(math.radians, [lo1, la1, lo2, la2])
        a = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
        return 2 * 1737.4 * math.asin(math.sqrt(a))

    along_km = haversine_km(*corners[0], *corners[1])
    cross_km = haversine_km(*corners[0], *corners[3])
    gsd_native_m = ((along_km * 1000 / native_h) + (cross_km * 1000 / native_w)) / 2
    gsd_preview_m = gsd_native_m * (native_h / prev_h)

    labels = []
    for c in craters:
        if not c.get("diameter_km"):
            continue
        line, sample, resid = geo_extent_guard.nac_corner_bilinear_fit(
            corners, native_h, native_w, c["lon"], c["lat"])
        if resid > 1e-3:
            continue
        px, py = sample * prev_w / native_w, line * prev_h / native_h
        r_px = (c["diameter_km"] * 1000 / 2) / gsd_preview_m
        if r_px < 3 or px - r_px < 0 or py - r_px < 0 or px + r_px > prev_w or py + r_px > prev_h:
            continue
        labels.append((px, py, r_px))
    return (preview_path, img.shape), labels


def main():
    os.makedirs(os.path.join(OUT_DIR, "images", "train"), exist_ok=True)
    os.makedirs(os.path.join(OUT_DIR, "labels", "train"), exist_ok=True)

    all_nac_ids = [d for d in os.listdir(NAC_DIR)
                   if os.path.exists(os.path.join(NAC_DIR, d, f"{d}_xml.kml"))]
    print(f"Real NAC frames with a local KML footprint (usable for labeling): {all_nac_ids}")

    summary = {}
    for image_id in CH2_IMAGE_IDS:
        info, labels = _ch2_labels(image_id)
        summary[image_id] = len(labels)
        if info is None or not labels:
            continue
        (src_path, shape) = info
        h, w = shape
        img_out = os.path.join(OUT_DIR, "images", "train", f"{image_id}.png")
        cv2.imwrite(img_out, cv2.imread(src_path, cv2.IMREAD_GRAYSCALE))
        with open(os.path.join(OUT_DIR, "labels", "train", f"{image_id}.txt"), "w") as f:
            for px, py, r in labels:
                f.write(f"0 {px/w:.6f} {py/h:.6f} {2*r/w:.6f} {2*r/h:.6f}\n")

    for nac_id in all_nac_ids:
        info, labels = _nac_labels(nac_id)
        summary[nac_id] = len(labels)
        if info is None or not labels:
            continue
        (src_path, shape) = info
        h, w = shape
        img_out = os.path.join(OUT_DIR, "images", "train", f"{nac_id}.png")
        cv2.imwrite(img_out, cv2.imread(src_path, cv2.IMREAD_GRAYSCALE))
        with open(os.path.join(OUT_DIR, "labels", "train", f"{nac_id}.txt"), "w") as f:
            for px, py, r in labels:
                f.write(f"0 {px/w:.6f} {py/h:.6f} {2*r/w:.6f} {2*r/h:.6f}\n")

    print("Real usable catalog-crater instances per image (honest counts, not padded):")
    for k, v in summary.items():
        print(f"  {k}: {v}")
    total = sum(summary.values())
    print(f"Total real training instances across {len(summary)} real images: {total}")

    with open(os.path.join(OUT_DIR, "data.yaml"), "w") as f:
        f.write(f"path: {os.path.abspath(OUT_DIR)}\ntrain: images/train\nval: images/train\nnc: 1\nnames: ['crater']\n")

    with open(os.path.join(OUT_DIR, "summary.json"), "w") as f:
        json.dump(summary, f, indent=2)


if __name__ == "__main__":
    main()
