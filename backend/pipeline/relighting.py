"""Image-derived relighting for the sun-angle/scale-invariance test suite.

WHY THIS EXISTS: our PS is titled "multi-modal, sun angle and scale
invariant image correspondence." Every real pair tested so far conflates
that literal requirement with the much harder, still-unsolved problem of
crater self-similarity on ordinary terrain (see TASKS.md). This module
lets us build synthetic pairs from a SINGLE real image with an exact
known ground-truth transform, isolating "does the pipeline tolerate
illumination/scale changes" from "can it find correspondence on
self-similar terrain at all."

APPROXIMATION, NOT PHYSICALLY GROUND-TRUTHED -- read before using this
anywhere else. A real resynthesis at a new sun angle needs real surface
normals (a DEM) at the image's native resolution. We don't have one: the
best real elevation product (LOLA GDR, ~59m/px at best) is far coarser
than NAC/TMC-2 imagery (~0.5-25m/px) -- relighting from it would only
change illumination correctly at the DEM's coarse scale, not at the
actual crater scale visible in the image (the same resolution-mismatch
reason a coarse DEM was already ruled out for crater-scale PSR/geometry
work elsewhere in this project).

Instead this builds a FAKE, RELATIVE height field directly from the
image's own intensity gradient (the classic "recover a height map from a
single shaded image" shortcut, via Frankot-Chellappa gradient
integration), then relights it two ways that together approximate real
appearance:
  1. Per-pixel Lambertian shading from the fake surface normal (local
     tilt: which way a crater wall or ridge faces).
  2. Per-pixel CAST shadow via a horizon sweep over the same fake height
     field along the new light's azimuth -- this is what makes a shadow
     actually lengthen/shorten and swing direction as sun angle changes,
     not just a uniform brightness change. A pure per-pixel normal-dot-
     light model (no height field, no occlusion) cannot produce this: it
     was tried first and visually failed the checkpoint (real shadows
     behind crater rims never appeared, azimuth changes were invisible).

This deliberately conflates two things a real DEM would keep separate:
genuine topographic relief, and any albedo texture (surface markings/
composition differences unrelated to relief) that happens to look like
shading. The fake height field is also relative/unscaled -- there's no
real vertical datum, only "which parts read as higher or lower given how
they're currently shaded." That's a real, acknowledged limitation -- the
relit output is a plausible image-derived approximation for stress-
testing illumination sensitivity, not a physically accurate resimulation
of the scene under a different sun.

Sun-angle "delta" throughout this module means an ELEVATION change
(matches this project's existing solar_incidence_deg = 90 - elevation
convention). Azimuth shifts are also supported and visibly rotate the
cast-shadow direction (see Step 1 checkpoint images), which the earlier
pure-Lambertian attempt could not do at all.
"""
from __future__ import annotations

import numpy as np
import cv2


def light_vector(elevation_deg: float, azimuth_deg: float) -> np.ndarray:
    el = np.radians(elevation_deg)
    az = np.radians(azimuth_deg)
    return np.array([
        np.cos(el) * np.cos(az),
        np.cos(el) * np.sin(az),
        np.sin(el),
    ], dtype=np.float64)


def _gradients(gray_u8: np.ndarray, strength: float, blur_sigma: float) -> tuple:
    """Surface slopes (p, q) = (dz/dx, dz/dy) estimated from the image's own
    intensity gradient. `strength` is a free relief-exaggeration factor
    (this is fake, relative relief -- there is no real vertical scale to
    calibrate against), tuned so the fake height field produces a visibly
    plausible shadow response, not fit to any ground truth."""
    g = cv2.GaussianBlur(gray_u8.astype(np.float32), (0, 0), sigmaX=blur_sigma)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3) / 8.0
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3) / 8.0
    p = strength * gx / 255.0
    q = strength * gy / 255.0
    return p, q


def _normals_from_slopes(p: np.ndarray, q: np.ndarray) -> np.ndarray:
    nx, ny, nz = -p, -q, np.ones_like(p)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / norm, ny / norm, nz / norm], axis=-1)


def integrate_height_field(p: np.ndarray, q: np.ndarray) -> np.ndarray:
    """Frankot & Chellappa (1988) FFT gradient integration: the standard,
    well-posed way to recover a (relative, unscaled) height field from a
    slope field in one shot, without iterative drift. Used here only to
    get a height field good enough for a horizon/shadow sweep -- not
    presented anywhere as a real elevation product."""
    h, w = p.shape
    wx = np.fft.fftfreq(w).reshape(1, -1) * 2 * np.pi
    wy = np.fft.fftfreq(h).reshape(-1, 1) * 2 * np.pi
    Fx = np.fft.fft2(p)
    Fy = np.fft.fft2(q)
    denom = wx ** 2 + wy ** 2
    denom[0, 0] = 1.0
    Fz = (-1j * wx * Fx - 1j * wy * Fy) / denom
    Fz[0, 0] = 0.0
    z = np.real(np.fft.ifft2(Fz))
    return z - z.mean()


def _rotate(img: np.ndarray, angle_deg: float) -> tuple:
    """Rotate with an expanded canvas (no cropping) so a horizon sweep along
    the new +x axis doesn't run off the original frame. Returns the rotated
    array plus enough info to invert the rotation exactly."""
    h, w = img.shape[:2]
    center = (w / 2.0, h / 2.0)
    M = cv2.getRotationMatrix2D(center, angle_deg, 1.0)
    cos, sin = abs(M[0, 0]), abs(M[0, 1])
    new_w = int(h * sin + w * cos)
    new_h = int(h * cos + w * sin)
    M[0, 2] += (new_w / 2.0) - center[0]
    M[1, 2] += (new_h / 2.0) - center[1]
    rotated = cv2.warpAffine(img, M, (new_w, new_h), flags=cv2.INTER_LINEAR,
                              borderMode=cv2.BORDER_REPLICATE)
    return rotated, M, (w, h)


def _unrotate(img: np.ndarray, M: np.ndarray, orig_size: tuple) -> np.ndarray:
    Minv = cv2.invertAffineTransform(M)
    return cv2.warpAffine(img, Minv, orig_size, flags=cv2.INTER_LINEAR,
                           borderMode=cv2.BORDER_REPLICATE)


def cast_shadow_mask(height: np.ndarray, elevation_deg: float, azimuth_deg: float) -> np.ndarray:
    """Horizon-sweep cast-shadow mask over a (fake) height field: True where
    a taller point closer to the sun blocks direct light. Standard O(N)
    terrain-shadowing sweep, vectorized per scanline via a running max --
    not a brute-force ray march. `height` must be in the same relative
    units as the pixel grid (one unit of height per one pixel of run),
    consistent with how integrate_height_field/_gradients are scaled.
    """
    el = np.radians(max(elevation_deg, 0.5))
    # Rotate so the light's horizontal direction points along +x; a scanline
    # then walks directly toward/away from the sun.
    rotated, M, orig_size = _rotate(height, -azimuth_deg)
    slope = np.tan(el)
    xs = np.arange(rotated.shape[1], dtype=np.float64)
    g = rotated + xs[np.newaxis, :] * slope  # ray-height-compensated signal
    running_max_inclusive = np.maximum.accumulate(g, axis=1)
    running_max_prior = np.empty_like(running_max_inclusive)
    running_max_prior[:, 0] = -np.inf
    running_max_prior[:, 1:] = running_max_inclusive[:, :-1]
    shadow_rot = (g < running_max_prior - 1e-6).astype(np.float32)
    shadow = _unrotate(shadow_rot, M, orig_size)
    return shadow > 0.5


def decompose(gray_u8: np.ndarray, sun_elevation_deg: float, sun_azimuth_deg: float,
              strength: float = 6.0, blur_sigma: float = 1.5, ambient: float = 0.08,
              shading_floor: float = 0.10) -> dict:
    """Split a real image into an approximate albedo layer and the shading
    (Lambertian tilt x cast-shadow occlusion) implied by its own fake
    height field under its real, known sun angle (from the image's real
    ancillary telemetry, never guessed). `shading_floor` prevents division
    blow-up in already-dark/shadowed source pixels -- physically, deep
    shadow carries ~no signal anyway, so albedo there is genuinely
    unrecoverable and gets clamped rather than "recovered"."""
    p, q = _gradients(gray_u8, strength, blur_sigma)
    normals = _normals_from_slopes(p, q)
    height = integrate_height_field(p, q)
    light = light_vector(sun_elevation_deg, sun_azimuth_deg)
    lambert = np.clip(normals @ light, 0.0, None)
    shadow = cast_shadow_mask(height, sun_elevation_deg, sun_azimuth_deg)
    shading = ambient + (1 - ambient) * lambert
    shading[shadow] = ambient
    shading = np.clip(shading, shading_floor, None)
    albedo = gray_u8.astype(np.float32) / shading
    return {"normals": normals, "height": height, "shading": shading, "albedo": albedo, "shadow_mask": shadow}


def relight(gray_u8: np.ndarray, sun_elevation_deg: float, sun_azimuth_deg: float,
            new_elevation_deg: float, new_azimuth_deg: float,
            strength: float = 6.0, blur_sigma: float = 1.5, ambient: float = 0.08,
            shading_floor: float = 0.10) -> np.ndarray:
    """Re-synthesize the image at a different synthetic sun angle from the
    albedo/shading/height decomposition above. At new_elevation==
    sun_elevation_deg and new_azimuth==sun_azimuth_deg this is an exact
    round-trip identity (up to floating point) -- a built-in self-
    consistency check, not just an assumption."""
    decomp = decompose(gray_u8, sun_elevation_deg, sun_azimuth_deg, strength, blur_sigma, ambient, shading_floor)
    new_light = light_vector(new_elevation_deg, new_azimuth_deg)
    new_lambert = np.clip(decomp["normals"] @ new_light, 0.0, None)
    new_shadow = cast_shadow_mask(decomp["height"], new_elevation_deg, new_azimuth_deg)
    new_shading = ambient + (1 - ambient) * new_lambert
    new_shading[new_shadow] = ambient
    relit = decomp["albedo"] * new_shading
    return np.clip(relit, 0, 255).astype(np.uint8)
