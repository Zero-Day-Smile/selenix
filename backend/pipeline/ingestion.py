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

# EXIF tag ids (per the standard Exif spec, not this project's own
# invention) that only ever get written by an actual physical camera --
# no real satellite/orbital product in this project's real data (PDS3,
# PDS4, or the plain PNG previews standing in for them) carries any of
# these. This is a real, checkable fact about the file, not a fabricated
# "is this the moon" classifier -- it only ever fires on genuine
# consumer-camera photos (a phone/DSLR JPEG), which is exactly the
# failure mode this guards against (e.g. a user accidentally uploading
# an ordinary photo, which the pipeline would otherwise run real SIFT
# matching on and present meaningless "matches" for, as if it were a
# real analysis).
_EXIF_MAKE = 271
_EXIF_MODEL = 272
_EXIF_GPS_INFO = 34853
_EXIF_DATETIME_ORIGINAL = 36867
_CAMERA_EXIF_TAGS = {_EXIF_MAKE, _EXIF_MODEL, _EXIF_GPS_INFO, _EXIF_DATETIME_ORIGINAL}


def _reject_if_camera_photo(path: str) -> None:
    """Raises ValueError if the file's own real EXIF metadata says a
    camera took it. Fails open (never raises) for any file this can't
    read EXIF from at all -- PDS products, most PNGs, and TIFFs without
    EXIF all pass through silently, exactly as before; this only ever
    catches a file that is positively, verifiably a camera photo."""
    try:
        from PIL import Image
        with Image.open(path) as img:
            exif = img.getexif()
            if not exif:
                return
            found = {tag: exif[tag] for tag in _CAMERA_EXIF_TAGS if tag in exif}
    except Exception:
        return  # not readable as EXIF at all -- nothing to flag

    if found:
        make = found.get(_EXIF_MAKE)
        model = found.get(_EXIF_MODEL)
        detail = f" (Make: {make!r}, Model: {model!r})" if (make or model) else ""
        raise ValueError(
            f"This file's own EXIF metadata says it was taken by a camera{detail}, not a "
            f"satellite/orbital imaging product. This tool registers Chandrayaan-2/LRO lunar "
            f"imagery only -- please upload a real TMC-2/OHRC/IIRS or LRO NAC product (or a "
            f"plain grayscale preview of one), not an ordinary photo."
        )


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

    _reject_if_camera_photo(path)

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


def to_uint8_adaptive(gray: np.ndarray, safety_percentile: tuple = (2, 98),
                       iqr_multiplier: float = 3.0) -> np.ndarray:
    """Per-image adaptive percentile stretch — a display/preview-quality fix,
    NOT used by the matching pipeline (that still calls the fixed-p1/p99
    `to_uint8` above; changing that would silently alter matching inputs
    without the re-validation that deserves).

    Found via histogram diagnostic: ~1/3 of our real NAC frames (7/21) have
    real terrain content concentrated in a much tighter DN band than their
    own p1-p99 span suggests (e.g. M1385774154LE: raw IQR=7 within a p1-p99
    span of 124) — a sparse, low-density tail of shadow/bright pixels drags
    the global percentile stretch bounds wide, wasting most of the 0-255
    output range on content that barely exists. Confirmed via direct
    saturation check (0% of pixels at/near the raw max) that this is real,
    uncompressed detail, not clipped/lost data — so a smarter stretch, not
    exclusion, is the correct fix.

    Bounds are set from the image's own dense core: median +/- iqr_multiplier
    * IQR, intersected with a loose `safety_percentile` band so a frame with
    a genuinely wide real distribution isn't over-tightened. This lets images
    like M1385774154LE actually use the available output range without fully
    discarding the real (if sparse) shadow/bright tail — those pixels still
    clip to 0/255 rather than vanishing, same as any percentile stretch, but
    only the truly sparse extremes do, not the dense core that used to share
    their fate."""
    sample = gray
    if gray.size > 2_000_000:
        rng = np.random.default_rng(0)
        idx = rng.integers(0, gray.size, size=2_000_000)
        sample = gray.ravel()[idx]
    p_lo_safety, p_hi_safety = np.percentile(sample, safety_percentile)
    median = np.median(sample)
    q1, q3 = np.percentile(sample, [25, 75])
    iqr = q3 - q1
    if iqr <= 0:
        lo, hi = float(p_lo_safety), float(p_hi_safety)
    else:
        lo = max(float(p_lo_safety), float(median - iqr_multiplier * iqr))
        hi = min(float(p_hi_safety), float(median + iqr_multiplier * iqr))
    if hi <= lo:
        lo, hi = float(gray.min()), float(gray.max() or 1.0)
    stretched = np.clip((gray - lo) / max(hi - lo, 1e-6), 0, 1)
    return (stretched * 255).astype(np.uint8)
