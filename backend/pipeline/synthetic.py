"""Synthetic lunar-like test-pair generator.

Real Chandrayaan-2 OHRC/TMC-2/IIRS + LRO NAC files were not provided in this
environment. This generator produces a source/reference pair that exercises
every pipeline stage the same way real data would: crater-like terrain
texture, simulated illumination change (sun angle), rotation, scale change,
and noise. Use it for development/CI; swap in real files via
`backend/pipeline/ingestion.load_image` the moment a dataset drop is available.
"""
from __future__ import annotations

import os

import cv2
import numpy as np


def _make_terrain(size: int = 900, n_craters: int = 140, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    terrain = rng.normal(128, 8, (size, size)).astype(np.float32)
    # low-frequency albedo variation (mare/highland-like patches)
    low = cv2.resize(rng.normal(0, 25, (9, 9)).astype(np.float32), (size, size),
                      interpolation=cv2.INTER_CUBIC)
    terrain += low

    for _ in range(n_craters):
        cx, cy = rng.integers(0, size, 2)
        r = rng.integers(6, 45)
        yy, xx = np.ogrid[:size, :size]
        dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
        rim = np.exp(-((dist - r) ** 2) / (2 * (r * 0.18 + 1) ** 2)) * rng.uniform(30, 70)
        bowl = -np.exp(-(dist ** 2) / (2 * (r * 0.7) ** 2)) * rng.uniform(15, 35)
        terrain += rim + bowl

    terrain = np.clip(terrain, 0, 255)
    return terrain.astype(np.float32)


def _apply_illumination(img: np.ndarray, sun_angle_deg: float) -> np.ndarray:
    """Simulate a directional-lighting shift by adding a gradient shading term
    and gamma change, approximating a different sun azimuth/elevation."""
    h, w = img.shape
    theta = np.deg2rad(sun_angle_deg)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    grad = (np.cos(theta) * (xx - w / 2) + np.sin(theta) * (yy - h / 2)) / max(h, w)
    shaded = img + grad * 60
    shaded = np.clip(shaded, 0, 255)
    gamma = 0.85 if sun_angle_deg > 30 else 1.0
    normed = (shaded / 255.0) ** gamma
    return (normed * 255).astype(np.float32)


def generate_pair(out_dir: str, rotation_deg: float = 12.0, scale: float = 1.35,
                   sun_angle_deg: float = 40.0, noise_std: float = 4.0,
                   seed: int = 0) -> dict:
    """Writes src.png (moving/source) and ref.png (fixed/reference, larger =
    simulates a higher-resolution NAC reference) to out_dir. Returns paths and
    the ground-truth homography (ref = H_src2ref @ src) for later error checks."""
    os.makedirs(out_dir, exist_ok=True)
    base = _make_terrain(size=700, seed=seed)

    ref_size = int(700 * scale)
    ref = cv2.resize(base, (ref_size, ref_size), interpolation=cv2.INTER_CUBIC)

    center = (350, 350)
    M = cv2.getRotationMatrix2D(center, rotation_deg, 1.0)
    src = cv2.warpAffine(base, M, (700, 700), borderMode=cv2.BORDER_REFLECT)
    src = _apply_illumination(src, sun_angle_deg)
    src = src + np.random.default_rng(seed + 1).normal(0, noise_std, src.shape)
    src = np.clip(src, 0, 255).astype(np.uint8)
    ref = np.clip(ref, 0, 255).astype(np.uint8)

    src_path = os.path.join(out_dir, "src.png")
    ref_path = os.path.join(out_dir, "ref.png")
    cv2.imwrite(src_path, src)
    cv2.imwrite(ref_path, ref)

    # ground truth: src (700x700, rotated by rotation_deg about center) -> ref (scaled by `scale`)
    M_inv = cv2.invertAffineTransform(M)
    A = np.vstack([M_inv, [0, 0, 1]]).astype(np.float64)
    S = np.array([[scale, 0, 0], [0, scale, 0], [0, 0, 1]], dtype=np.float64)
    H_gt = S @ A

    return {"src_path": src_path, "ref_path": ref_path, "H_gt": H_gt.tolist()}
