"""Builds spec-compliant PDS3 and PDS4 test fixtures — NOT real mission data.

These exist to validate `pds_readers.py` against the real, documented on-disk
structure of PDS3-attached-label LRO NAC files and PDS4-labeled Chandrayaan-2
products, using a known synthetic pixel pattern we can assert round-trips
exactly. They do not simulate lunar imagery — `synthetic.py` already does that
for pipeline-level testing; these fixtures only exercise the byte-level label
parsing and offset arithmetic.

Format details (label keywords, Array_2D_Image structure, dtypes) were
confirmed against real ISSDC/PDS documentation and a real LRO NAC PDS4 label
before writing this — see pds_readers.py's module docstring and README.md.
"""
from __future__ import annotations

import os

import numpy as np


def _pattern(lines: int, samples: int) -> np.ndarray:
    # deterministic, easy to assert exactly: value = (row*samples + col) % 256
    idx = np.arange(lines * samples, dtype=np.uint8).reshape(lines, samples) if lines * samples <= 256 else \
        (np.add.outer(np.arange(lines), np.arange(samples)) % 256).astype(np.uint8)
    return idx


def make_pds3_attached(out_path: str, lines: int = 48, samples: int = 64, array: np.ndarray | None = None) -> np.ndarray:
    """Single-file PDS3 image: label text followed directly by binary DN bytes,
    exactly the structure of a classic direct LROC .IMG download. Pass `array`
    (uint8, shape (lines, samples)) to wrap real/synthetic content instead of
    the default deterministic test pattern."""
    if array is not None:
        img = array.astype(np.uint8)
        lines, samples = img.shape
    else:
        img = _pattern(lines, samples)
    record_bytes = samples  # one image line per physical record, matches real NAC convention

    label_lines = [
        "PDS_VERSION_ID          = PDS3",
        "RECORD_TYPE             = FIXED_LENGTH",
        f"RECORD_BYTES            = {record_bytes}",
        "FILE_RECORDS            = __FILE_RECORDS__",
        "LABEL_RECORDS           = __LABEL_RECORDS__",
        "^IMAGE                  = __IMAGE_POINTER__",
        "OBJECT                  = IMAGE",
        f"  LINES                = {lines}",
        f"  LINE_SAMPLES         = {samples}",
        "  SAMPLE_BITS          = 8",
        "  SAMPLE_TYPE          = MSB_UNSIGNED_INTEGER",
        "  BANDS                = 1",
        "END_OBJECT               = IMAGE",
        "END",
    ]
    label_text = "\r\n".join(label_lines) + "\r\n"
    label_records = -(-len(label_text) // record_bytes)  # ceil
    padded_len = label_records * record_bytes
    label_text_padded = label_text + " " * (padded_len - len(label_text))

    file_records = label_records + lines
    label_text_padded = (label_text_padded
                          .replace("__FILE_RECORDS__", str(file_records))
                          .replace("__LABEL_RECORDS__", str(label_records))
                          .replace("__IMAGE_POINTER__", str(label_records + 1)))
    # keyword substitution changed string length only if replacement differs in
    # digit count from placeholder; keep it simple by re-padding after substitution
    if len(label_text_padded) < padded_len:
        label_text_padded += " " * (padded_len - len(label_text_padded))
    else:
        # placeholders were long enough; trust exact fit for the fixture's fixed sizes
        label_text_padded = label_text_padded[:padded_len]

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(label_text_padded.encode("ascii"))
        f.write(img.tobytes())  # MSB_UNSIGNED_INTEGER, 8-bit -> plain bytes, no endian ambiguity at 1 byte/sample

    return img


PDS4_LABEL_TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<Product_Observational
  xmlns="http://pds.nasa.gov/pds4/pds/v1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Identification_Area>
    <logical_identifier>urn:test:fixture:ch2_ohrc_test</logical_identifier>
    <version_id>1.0</version_id>
    <title>Test fixture — not real Chandrayaan-2 data</title>
    <information_model_version>1.19.0.0</information_model_version>
    <product_class>Product_Observational</product_class>
  </Identification_Area>
  <Observation_Area>
    <Time_Coordinates>
      <start_date_time>2024-01-01T00:00:00Z</start_date_time>
      <stop_date_time>2024-01-01T00:00:01Z</stop_date_time>
    </Time_Coordinates>
    <Investigation_Area>
      <name>Test</name>
      <type>Mission</type>
    </Investigation_Area>
    <Observing_System>
      <Observing_System_Component>
        <name>Test</name>
        <type>Spacecraft</type>
      </Observing_System_Component>
    </Observing_System>
    <Target_Identification>
      <name>Moon</name>
      <type>Satellite</type>
    </Target_Identification>
  </Observation_Area>
  <File_Area_Observational>
    <File>
      <file_name>{img_filename}</file_name>
    </File>
    <Array_2D_Image>
      <local_identifier>Array_2D_Image</local_identifier>
      <offset unit="byte">0</offset>
      <axes>2</axes>
      <axis_index_order>Last Index Fastest</axis_index_order>
      <Element_Array>
        <data_type>UnsignedByte</data_type>
      </Element_Array>
      <Axis_Array>
        <axis_name>Line</axis_name>
        <elements>{lines}</elements>
        <sequence_number>1</sequence_number>
      </Axis_Array>
      <Axis_Array>
        <axis_name>Sample</axis_name>
        <elements>{samples}</elements>
        <sequence_number>2</sequence_number>
      </Axis_Array>
    </Array_2D_Image>
  </File_Area_Observational>
</Product_Observational>
"""


def make_pds4(out_xml_path: str, lines: int = 40, samples: int = 56, array: np.ndarray | None = None) -> np.ndarray:
    """Detached-label PDS4 product: XML label + companion raw .img, matching
    ISSDC's Chandrayaan-2 OHRC/TMC-2 Array_2D_Image structure. Pass `array`
    (uint8, shape (lines, samples)) to wrap real/synthetic content instead of
    the default deterministic test pattern."""
    if array is not None:
        img = array.astype(np.uint8)
        lines, samples = img.shape
    else:
        img = _pattern(lines, samples)
    img_filename = os.path.splitext(os.path.basename(out_xml_path))[0] + ".img"
    img_path = os.path.join(os.path.dirname(out_xml_path), img_filename)

    os.makedirs(os.path.dirname(out_xml_path), exist_ok=True)
    with open(img_path, "wb") as f:
        f.write(img.tobytes())
    with open(out_xml_path, "w", encoding="utf-8") as f:
        f.write(PDS4_LABEL_TEMPLATE.format(img_filename=img_filename, lines=lines, samples=samples))

    return img


if __name__ == "__main__":
    base = os.path.join(os.path.dirname(__file__), "fixtures")
    p3 = make_pds3_attached(os.path.join(base, "pds3_attached", "TEST_NAC.IMG"))
    print("PDS3 fixture pattern shape:", p3.shape)
    p4 = make_pds4(os.path.join(base, "pds4", "TEST_OHRC.xml"))
    print("PDS4 fixture pattern shape:", p4.shape)
