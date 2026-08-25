# TASKS — Lunar Image Correspondence (ISRO PS)

Legend: [ ] todo · [x] done · [~] in progress · (blocked: reason)

---

## Tier 1 — Expected (PS compliance floor)

- [x] T1.1 Project scaffolding (backend/ python package, frontend/ vite stub, data/samples)
- [x] T1.2 Synthetic test-pair generator (since real OHRC/TMC/IIRS + NAC files are not yet provided) — used to validate the pipeline end-to-end
- [x] T1.3 Data ingestion module: load arbitrary image (PNG/TIFF/JPG), grayscale conversion, generic loader that doesn't hardcode paths — extended (see "Real data ingestion" below) with real PDS3 (LRO NAC) and PDS4 (Chandrayaan-2 OHRC/TMC-2/IIRS) readers
- [x] T1.4 Preprocessing: contrast normalization (percentile stretch), resize/pyramid scaffold
- [x] T1.5 Classical feature matching: SIFT (fallback ORB) + FLANN/BFMatcher + Lowe's ratio test
- [x] T1.6 Geometric verification: RANSAC homography (cv2.findHomography)
- [x] T1.7 Warping: apply homography, produce registered image
- [x] T1.8 Metrics: RMSE (reprojection error on inliers), inlier count, inlier ratio, total matches
- [x] T1.9 Outputs: save registered image (PNG), match points (JSON/CSV), metrics report (JSON)
- [x] T1.10 CLI entrypoint (`python -m backend.pipeline.run_pipeline src ref`) — verified working end-to-end on synthetic pair

## Tier 2 — Standout

- [x] T2.1 Uniform match distribution — grid/quadrant-based inlier selection + uniformity score (std-dev of match density over NxN grid)
- [x] T2.2 Illumination normalization — CLAHE, **upgraded** with a large-scale shading-removal ("flat-fielding") stage that measurably beats CLAHE alone (see "Illumination normalization, measured" below); now the default
- [x] T2.3 Multi-scale pyramid handling with logged numeric estimated scale factor — was previously dead code (`build_pyramid` existed but was never called from the matching path); found and fixed while testing a realistic 6x scale ratio (see "Real data ingestion" below). `preprocessing.level_for_matching` now actually downsamples the finer image before feature detection.
- [x] T2.4 Hard-case test: synthetic pair with large simulated illumination delta + report honest (worse) metrics
- [x] T2.5 Classical/Deep/Auto matcher toggle scaffold (Auto picks by resulting inlier ratio) — Deep=LoFTR wired with graceful fallback if torch/kornia unavailable. **torch+kornia now actually installed and the real pretrained "outdoor" LoFTR checkpoint verified downloading and running** — deep matching is real end-to-end, not a stub (see "LoFTR made real" below).

## Tier 3 — Visual/engineering polish

- [x] T3.1 MAGSAC++ swap-in (cv2.USAC_MAGSAC) with RANSAC fallback if unsupported by installed OpenCV
- [x] T3.2 Piecewise/local homography (grid-cell) OR TPS warp, computed alongside global homography for comparison
- [x] T3.3 Sub-pixel refinement stage — phase_cross_correlation on patches around matches; before/after RMSE reported
- [x] T3.4 Self-monitoring "memory": SQLite store of every run, running per-sensor baseline (mean/std RMSE), anomaly flag
- [x] T3.5 Feature cache (avoid recompute per image, keyed by file hash + params)
- [x] T3.6 FastAPI backend wrapping pipeline (`/api/run`, `/api/history`, `/api/hardcases`)
- [x] T3.7 React (Vite) + Tailwind frontend — Upload & Configure screen
- [x] T3.8 Results/Alignment View — side-by-side + checkerboard blend overlay
- [x] T3.9 Match Points Panel — scatter + coverage heatmap + uniformity stat
- [x] T3.10 Metrics Dashboard — cards + classical/deep + global/piecewise comparison + export
- [ ] T3.11 Hard-Case / Robustness Panel — wired to backend hardcases endpoint (basic version shipped, needs curated real pairs)
- [x] T3.12 Multi-Sensor Proof Panel — aggregated table from history store
- [x] T3.13 Registration History ("Memory") Panel — log table + trend + click-to-reload

## Tier 4 — Wow factor (pick 2-3)

- [x] T4.1 Classical vs Deep comparison live in demo (toggle, side-by-side metrics)
- [x] T4.2 Sub-pixel accuracy visualization — zoomed overlay crop w/ pixel grid
- [ ] T4.3 Failure-mode transparency panel (deferred — covered partially by hard-case panel)
- [x] T4.4 Confidence/uncertainty color gradient on match scatter
- [ ] T4.5 One-click generic-across-sensors dashboard (deferred, overlaps T3.12)

## Real data ingestion (added this session)

- [x] R.1 PDS3 reader (`pds_readers.read_pds3`) — LRO NAC, attached label (single .IMG from a direct LROC download) and detached label (.LBL + companion .IMG referenced by filename), via `pvl`. No ISIS3 dependency.
- [x] R.2 PDS4 reader (`pds_readers.read_pds4`) — Chandrayaan-2 OHRC/TMC-2/IIRS (and PDS4-wrapped LRO NAC), via `pds4_tools`. Handles `Array_2D_Image` directly and `Array_3D_Spectrum`/3D cubes (IIRS) by locating the band axis from the label and averaging it, with an explicit warning logged if the band axis can't be identified by name (falls back to a smallest-axis heuristic rather than guessing silently).
- [x] R.3 Format auto-detection wired into `ingestion.load_image` (`.xml` → PDS4, `.img`/`.IMG` → PDS4 if a sibling `.xml` exists else PDS3 detached if a sibling `.lbl` exists else PDS3 attached, `.lbl` → PDS3) — the existing PNG/JPG/TIFF/synthetic path is untouched.
- [x] R.4 Byte-exact validation against spec-compliant fixtures (`backend/tests/make_pds_fixtures.py`, `backend/tests/fixtures/`) — PDS3 attached, PDS3 detached (external-file pointer form), and PDS4, each round-tripped through a known deterministic pixel pattern and asserted exact.
- [x] R.5 Full pipeline run end-to-end through the real ingestion code path (PDS4 source + PDS3-attached reference, wrapping the same synthetic terrain content used elsewhere) — all stages ran, including the new ingestion-warning logging.
- [x] R.6 Multi-scale pyramid actually wired into matching (was dead code before this session) — `preprocessing.level_for_matching` downsamples the higher-resolution image toward the coarser one's apparent resolution before feature detection, using the dimension-based scale estimate; matched keypoints are rescaled back to full resolution before geometric verification.
- [x] R.7 Sub-pixel refinement scale-ratio safety guard — refinement is skipped (not attempted) when the local homography scale ratio exceeds `max_scale_ratio` (2.5x default), because warping a much-coarser image up produces blur with no real sub-pixel signal; verified this eliminates the RMSE regression found at a realistic 6x ratio, and verified (against the synthetic generator's ground-truth homography, not just pipeline self-consistency) that the un-gated well-behaved case is unaffected.
- [x] R.8 FastAPI multi-file upload (`source`/`reference` now accept 1+ files each) — fixes a real bug where a single-file upload flow silently broke detached-label products (the uploaded label's relative sibling-file reference pointed at a file that was never uploaded). Files are saved into a per-request subdirectory preserving original filenames, not flattened+renamed. Frontend `UploadConfigure` updated to multi-select accordingly.
- [ ] R.9 GeoTIFF/rasterio path for ISSDC data — deferred: confirmed via ISSDC/PDS documentation that Chandrayaan-2 OHRC/TMC-2/IIRS products are PDS4 (.img + .xml), not GeoTIFF, so this wasn't needed; `ingestion.py`'s existing TIFF path stays available as a fallback if a GeoTIFF-format product ever shows up.
- [ ] R.10 No real mission pixel data was available to run any of this against — see "Real numbers, honestly" below for exactly what was and wasn't verified.

## Reference repos — what was actually used (this session)

Per the project brief's exact scoping (LoFTR=use directly, others=reference-only,
L2AMF-Net=optional/time-boxed, topcoderinc=never run):

- [x] **LoFTR (zju3dv/LoFTR)** — used directly, made real. `torch` (CPU) + `kornia` installed;
  `kornia.feature.LoFTR(pretrained="outdoor")` downloads and loads the real pretrained "outdoor"
  checkpoint (verified: 10.6s load, real weights fetched from the checkpoint mirror kornia's
  loader uses). Ran real deep matching end-to-end on a test pair: 4008 raw matches, 1866 inliers,
  46.6% inlier ratio, 86.5% RMSE improvement after refinement — not a fallback stub. Auto mode
  correctly compares this against classical SIFT per pair and picks the better one (verified:
  picked classical 98.8% vs deep 47% on the easy test pair, as expected since LoFTR is trained on
  real outdoor photos (MegaDepth) rather than tuned for this smooth synthetic crater texture —
  real mission imagery has more genuine texture and may favor LoFTR more; untested without real
  data). `torch`/`kornia` added to `requirements.txt` as an optional, documented install.
- [x] **ImageMatchingChallenge2022 (atfortes)** — reference-only, as scoped. Compared its
  match→geometric-verification→metrics structure against this pipeline's; no structural gap found
  worth adopting (this pipeline already does mutual-NN + ratio test + MAGSAC++ + uniform-selection
  + refinement + persisted metrics, which covers the same shape). Not cloned or depended on.
- [x] **astroclubiitk Inter-IIT-Tech-Meet-2023** — reference-only, as scoped (solves lunar
  super-resolution, a different problem). Its real-data-handling utilities are superseded here by
  the PDS3/PDS4 readers built this session directly against ISSDC/PDS documentation, which is more
  directly applicable to OHRC/TMC-2/IIRS/NAC than a super-resolution project's preprocessing.
- [ ] **L2AMF-Net (zwh0527/lunar-image-patch-matching)** — not attempted this session. Time-boxed
  at 3 hours max per the brief, and with the illumination/scale work above already delivering
  measured real gains (gradient-removal preprocessing, the multi-scale leveling fix, the LoFTR
  install), spending the time-box here wasn't the better bet given it's undocumented research code
  with no pretrained weights or license file — reassess if time remains after Tier 4 polish.
- [x] **topcoderinc/lunar-imaging** — not run, per instructions (ISIS3 dependency, Apollo-era
  metadata, ~GBs of calibration data). Not consulted further this session.

## Illumination normalization, measured (this session)

CLAHE alone was the only illumination-normalization option. Added
`preprocessing.remove_illumination_gradient` — a large-scale shading-removal ("flat-fielding")
step: subtract a heavily-blurred copy of the image from itself before matching, targeting the
*low-frequency* brightness gradient a different sun azimuth/elevation causes (which side of a
crater is lit), distinct from CLAHE's *local contrast* equalization. Measured on real inlier-ratio
outcomes, not assumed:

All four rows below are **synthetic test pairs** (`synthetic.generate_pair`), not real
Chandrayaan-2/LRO imagery — flagged explicitly per this project's honesty discipline, since a bare
table risks reading as a real-data result to anyone skimming it:

| test pair (synthetic) | clahe | gradient | both |
|---|---|---|---|
| pair1 (normal, 1.35x scale, 40° illum) | 94.7% | **98.8%** | — |
| pair_bigscale (synthetic 6x scale-ratio case) | 56.2% | **72.7%** | — |
| pair_hard_illum (75° illum delta) | 88.4% | **96.3%** | 93.6% |
| pair_extreme_illum (110° illum delta) | 91.4% | **94.7%** | 92.0% |

`gradient` alone won every single test, including the *non*-illumination-hard cases — so it's now
the default (`illum_mode="gradient"` in `run_pipeline.run_registration`), not `clahe`. `both`
(gradient removal feeding into CLAHE) consistently underperformed plain `gradient` — plausibly
because CLAHE's tile-boundary equalization reintroduces some local contrast noise once the
low-frequency shading it used to help cancel is already gone; not investigated further since
`gradient` alone is already the best and cheapest option. All four modes (`none`/`clahe`/`gradient`/
`both`) remain selectable via `--illum` (CLI) or the illumination dropdown (UI) for direct
comparison in a demo.

## Explicitly out of scope this session
- ISIS3 / topcoderinc lunar-imaging execution (per instructions, never attempt)

## Verification performed this session
- Full pipeline run end-to-end via CLI on 4 synthetic pairs (3 sensor types + 1 deliberately hard case) — all produced real, sane metrics
- Sub-pixel refinement bug caught and fixed: initial patch-based phase correlation compared raw src/ref patches directly, which is invalid when they differ by ~1.35x scale + 12° rotation (phase correlation only detects pure translation). Fixed by warping source into reference frame with the initial homography first, so the residual really is a small translation. Verified real 85-93% RMSE reduction across all test pairs (not just non-negative — measured before/after on every run).
- Feature cache verified populated after first run, reused on second identical run (same RMSE reproduced)
- Memory/baseline/anomaly system verified with real SQLite rows — baseline requires 2+ prior same-sensor runs before std-dev is computable (by design, not hardcoded)
- FastAPI backend smoke-tested directly (`/api/health`, `/api/run` multipart upload, `/api/hardcases`, `/api/hardcases/{id}/run`, `/api/sensor_summary`)
- Frontend (`npm run build`) compiles clean; dev server verified end-to-end through its `/api` proxy — multipart upload, JSON responses, and served output images all confirmed reachable exactly as the React components consume them
- Frontend was NOT visually verified in an actual rendered browser in this session (no browser/screenshot tool available in this environment) — this is the one unverified layer; open http://localhost:5173 to confirm visually before a demo

## Real numbers, honestly (this session)

**No real Chandrayaan-2 or LRO NAC pixel data was available in this environment** — confirmed
with the user before writing any loader code (files aren't downloaded yet). What was actually
built and verified, precisely:

1. **Format parsing correctness** — verified byte-exact, not assumed. The PDS3 and PDS4 readers
   were checked against real format documentation (ISSDC/PDS4 archive papers, and a real LRO NAC
   product label fetched live: `M1100131076RE.xml`, LROLRC_0012 — `Element_Array
   data_type=UnsignedByte`, `Axis_Array` Line=25600/Sample=5064, `offset=5064` bytes matching
   `RECORD_BYTES × LABEL_RECORDS` for that product). Then validated against hand-built,
   spec-compliant fixtures with a known deterministic pixel pattern, asserting an **exact** pixel
   round-trip for PDS3-attached, PDS3-detached (external-file pointer), and PDS4 forms.
2. **Full-pipeline integration through the real format code path** — verified by wrapping the
   same synthetic terrain content used elsewhere (crater-like texture, not real mission data) in
   real PDS3-attached and PDS4 containers and running it through every pipeline stage end-to-end,
   via both the CLI and the FastAPI upload endpoint. RMSE 0.081px, 90.4% refinement improvement,
   inlier ratio 0.958 — consistent with the equivalent PNG-based run, confirming the new ingestion
   code integrates correctly rather than just parsing in isolation.
3. **A real, previously-latent bug found and fixed by this exercise**: at a realistic scale ratio
   (tested at 6x — plausible for real OHRC-vs-TMC-2/IIRS/NAC pairs, since OHRC is ~30cm/px and
   TMC-2/IIRS/NAC are meters-to-tens-of-meters/px), sub-pixel refinement was *regressing* RMSE
   (1.65px → 4.58px) because warping a much-coarser image up produces blur with no real sub-pixel
   signal in it. Fixed with a scale-ratio guard that skips refinement above 2.5x local scale,
   verified against the synthetic generator's ground-truth homography (not just the pipeline's
   own self-consistency) that this doesn't cost accuracy in the well-behaved case. The explicit
   multi-scale pyramid stage (`build_pyramid`) was also found to be dead code — defined but never
   called from the matching path — and is now actually wired in (`preprocessing.level_for_matching`),
   improving inlier ratio at 6x from 55.9% (unleveled) to 60.75%.
4. **Superseded — real data now obtained, see "Real Chandrayaan-2 + LRO NAC data" below.** (Left
   this point in place rather than deleted, so the "we had none" → "we have real pixels" arc is
   visible in the history.)
5. **Confirmed, not just anticipated**: see finding 3 in the section below — the footprint-overlap
   problem this point originally flagged as a hypothetical is real and was hit directly.

## Real Chandrayaan-2 + LRO NAC data (obtained and tested this session, part 2)

Both real datasets are now in hand — not simulated, not format-wrapped synthetic content.

**Chandrayaan-2 TMC-2**: the user logged into ISSDC's PRADAN portal themselves (an account-gated
step this project cannot and should not automate) and handed over a session-authenticated download
script. Ran it as-is: **483MB real TMC-2 calibrated product**
(`ch2_tmc_ncn_20260813T1023298745_d_img_d18.zip`) — real `.img`+`.xml` (147,741×4,000, uint16,
DN range 0-1015), a real browse quicklook (confirms genuine orbital strip imagery, visible craters),
a real per-pixel lat/lon geometry grid CSV, and the real `.spm` sun-angle ancillary file.

**LRO NAC**: downloaded directly and anonymously from NASA's open PDS archive (no login needed) —
first `M1100131076RE.IMG` (124MB, the same product already used for label-format verification
earlier this session), later three more via a proper spatial search (see below).

**Real bug found and fixed while reading the first NAC file**: its label says `SAMPLE_TYPE=
LSB_INTEGER` (signed 8-bit), but the data is physically DN counts (non-negative). Confirmed two
ways before touching code: cross-referenced the same product's independently-issued PDS4 re-label
(says `UnsignedByte`), and visually compared crops — signed interpretation produces a washed-out
image with a spurious black-pixel artifact at every byte=128 crossing; unsigned produces a normal
image with visible craters. Fixed in `pds_readers._pds3_dtype` (8-bit signed image samples are now
read as unsigned, with a loud warning explaining why) — and this same fix correctly fired again,
unprompted, on a second, entirely different real NAC product downloaded later, confirming it's a
real archive-wide quirk and not a one-off.

**Real sun-angle reader** (`ancillary_readers.py`, new): parses the `.spm` ASCII format from the
ISSDC `miscellaneous/readme.txt` spec. Real-file field layout differs slightly from the spec's
literal byte columns (fields run together, e.g. `block_len`+`year` as `2492026`) — handled by
whitespace-tokenizing rather than trusting the documented byte offsets. Validated two ways before
trusting it: satellite position (~1849km from Moon center) and velocity (~1.62km/s) both match real
lunar orbital mechanics, and `phase_angle ≈ 90 − sun_elevation` held almost exactly (35.52° vs
90−54.48°=35.52°) on real records. Parsed real solar geometry for the TMC-2 product: sun elevation
54.5°→45.3° drifting across the 8-minute strip, mean solar incidence angle 39.2°.

**Real-pixel pipeline validation (self-pairs — same real acquisition, controlled synthetic
rotation/illumination/noise perturbation, NOT two independently-acquired real images)**:

| real source | inlier ratio | RMSE pre→post | improvement |
|---|---|---|---|
| LRO NAC crop (classical SIFT), genuinely low-texture mare (std≈6.6) | 98.2% | 0.76→0.20px | 74.2% |
| LRO NAC crop (deep LoFTR), same crop | 92.1% | 1.42→1.32px | 7.3% (much less than SIFT here — LoFTR's real-data keypoint localization on this terrain doesn't leave as much for refinement to improve, worth further investigation later, not overclaimed here) |
| Chandrayaan-2 TMC-2 crop (classical SIFT), rugged terrain near a terminator (std≈43.6) | 99.76% | 0.27→0.04px | 83.5% |

Both self-pairs auto-mode-compared classical vs. real LoFTR and behaved sensibly (classical won on
the richer TMC-2 crop, consistent with earlier synthetic findings).

**Real geospatial cross-sensor search infrastructure — built and proven working, even though a
clean match wasn't produced this session**: parsed the TMC-2 product's real per-pixel lat/lon grid
to get a ground footprint, fetched a candidate NAC product's real KML footprint (from NASA's public
ODE service), and queried ODE's spatial-search REST API (`query=product&pt=EDRNAC4&westernlon=...`)
— found **81 real LRO NAC frames genuinely overlapping this one TMC-2 product's footprint**. This
is the correct way to do this (spatial bounding-box query), discovered after an earlier, abandoned
attempt to guess NAC product IDs from an unrelated dataset-prep CSV failed.

**Three honest, real cross-sensor match attempts — none produced a valid match, each for a
different, diagnosed, real reason (not a pipeline bug in any case)**:
1. `M1135639157RE` — severely overexposed real NAC frame: 7 SIFT keypoints detected (vs 4190 in
   the TMC-2 crop). Feature-starved, not a matching failure.
2. `M1248636236LE` — good texture (5581 keypoints) but the crop pairing was geometrically wrong:
   this project deliberately avoids ISIS3/SPICE, so NAC georeferencing here is a rough 4-corner
   bilinear estimate from the KML footprint, not per-pixel geolocation. That imprecision produced
   a badly aspect-ratio-mismatched crop pair (TMC crop ~3.3:1, NAC frame ~12.5:1) — 3 raw matches,
   one short of the 4 needed for a homography.
3. `M1202741770LE` — improved crop precision (aspect ratios ~2:1 vs ~3.4:1, closer) got 5 matches
   at the standard Lowe's ratio, 45 at a loosened one, and MAGSAC++ found *a* homography with 6
   inliers (13% inlier ratio). Rather than report this as a success because a metric looked
   non-zero, the actual warp was inspected visually — it showed thin streaky artifacts radiating
   from a point, the textbook signature of a degenerate/overfit projective transform from too few
   points, not a real registration. Correctly identified as spurious and not reported as a match.

**Root cause, stated plainly**: this project's real NAC-side georeferencing (4-corner bilinear from
a KML footprint) is too imprecise to reliably carve out tightly-corresponding real crops without
either (a) real per-pixel NAC geolocation (needs SPICE/ISIS3, explicitly out of scope), or (b) a lot
more trial-and-error across the 81 candidates than this session's time budget allowed. The search
infrastructure (footprint parsing + ODE spatial query) is real, working, and reusable for anyone
who picks this up next; producing a clean cross-sensor match from it is the concrete next step, not
a redesign.

## Real cross-sensor matching — broad sweep result (this session, part 3)

Expanded from 1 candidate/image to 5 confirmed-real-overlap candidates per Chandrayaan-2 image
(20 new real NAC downloads via the same KML-footprint-verification method — every candidate here
is confirmed to genuinely share ground with its Chandrayaan-2 image, not just a coarse bbox match).
Ran classical SIFT matching against all 24 real pairs (4 original + 20 new):

- **22 of 24**: 0-3 raw SIFT matches — nowhere near the 4 needed for even a degenerate homography.
- **2 of 24** (`M1349544899LE`/`RE` — the Left/Right halves of the same acquisition): a homography
  was found (8-9 matches, 50-67% "inlier ratio"), but with only 8-9 total points this is
  statistically meaningless — RANSAC trivially finds a high inlier fraction among that few points
  by chance. Not investigated further as a real candidate; the sample size alone disqualifies it.

**This is now a well-established negative result, not bad luck on crop selection**: across 24
independently real, geographically-confirmed overlapping pairs spanning 4 different real locations
on the Moon, classical SIFT essentially never finds enough shared feature correspondence between
Chandrayaan-2 TMC-2 (calibrated radiance) and LRO NAC (raw instrument DN) to establish a trustworthy
match. Also tried LoFTR (deep matcher) on the two strongest-overlap pairs specifically — same
failure pattern (see below), so this isn't a classical-matcher-specific limitation either.

Two real bugs found and fixed while running this sweep (both real, both affect the actual pipeline,
not just this diagnostic script):
- `ingestion.to_uint8()` used `np.percentile` on the full array, which triggers an internal
  sort/copy — OOM'd for real on a 244,000-line Chandrayaan-2 image (~7.3GB for the float64 copy
  alone). Fixed by estimating percentiles from a bounded random subsample (statistically
  sufficient for a 1st/99th stretch) while still applying the stretch to the full-resolution array.
- `matching.match_deep_loftr()` had no size cap — LoFTR's coarse-matching stage computes a dense
  similarity matrix whose memory cost scales with the *product* of both images' patch counts, and
  it tried to allocate 169GB on a real ~8000x1700 crop. Fixed with a `max_side=840` resize (LoFTR's
  typical usage size) before inference, with keypoints rescaled back to the caller's original
  coordinate space — transparent to callers, verified no regression on normal-sized pairs.

**What this means for the project**: the pipeline itself is proven solid (self-pair validation at
98-99.76% on 2 different real sensors, correct rejection of every spurious match via visual
verification rather than trusting metrics blindly, 24 real candidates now catalogued and reusable).
What's not yet solved is real cross-sensor correspondence between these two specific instruments at
the resolutions/preprocessing tried so far. Concrete next directions for whoever continues this:
(a) test whether TMC-2's *raw* (uncalibrated) product type matches NAC's raw DN better than the
calibrated product type used throughout this session — a calibrated-vs-raw radiometric mismatch is
the leading hypothesis and hasn't been tested; (b) try much smaller, more textured sub-crops within
each confirmed-overlap region rather than large crops that may dilute the actually-overlapping area.

## Notes / deviations
- LoFTR (deep matcher) requires torch+kornia (~GBs). Wired behind a try/import with automatic fallback to classical if unavailable, so the system never breaks if the ML stack isn't installed. Documented in README with install instructions to enable it.
