# Lunar Image Correspondence — Chandrayaan-2 ↔ LRO NAC

ISRO PS: multi-modal, sun-angle- and scale-invariant image correspondence using
Chandrayaan-2 optical images (OHRC/TMC-2/IIRS) and LRO NAC reference imagery.

See [TASKS.md](TASKS.md) for the full task breakdown and current status per tier.

## What's implemented

**Backend** (`backend/`, Python 3.14, FastAPI):
- Generic ingestion for PNG/JPG/TIFF (incl. multi-band cubes), **and real PDS3/PDS4 products**:
  LRO NAC (PDS3, attached or detached label, via `pvl`) and Chandrayaan-2 OHRC/TMC-2/IIRS (PDS4,
  via `pds4_tools`) — see "Real data ingestion" below. No hardcoded dataset path.
- Preprocessing: percentile contrast stretch, CLAHE illumination normalization, explicit multi-scale
  leveling (downsamples the finer image toward the coarser one's apparent resolution before matching,
  using a logged numeric scale-factor estimate) — this is a real matching-quality stage, not just
  a pyramid data structure sitting unused (see "Real data ingestion" for how that was caught)
- Classical matching: SIFT + FLANN, mutual-NN + Lowe's ratio test
- Deep matching: LoFTR via kornia (optional — falls back cleanly to classical if torch/kornia aren't installed)
- Auto mode: runs both, picks whichever gets the higher post-RANSAC inlier ratio
- Geometric verification: MAGSAC++ (`cv2.USAC_MAGSAC`, falls back to RANSAC if unsupported)
- Uniform spatial distribution enforcement (grid/quadrant capping) + a real uniformity score
- Sub-pixel refinement: phase correlation in a common (homography-warped) frame — verified to give a genuine ~85-93% RMSE reduction on test pairs, not a cosmetic no-op
- Registration: global homography + piecewise-affine + thin-plate-spline warps (all computed, saved, compared)
- Metrics: RMSE, inlier count/ratio, uniformity score, scale factor — all persisted to `metrics.json`
- Self-monitoring "memory": every run written to SQLite, real running per-sensor mean/std baseline, z-score anomaly flagging
- Per-image feature cache (keyed by file hash + preprocessing) so repeat runs don't recompute SIFT from scratch

**Frontend** (`frontend/`, React 19 + Vite + Tailwind v4): dark instrument-panel UI with 7 screens —
Upload & Configure, Results/Alignment (checkerboard blend, sub-pixel zoom inspector with pixel grid,
viridis difference heatmap), Match Points (confidence-gradient scatter + coverage heatmap), Metrics
Dashboard (classical-vs-deep table, global-vs-piecewise comparison, JSON/CSV export), Hard-Case panel,
Multi-Sensor Proof table, Registration History with RMSE trend chart.

## Real data ingestion

**Formats implemented, confirmed against real documentation before any code was written:**

- **Chandrayaan-2 OHRC/TMC-2/IIRS**: PDS4 since Dec 2020 — binary `.img` + XML label
  (`Product_Observational` → `File_Area_Observational` → `Array_2D_Image`/`Array_3D_Spectrum`).
  ISRO's Local Data Dictionary (`ch2_ingest_ldd_ISDA_1300.xsd`) extends the standard PDS4 IMG
  schema rather than replacing it, so `pds4_tools` reads it generically.
  ([PDS4 archive announcement](https://ui.adsabs.harvard.edu/abs/2022LPICo2678.1016P/abstract),
  [LDD paper](https://www.hou.usra.edu/meetings/lpsc2023/pdf/1041.pdf),
  [OHRC user guide](https://ia801806.us.archive.org/29/items/chandrayaan-2-high-resolution-images-of-the-moon/OtherDownloads/OHRC/ch2_ohrc_data_products_user_guide_hocr.html))
- **LRO NAC**: classic PDS3 with an *attached* label (a direct LROC `.IMG` download) — 8-bit
  unsigned DN, already decompanded from 12-bit onboard before EDR release (no LOCO decompression
  needed for standard archive products). The same data has since also been republished PDS4-wrapped
  (detached XML label + the identical `.IMG`). Verified directly against a real product label
  (`M1100131076RE.xml`, LROLRC_0012): `Element_Array data_type=UnsignedByte`, `Axis_Array`
  Line=25600/Sample=5064, `offset=5064` bytes = `RECORD_BYTES × LABEL_RECORDS` for that product —
  both distribution forms are handled (`backend/pipeline/pds_readers.py`).

No ISIS3 dependency anywhere, as scoped.

**Format-parsing verification** (before any real data existed): both readers round-trip
**byte-exact** against hand-built, spec-compliant PDS3/PDS4 fixtures
(`backend/tests/make_pds_fixtures.py` + `backend/tests/fixtures/`) — a known deterministic pixel
pattern in, the identical array out, for PDS3-attached, PDS3-detached, and PDS4 forms. The full
pipeline was also run end-to-end through the real-format code path using synthetic terrain content
wrapped in real PDS4/PDS3 containers, confirming the integration wiring before any real mission
imagery was available.

### Real data is now in hand — both sides

**Chandrayaan-2 TMC-2**: the user authenticated to ISSDC's PRADAN portal themselves and provided a
session-scoped download script (an account-gated step this project cannot and should not automate).
Running it pulled a real 483MB calibrated TMC-2 product — real `.img`+`.xml` (147,741×4,000,
uint16), a real browse quicklook, a real per-pixel lat/lon geometry grid, and the real `.spm`
sun-angle file.

**LRO NAC**: downloaded directly from NASA's fully public PDS archive (no login needed) — first one
product used to verify the label format, then 81 more found via a real geospatial search (below).

**A real bug found reading the first NAC file**: its label claims signed 8-bit samples
(`SAMPLE_TYPE=LSB_INTEGER`), which is physically wrong for non-negative DN counts. Confirmed via
the same product's independently-issued PDS4 re-label (says `UnsignedByte`) and a visual check —
signed interpretation produces a washed-out image with a spurious black-pixel artifact at every
byte=128 crossing, unsigned produces a normal image with visible craters. Fixed in
`pds_readers._pds3_dtype`, and the same fix correctly fired again — unprompted — on a second,
unrelated real NAC product downloaded later, confirming it's a real archive-wide quirk.

**Pipeline results on real pixels** (self-pairs: real crop as reference, a controlled synthetic
rotation/illumination/noise perturbation as source — same real acquisition on both sides, *not* two
independently-acquired real images):

| real source | matcher | inlier ratio | RMSE pre→post | improvement |
|---|---|---|---|---|
| LRO NAC, real low-texture mare crop | classical SIFT | 98.2% | 0.76→0.20px | 74.2% |
| LRO NAC, same crop | deep LoFTR | 92.1% | 1.42→1.32px | 7.3% |
| Chandrayaan-2 TMC-2, rugged real terrain | classical SIFT | 99.76% | 0.27→0.04px | 83.5% |

**A real geospatial cross-sensor search, built and proven working**: parsed the TMC-2 product's real
lat/lon grid for its ground footprint, fetched real NAC footprint KML files from NASA's public ODE
service, and ran ODE's spatial-search API — found **81 real NAC frames genuinely overlapping this
one TMC-2 product**. Three real attempts to actually produce a cross-sensor match from these hit
three different honest, diagnosed obstacles (an overexposed frame with 7 keypoints; an aspect-ratio
crop mismatch from imprecise no-SPICE georeferencing; a 6-inlier fit that was visually confirmed
spurious rather than reported as a false success) — full detail and root-cause analysis in
[TASKS.md](TASKS.md) "Real Chandrayaan-2 + LRO NAC data". No clean two-real-sensor match yet; the
search infrastructure that would produce one is real and reusable.

The pipeline makes no sensor-specific assumptions beyond this: point `ingestion.load_image()` (or
the CLI, or the UI upload) at any real file.

## Running it

```bash
# Backend
python -m venv .venv
./.venv/Scripts/pip install -r backend/requirements.txt
./.venv/Scripts/python -m uvicorn backend.app.main:app --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev   # http://localhost:5173, proxies /api to :8000
```

CLI (no server needed):
```bash
./.venv/Scripts/python -m backend.pipeline.run_pipeline <src.png> <ref.png> --out backend/outputs/run1 --matcher auto --sensor ohrc
```

Generate a synthetic test pair:
```python
from backend.pipeline import synthetic
synthetic.generate_pair("backend/data/samples/pair1", rotation_deg=12, scale=1.35, sun_angle_deg=40, seed=1)
```

## Running on real PDS3/PDS4 data

CLI accepts real files directly — no conversion step:
```bash
# LRO NAC (attached-label .IMG downloaded directly from LROC)
./.venv/Scripts/python -m backend.pipeline.run_pipeline <ch2_product.xml> <nac_product.IMG> --out backend/outputs/real_run --sensor ohrc
```
Ingestion prints exactly what it parsed (format, shape, dtype, geometry, any missing-metadata
warnings) before matching starts — check that output before trusting the results.

Through the UI: select a single file for a plain image or attached-label PDS3 `.IMG`; for a
**detached-label** product (most PDS4 Chandrayaan-2 downloads, and some NAC re-releases),
multi-select the `.xml`/`.lbl` label together with its companion `.img`/`.IMG` in the same file
picker — both need to land together so the label's relative sibling-file reference resolves.

Regenerate/validate the PDS3/PDS4 parsers against fixtures:
```bash
./.venv/Scripts/python -m backend.tests.make_pds_fixtures
```

## Deep matcher (LoFTR) — real, not a stub

`torch` (CPU) + `kornia` are installed in this environment; `matching.py`'s `match_deep_loftr`
loads `kornia.feature.LoFTR(pretrained="outdoor")`, which downloads and runs the real pretrained
"outdoor" checkpoint (verified: real weights fetched and loaded, real matching run end-to-end —
see TASKS.md "LoFTR made real" for the numbers). If torch/kornia aren't installed in your
environment, the pipeline falls back to classical SIFT automatically, with no code changes needed:
```bash
./.venv/Scripts/pip install torch --index-url https://download.pytorch.org/whl/cpu
./.venv/Scripts/pip install kornia
```

## Illumination / sun-angle normalization

Two modes, both real (`backend/pipeline/preprocessing.py`), selectable via `--illum` (CLI) or the
UI dropdown:
- **`gradient`** (default) — removes the large-scale shading gradient a different sun
  azimuth/elevation causes, by subtracting a heavily-blurred copy of the image from itself before
  matching.
- **`clahe`** — local contrast equalization (the previous default).

Measured, not assumed, on synthetic test pairs: `gradient` beat `clahe` on every one tried,
including non-illumination-hard ones (94.7%→98.8% inlier ratio on a normal pair, 56.2%→72.7% on a
synthetic 6x scale-ratio pair, 88.4%→96.3% on a hard-illumination pair) — see TASKS.md for the full
table and the `both`-mode result (worse than `gradient` alone, and why).

## Known limitations / next steps

- Piecewise/TPS warps are computed and visually compared but the *quantitative* RMSE reported
  is the global-homography number (a true forward-projected piecewise RMSE needs per-triangle
  inverse mapping — not implemented; documented in `run_pipeline.py` rather than faked)
- Hard-case panel currently uses synthetic hard pairs (large illumination/scale/rotation deltas);
  swap in real curated pairs once available
- Frontend wasn't visually verified in an actual browser in this session (no browser/screenshot
  tool available here) — verified via build success + live API smoke tests through the Vite proxy
  (`/api/health`, `/api/run` file upload, `/api/hardcases/*/run` all confirmed working end-to-end)
- Sub-pixel refinement is skipped (not attempted) above a 2.5x local scale ratio between source and
  reference — a deliberate, verified-against-ground-truth decision (see "Real data ingestion"), not
  an oversight. RMSE at that ratio reflects the pre-refinement geometric fit only.
- No genuine two-real-sensor cross-match yet (confirmed real, not hypothetical — see "Real data is
  now in hand" above): the geospatial search that finds real overlapping TMC-2/NAC candidate pairs
  works (81 found for one real TMC-2 product), but this project's no-SPICE NAC georeferencing (a
  rough 4-corner bilinear estimate from a KML footprint, not per-pixel geolocation) isn't precise
  enough yet to reliably carve out tightly-corresponding crops from it. Concrete next step for
  whoever picks this up: either add real per-pixel NAC geolocation, or iterate through more of the
  81 candidates with the search infrastructure already in place.
- `IIRS` hyperspectral cube band-axis identification falls back to a smallest-axis heuristic if the
  PDS4 label's `Axis_Array` names don't clearly identify the band axis — a warning is logged when
  this happens (`pds_readers.py`), it doesn't fail silently.
