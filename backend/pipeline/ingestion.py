"""Generic image ingestion for Chandrayaan-2 (OHRC/TMC-2/IIRS) and LRO NAC imagery.

Does not hardcode any dataset path. Point `load_image` at any local file:

- PNG/JPG/TIF/TIFF (incl. multi-band cubes, band-averaged to grayscale): read
  generically via tifffile/OpenCV — this is the path the synthetic test-pair
  generator (`synthetic.py`) exercises, and it stays available unmodified.
- Real PDS3 (LRO NAC, attached or detached label) and PDS4 (Chandrayaan-2
  OHRC/TMC-2/IIRS, or PDS4-wrapped NAC) products: routed to
  `pds_readers.sniff_and_read`, which parses the real label structure (see
  that module's docstring for the confirmed format details and citations)
  instead of guessing at bit depth/byte order/offsets.
"""
from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass, field

import numpy as np
import cv2

try:
    import tifffile
except ImportError:  # pragma: no cover
    tifffile = None

from . import pds_readers

PDS_EXTENSIONS = {".xml", ".img", ".lbl"}


@dataclass
class LoadedImage:
    path: str
    gray: np.ndarray          # float32, single channel, original bit depth preserved
    original_shape: tuple
    dtype: str
    file_hash: str
    source_format: str = "raster"   # 'raster' | 'pds3_attached' | 'pds3_detached' | 'pds4'
    warnings: list = field(default_factory=list)
    geometry: dict = field(default_factory=dict)


def _file_hash(path: str) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        h.update(f.read(1 << 20))  # first MB is enough to key a cache
        h.update(str(os.path.getsize(path)).encode())
    return h.hexdigest()[:16]


def _band_average_if_needed(arr: np.ndarray) -> np.ndarray:
    if arr.ndim == 3 and arr.shape[-1] > 1:
        return arr.astype(np.float32).mean(axis=-1)
    if arr.ndim == 3:
        return arr[..., 0].astype(np.float32)
    return arr.astype(np.float32)


def load_image(path: str) -> LoadedImage:
    """Generic loader: works for any local OHRC/TMC-2/IIRS/NAC-style raster —
    PNG/JPG/TIFF for synthetic/dev data, or real PDS3/PDS4 products — without
    assuming a specific mission."""
    if not os.path.exists(path):
        raise FileNotFoundError(f"Image not found: {path}")

    ext = os.path.splitext(path)[1].lower()

    if ext in PDS_EXTENSIONS:
        result = pds_readers.sniff_and_read(path)
        gray = _band_average_if_needed(result.data)
        return LoadedImage(
            path=path,
            gray=gray,
            original_shape=gray.shape,
            dtype=result.dtype,
            file_hash=_file_hash(path),
            source_format=result.format,
            warnings=result.warnings,
            geometry=result.geometry,
        )

    arr = None
    if ext in (".tif", ".tiff") and tifffile is not None:
        try:
            arr = tifffile.imread(path)
        except Exception:
            arr = None

    if arr is None:
        arr = cv2.imread(path, cv2.IMREAD_UNCHANGED)
        if arr is None:
            raise IOError(f"Could not decode image: {path}")

    dtype = str(arr.dtype)

    if arr.ndim == 3:
        if arr.shape[-1] > 3:
            # multi-band cube (e.g. IIRS hyperspectral): average bands -> grayscale
            gray = arr.astype(np.float32).mean(axis=-1)
        elif arr.shape[-1] == 4:
            gray = cv2.cvtColor(arr, cv2.COLOR_BGRA2GRAY).astype(np.float32)
        else:
            gray = cv2.cvtColor(arr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    else:
        gray = arr.astype(np.float32)

    return LoadedImage(
        path=path,
        gray=gray,
        original_shape=gray.shape,
        dtype=dtype,
        file_hash=_file_hash(path),
        source_format="raster",
    )


def to_uint8(gray: np.ndarray) -> np.ndarray:
    """Percentile-stretch any bit depth into a display/matcher-friendly uint8 image.

    Real Chandrayaan-2 TMC-2 strips can be 200,000+ lines — np.percentile on the
    full array forces an internal sort/copy that has actually OOM'd on a real
    244,000-line product (~7GB for the float64 copy alone). Percentiles are
    estimated from a bounded random subsample instead (statistically sufficient
    for a 1st/99th percentile stretch) while the stretch itself is still applied
    to the full-resolution array — no loss of image detail, just a cheaper way
    to pick the two stretch bounds."""
    sample = gray
    if gray.size > 2_000_000:
        rng = np.random.default_rng(0)
        idx = rng.integers(0, gray.size, size=2_000_000)
        sample = gray.ravel()[idx]
    lo, hi = np.percentile(sample, [1, 99])
    if hi <= lo:
        lo, hi = float(gray.min()), float(gray.max() or 1.0)
    stretched = np.clip((gray - lo) / max(hi - lo, 1e-6), 0, 1)
    return (stretched * 255).astype(np.uint8)
