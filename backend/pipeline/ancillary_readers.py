"""Readers for Chandrayaan-2 ancillary (fixed-width ASCII) telemetry files
that accompany an OHRC/TMC-2/IIRS product — orbit/attitude/libration/sun-angle
— per the ISSDC `miscellaneous/readme.txt` format spec. Only `.spm` (sun-angle)
is implemented: it's the one with direct pipeline value (real per-acquisition
solar geometry vs. this project's synthetic `sun_angle_deg`). `.oat`/`.oath`
(orbit/attitude, 628/201-byte records) and `.lbr` (libration, 258-byte
records) are documented in the same readme but not read here — they matter
for footprint/geometry work, not for illumination, and weren't needed yet.

Field layout note: the readme documents fixed byte-column widths (e.g.
`F9.3` for phase_angle), but real ISSDC-produced `.spm` files pack fields
tighter than that spec's column widths (verified against a real product,
CH2TMC 20260813T102329 — e.g. block_len and year run together with no
separating space: `2492026` = `249` + `2026`). Whitespace-tokenizing each
line and taking fields by position (verified against this real file) is more
robust than trusting the literal byte-column widths from the spec doc."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class SunAngleRecord:
    record_num: int
    year: int
    month: int
    day: int
    hour: int
    minute: int
    second: int
    millisecond: int
    phase_angle_deg: float
    sun_aspect_deg: float
    sun_azimuth_deg: float
    sun_elevation_deg: float

    @property
    def solar_incidence_deg(self) -> float:
        """Per readme.txt: Solar Incidence Angle = 90 - Sun Elevation."""
        return 90.0 - self.sun_elevation_deg


@dataclass
class SunAngleSummary:
    n_records: int
    sun_elevation_start: float
    sun_elevation_end: float
    sun_elevation_mean: float
    sun_azimuth_start: float
    sun_azimuth_end: float
    solar_incidence_mean: float
    records: list  # list[SunAngleRecord], kept for anyone who needs per-line detail


def read_spm(path: str) -> SunAngleSummary:
    records = []
    with open(path, "r") as f:
        for line in f:
            toks = line.split()
            if not toks or toks[0] != "ORBTATTD":
                continue
            if len(toks) < 19:
                continue  # malformed/truncated record — skip rather than guess
            block_and_year = toks[2]
            if len(block_and_year) < 4:
                continue
            year = int(block_and_year[-4:])
            records.append(SunAngleRecord(
                record_num=int(toks[1]),
                year=year,
                month=int(toks[3]), day=int(toks[4]),
                hour=int(toks[5]), minute=int(toks[6]), second=int(toks[7]),
                millisecond=int(toks[8]),
                phase_angle_deg=float(toks[15]),
                sun_aspect_deg=float(toks[16]),
                sun_azimuth_deg=float(toks[17]),
                sun_elevation_deg=float(toks[18]),
            ))

    if not records:
        raise ValueError(f"No valid ORBTATTD records parsed from {path} — refusing to summarize nothing.")

    elevations = np.array([r.sun_elevation_deg for r in records])
    incidences = 90.0 - elevations
    return SunAngleSummary(
        n_records=len(records),
        sun_elevation_start=records[0].sun_elevation_deg,
        sun_elevation_end=records[-1].sun_elevation_deg,
        sun_elevation_mean=float(elevations.mean()),
        sun_azimuth_start=records[0].sun_azimuth_deg,
        sun_azimuth_end=records[-1].sun_azimuth_deg,
        solar_incidence_mean=float(incidences.mean()),
        records=records,
    )
