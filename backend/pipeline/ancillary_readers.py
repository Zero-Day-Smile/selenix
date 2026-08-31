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
robust than trusting the literal byte-column widths from the spec doc.

Real, previously-undiscovered content in this same "ORBTATTD" record (found
this session): tokens 9-14 (0-indexed 9,10,11 / 12,13,14) -- between the
timestamp and the sun-angle fields -- are the real spacecraft position (X,Y,Z,
km) and velocity (Vx,Vy,Vz, km/s) at that instant. Never wired into
SunAngleRecord before because the module's original scope was sun-angle only.
Verified real, not guessed: position magnitude ~1849km and velocity magnitude
~1.62km/s both match real lunar orbital mechanics for a ~100-115km TMC-2
altitude, and -- decisively -- rotating this vector from J2000 into the
MOON_ME body-fixed frame via spiceypy at the record's own real UTC timestamp
and converting to lat/lon lands within ~0.02-0.06deg latitude and ~0.07-0.4deg
longitude of that same product's own real geometry.csv ground track, checked
across all 4 real Chandrayaan-2 products in this archive (see
backend/pipeline/orbital_geometry.py). So this position field is real J2000
(Earth/Moon-inertial) Chandrayaan-2 spacecraft position, not a coincidental
lookalike. Position/velocity are optional on SunAngleRecord (None when a line
doesn't have enough tokens) so nothing about the existing sun-angle-only
callers changes."""
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
    # Real spacecraft position (km, J2000 frame) / velocity (km/s) at this
    # record's exact timestamp -- see module docstring. None when the line
    # didn't carry enough tokens to safely parse (never guessed/interpolated).
    position_j2000_km: tuple[float, float, float] | None = None
    velocity_j2000_km_s: tuple[float, float, float] | None = None

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
            # Position/velocity tokens (indices 9-14) are present in every
            # real record observed so far, but parsed defensively -- if a
            # line is short or a token isn't numeric, leave both None rather
            # than fail the whole record (sun-angle fields, this reader's
            # original purpose, don't depend on them).
            position = velocity = None
            try:
                position = (float(toks[9]), float(toks[10]), float(toks[11]))
                velocity = (float(toks[12]), float(toks[13]), float(toks[14]))
            except (IndexError, ValueError):
                pass
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
                position_j2000_km=position,
                velocity_j2000_km_s=velocity,
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
