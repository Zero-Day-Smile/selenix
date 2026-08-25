"""Real-format readers for Chandrayaan-2 (OHRC/TMC-2/IIRS) and LRO NAC imagery.

Format facts this module is written against (confirmed via ISSDC/PDS documentation
and a real product label before writing any parsing code — see README.md "Real
data ingestion" section for citations):

- **Chandrayaan-2 OHRC/TMC-2/IIRS**: archived in PDS4 since Dec 2020 — a binary
  ``.img`` payload plus an XML label (``Product_Observational`` ->
  ``File_Area_Observational`` -> ``File`` + ``Array_2D_Image`` for OHRC/TMC-2, or
  ``Array_3D_Spectrum``/``Array_2D_Image`` per band for IIRS's hyperspectral
  cube). ISRO's Local Data Dictionary (``ch2_ingest_ldd_ISDA_1300.xsd``) extends
  the standard PDS4 IMG schema rather than replacing it, so a generic PDS4 Array
  reader (via the ``pds4_tools`` package) works unmodified.
- **LRO NAC**: originally distributed as classic PDS3 with an *attached* label
  (the raw ``.IMG`` you get directly from the LROC site) — 8-bit unsigned DN,
  companded from 12-bit onboard and already decompanded before EDR release (no
  LOCO/on-the-fly decompression needed for standard archive products). The same
  data has since also been republished PDS4-wrapped (detached XML label +
  the identical ``.IMG`` payload, with the original PDS3 attached header kept as
  an opaque byte range). Verified directly against a real product label,
  LROLRC_0012 / M1100131076RE: ``Element_Array data_type=UnsignedByte``,
  ``Axis_Array`` Line=25600 / Sample=5064, ``offset=5064`` bytes (== the byte
  length of the original PDS3 attached header for that product: RECORD_BYTES
  5064 x LABEL_RECORDS 1). Both distribution forms are handled here.

No ISIS3 dependency anywhere in this module, as scoped by the project brief.
"""
from __future__ import annotations

import os
import warnings
from dataclasses import dataclass, field

import numpy as np
import pvl


@dataclass
class PdsReadResult:
    data: np.ndarray
    format: str                 # 'pds3_attached' | 'pds3_detached' | 'pds4'
    lines: int
    samples: int
    bands: int
    dtype: str
    source_label: str
    warnings: list = field(default_factory=list)
    geometry: dict = field(default_factory=dict)  # best-effort resolution/scale info, if present in label


# --- PDS3 (LRO NAC) -----------------------------------------------------

_PDS3_SAMPLE_TYPE_MAP = {
    # (endianness, signed) -> numpy dtype prefix; bit depth appended separately
    "MSB_UNSIGNED_INTEGER": (">", "u"),
    "UNSIGNED_INTEGER": (">", "u"),   # PDS3 default byte order is big-endian (MSB) unless stated
    "LSB_UNSIGNED_INTEGER": ("<", "u"),
    "MSB_INTEGER": (">", "i"),
    "INTEGER": (">", "i"),
    "LSB_INTEGER": ("<", "i"),
    "IEEE_REAL": (">", "f"),
    "PC_REAL": ("<", "f"),
    "FLOAT": (">", "f"),
}


def _pds3_dtype(sample_type: str, sample_bits: int) -> tuple:
    """Returns (dtype, warning_or_None). For 8-bit *signed* INTEGER image
    samples specifically, the signed dtype is overridden to unsigned — a real,
    confirmed quirk, not a guess: a genuine LROC NAC EDR product
    (M1100131076RE, LROLRC_0012) has SAMPLE_TYPE=LSB_INTEGER (signed, per the
    literal PDS3 vocabulary) in its attached label, but the same product's
    independently-authored PDS4 re-label says Element_Array
    data_type=UnsignedByte for the identical bytes, and reading the raw bytes
    as unsigned produces a coherent lunar surface image (visible craters,
    plausible DN range 16-167) while reading them as signed produces a
    washed-out image with a spurious black-pixel discontinuity exactly at
    every byte==128 crossing — visually confirmed, not assumed. NAC EDR DN is
    physically a non-negative count regardless of what the label's byte-order
    keyword says, so this override only applies at 8 bits (where "signed vs
    unsigned" has historically been handled loosely by some PDS3 archives) —
    16/32-bit signed data is trusted as genuinely signed."""
    key = str(sample_type).strip().upper()
    if key not in _PDS3_SAMPLE_TYPE_MAP:
        raise ValueError(
            f"Unrecognized PDS3 SAMPLE_TYPE '{sample_type}' — refusing to guess a byte "
            f"layout, since an incorrect assumption here silently corrupts every pixel."
        )
    prefix, kind = _PDS3_SAMPLE_TYPE_MAP[key]
    nbytes = int(sample_bits) // 8
    warning = None
    if nbytes == 1 and kind == "i":
        warning = (
            f"SAMPLE_TYPE='{sample_type}' is nominally signed 8-bit, but this is a known "
            f"real-archive quirk for image DN (confirmed against LROC NAC product "
            f"M1100131076RE — see pds_readers.py) — reading as UNSIGNED 8-bit instead. "
            f"If this product's data genuinely is signed 8-bit, results will be wrong; "
            f"the pixel value distribution is worth a sanity check."
        )
        kind = "u"
    return np.dtype(f"{prefix}{kind}{nbytes}"), warning


def _pointer_to_target(pointer_value, record_bytes: int, label_dir: str) -> tuple:
    """PDS3 ``^IMAGE`` (or similar) pointers take one of three forms:
    - a bare record number (1-indexed, offset by RECORD_BYTES) — attached label
    - an explicit byte count with a <BYTES> unit — attached label, byte-addressed
    - ("FILENAME.IMG", record_number) — detached label pointing at an external file
    Returns (target_path_or_None, byte_offset). None target means "same file
    the label was read from"."""
    if isinstance(pointer_value, (list, tuple)) and len(pointer_value) == 2:
        filename, record_part = pointer_value
        target = os.path.join(label_dir, str(filename))
        offset = _pointer_to_target(record_part, record_bytes, label_dir)[1]
        return target, offset

    units = getattr(pointer_value, "units", None)
    if units is not None and str(units).upper() == "BYTES":
        return None, int(pointer_value.value)
    # bare number => 1-indexed record number
    record_number = int(pointer_value)
    return None, (record_number - 1) * record_bytes


def read_pds3(path: str) -> PdsReadResult:
    """Reads a classic PDS3 image: attached label (label text directly followed
    by binary image data in the same .IMG file, the form you get from a direct
    LROC download) or detached label (.LBL alongside a plain binary .IMG).
    `pvl` is built specifically to parse the label text and stop cleanly before
    binary data, so `pvl.load` works on both forms unmodified."""
    label = pvl.load(path)
    warn_list: list = []

    image_key = None
    for key in ("IMAGE", "QUBE"):
        if key in label:
            image_key = key
            break
    if image_key is None:
        raise ValueError(
            f"No IMAGE or QUBE object found in PDS3 label for {path} — cannot "
            f"determine raster layout without it (refusing to guess)."
        )
    image_obj = label[image_key]

    lines = int(image_obj["LINES"])
    samples = int(image_obj["LINE_SAMPLES"])
    bands = int(image_obj.get("BANDS", 1))
    sample_bits = int(image_obj["SAMPLE_BITS"])
    sample_type = str(image_obj["SAMPLE_TYPE"])
    dtype, dtype_warning = _pds3_dtype(sample_type, sample_bits)
    if dtype_warning:
        warn_list.append(dtype_warning)

    if bands > 1:
        storage = str(image_obj.get("BAND_STORAGE_TYPE", "BAND_SEQUENTIAL")).upper()
        if storage != "BAND_SEQUENTIAL":
            raise ValueError(
                f"BAND_STORAGE_TYPE={storage} is not implemented (only BAND_SEQUENTIAL "
                f"is handled) — refusing to misinterpret the interleaving."
            )

    record_bytes = int(label.get("RECORD_BYTES", 0))
    pointer_key = f"^{image_key}"
    if pointer_key not in label:
        raise ValueError(f"No {pointer_key} pointer in PDS3 label for {path}.")
    if record_bytes == 0 and not hasattr(label[pointer_key], "units"):
        raise ValueError("RECORD_BYTES missing and pointer isn't byte-qualified — cannot locate image data.")
    external_target, offset = _pointer_to_target(label[pointer_key], record_bytes, os.path.dirname(path))
    data_path = external_target if external_target else path

    count = lines * samples * bands
    with open(data_path, "rb") as f:
        f.seek(offset)
        buf = f.read(count * dtype.itemsize)
    if len(buf) < count * dtype.itemsize:
        raise ValueError(
            f"PDS3 data file {data_path} is truncated: expected {count * dtype.itemsize} bytes of "
            f"image data at offset {offset}, found {len(buf)}."
        )
    arr = np.frombuffer(buf, dtype=dtype)
    arr = arr.reshape((bands, lines, samples)) if bands > 1 else arr.reshape((lines, samples))
    if bands > 1:
        arr = np.moveaxis(arr, 0, -1)  # -> (lines, samples, bands), consistent with ingestion.py's convention

    geometry = {}
    for key in ("MAP_SCALE", "MAP_RESOLUTION", "IMAGE_RESOLUTION"):
        if key in label:
            geometry[key.lower()] = str(label[key])
    if not geometry:
        warn_list.append("No MAP_SCALE/MAP_RESOLUTION/IMAGE_RESOLUTION keyword found in label — "
                          "no label-derived ground sample distance available for this product.")

    fmt = "pds3_detached" if external_target else "pds3_attached"
    return PdsReadResult(
        data=arr.astype(np.float32), format=fmt, lines=lines, samples=samples, bands=bands,
        dtype=str(dtype), source_label=path, warnings=warn_list, geometry=geometry,
    )


# --- PDS4 (Chandrayaan-2 OHRC/TMC-2/IIRS, and PDS4-wrapped LRO NAC) ----

def read_pds4(xml_path: str) -> PdsReadResult:
    """Reads any PDS4-labeled array product (Chandrayaan-2 OHRC/TMC-2/IIRS, or a
    PDS4-wrapped NAC product) via `pds4_tools`, which understands the standard
    Array_2D_Image / Array_3D_Spectrum / Array_3D_Image structures directly —
    no manual XML/offset parsing needed for the common case."""
    import pds4_tools

    warn_list: list = []
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        structures = pds4_tools.read(xml_path, quiet=True, lazy_load=False)
        for w in caught:
            warn_list.append(str(w.message))

    array_struct = None
    for s in structures:
        data = getattr(s, "data", None)
        if data is not None and hasattr(data, "ndim"):
            array_struct = s
            break
    if array_struct is None:
        raise ValueError(f"No Array structure found in PDS4 product {xml_path} — is this an image product?")

    arr = np.asarray(array_struct.data)

    axis_names = []
    try:
        axis_arrays = array_struct.meta_data.get("Axis_Array", [])
        if isinstance(axis_arrays, dict):
            axis_arrays = [axis_arrays]
        axis_names = [str(a.get("axis_name", "")).lower() for a in axis_arrays]
    except Exception as e:
        warn_list.append(f"Could not read Axis_Array ordering from label ({e}) — "
                          f"falling back to a size-based heuristic for band axis if 3D.")

    bands = 1
    if arr.ndim == 3:
        band_axis = None
        for i, name in enumerate(axis_names):
            if "band" in name:
                band_axis = i
                break
        if band_axis is None:
            band_axis = int(np.argmin(arr.shape))
            warn_list.append(
                f"Could not identify the spectral/band axis by name in the PDS4 label; "
                f"assumed it's the smallest-size axis (shape={arr.shape}, chose axis {band_axis}). "
                f"Verify this against the label before trusting IIRS band-averaged output."
            )
        arr = np.moveaxis(arr, band_axis, -1)
        bands = arr.shape[-1]
        lines, samples = arr.shape[0], arr.shape[1]
    else:
        lines, samples = arr.shape[0], arr.shape[1]

    geometry = {}
    try:
        disc = array_struct.meta_data
        for key in ("resolution", "spatial_resolution", "pixel_scale"):
            if key in disc:
                geometry[key] = disc[key]
    except Exception:
        pass

    return PdsReadResult(
        data=arr.astype(np.float32), format="pds4", lines=lines, samples=samples, bands=bands,
        dtype=str(arr.dtype), source_label=xml_path, warnings=warn_list, geometry=geometry,
    )


# --- format sniffing -----------------------------------------------------

def sniff_and_read(path: str) -> PdsReadResult:
    """Given a path to either an .xml (PDS4) or .img/.IMG (PDS3, or PDS4 with a
    detached sibling .xml label), pick the right reader. Raises rather than
    silently falling back if the format can't be determined."""
    ext = os.path.splitext(path)[1].lower()
    stem = os.path.splitext(path)[0]

    if ext == ".xml":
        return read_pds4(path)

    if ext in (".img",):
        sibling_xml = stem + ".xml"
        if os.path.exists(sibling_xml):
            return read_pds4(sibling_xml)
        sibling_lbl = stem + ".lbl"
        if not os.path.exists(sibling_lbl):
            sibling_lbl = stem + ".LBL"
        if os.path.exists(sibling_lbl):
            return read_pds3(sibling_lbl)  # pvl.load also happily takes a detached-label path with a sibling image
        # attached label: parse the .img itself
        return read_pds3(path)

    if ext in (".lbl",):
        return read_pds3(path)

    raise ValueError(f"Don't know how to sniff PDS format for extension '{ext}' ({path}).")
