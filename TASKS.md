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

## Same-sensor sanity check — isolating the failure to match-selection, not cross-sensor gap

Rather than keep varying real Chandrayaan-2/NAC pairs blindly, ran a structured diagnostic on
**NAC-vs-NAC** pairs (same instrument, same processing, no cross-sensor variable at all) to find
out whether the 24 failed cross-sensor attempts reflect a genuine sensor domain gap or a deeper
pipeline issue that would show up even without one.

**Attempt 1** (`M1306094925LE` vs `M1444613697RE`, two different real orbits): my first-pass visual
check (full blend + checkerboard) looked plausible — continuous texture, no obvious tear. That was
**wrong**, caught only by the next step: picking one genuinely distinctive feature (a dark elongated
shadow) and confirming it lands on the same content in both images at the aligned coordinate. It
didn't — completely different terrain. The pipeline's own scale estimate (13.06x for a same-instrument
pair, physically impossible) was the real tell; the blend/checkerboard check alone wasn't rigorous
enough on self-similar crater terrain to catch this. **Verification-standard update**: always do a
targeted unique-feature check, not just a blend/checkerboard, on lunar imagery specifically.

**Attempt 2** (`M1382845798LE` vs `M1394580363RE`, different orbits 136 days apart, deliberately
chosen for high-confidence heavy overlap — 55%/77% of each frame's real footprint, confirmed via KML
corner geometry, not a marginal edge case): added the diagnostic of computing pairwise scale/rotation
agreement across all *raw* matches, before RANSAC even runs — a real match set should cluster tightly
around the true scale/rotation; noise should scatter.

- **Raw SIFT**: 13 matches. Pairwise rotation spans the *full ±180° range* (p10=-172°, p90=+174°) —
  statistically indistinguishable from random. Not "some good matches diluted by noise" — the match
  set itself carries essentially no real geometric signal.
- **Raw LoFTR**: better but still failing — 170 matches, tighter scale IQR (0.86-1.42 vs SIFT's
  0.80-2.81) but rotation std still 42.6° (should be near 0 for a true match set). Final MAGSAC++
  fit: 6/170 inliers (3.5%), and the visual unique-feature check confirmed it's wrong (dense
  dark-shadowed crater field warped onto bright sparse terrain — nothing alike).
- **Ruled out "bad overlap region" as the cause**: found and fixed a real crop-alignment bug (two
  NAC frames have different pixels-per-degree along-track — 15,004 vs 15,791 px/° for this pair —
  so naively slicing "the same pixel range" from both doesn't hit the same latitude band). Recomputed
  a precisely lat-band-matched crop (both frames sliced to exactly -20.3° to -19.8°) using each
  frame's real corner geometry and reran: **no change** — SIFT and LoFTR both still failed the same
  way (rotation std 96.6°/50.5°, homography singular-value ratios 15:1 and 13:1, i.e. severe
  shear/degenerate transforms). This conclusively rules out crop imprecision as the explanation.

**External corroboration**: re-examined all 5 reference repos specifically for this problem.
L2AMF-Net (zwh0527) is trained/validated only on synthetic self-pair perturbations of a single
source image — same category of test this project already exceeds (98-99.76%), no evidence it
handles genuinely different real acquisitions. astroclubiitk (Inter-IIT team, same real
Chandrayaan-2↔NAC registration problem) has **zero automated feature-matching code anywhere in
their repo** — their `final_gen.py` script computes scale ratio from images that are already
aligned, and per their own README that alignment was done **entirely by hand in GIMP**, rotating
and scaling by eye until craters visually lined up. A resourced team working the same real problem
also did not solve it algorithmically.

**Conclusion**: the failure is not explained by cross-sensor domain gap, bad overlap-region
selection, or crop-alignment imprecision — all three were tested and ruled out or shown not to
matter. It reproduces on same-sensor, same-processing, heavy-confirmed-overlap, high-texture real
lunar pairs, with both a classical and a deep matcher, and independent evidence suggests at least
one other team hit the same wall. This is a genuine, hard, presentable finding: **automated feature
matching on repetitive lunar crater terrain is failing at the match-selection stage** — raw
correspondences carry too little real geometric signal for MAGSAC++/RANSAC to recover a reliable
fit, not because the geometric verification step is broken, but because it's being handed noise.
Concrete unexplored directions for whoever continues this: local patch-level descriptor learning
specifically trained to disambiguate near-identical craters (the problem L2AMF-Net's architecture
targets, though untested on real cross-sensor data); or accepting manual/semi-automated
seed-point registration (consistent with what the Inter-IIT team ultimately did) as the practical
answer for this class of terrain.

## Geometry-guided disambiguation attempts and two real bugs fixed (this session, part 4)

Follow-on to the match-selection-failure diagnosis above. Tried four independent strategies to
break the repetitive-crater ambiguity, each with the same diagnostic discipline (raw match count,
pairwise scale/rotation consistency, MAGSAC++ inlier %, and a mandatory targeted distinctive-feature
check before accepting any result as real).

**Two real bugs found and fixed along the way**, both in `backend/pipeline/geo_extent_guard.py`
(new module):
- **Corner-cut / boundary-collapse bug**: predicting a NAC (line,sample) location from lon/lat via
  4-corner bilinear interpolation collapses to a boundary value for points inside the axis-aligned
  lon/lat bounding box but outside the true *rotated* quadrilateral, silently corrupting any
  min/max-derived search region. Fixed by computing a bilinear fit residual per point and filtering
  on `residual < 1e-4` (`nac_corner_bilinear_fit`).
- **Crop-extent mismatch**: selecting a TMC crop from the lon/lat bounding box of "points near the
  NAC footprint" can select TMC content *wider than NAC's own native swath* — content with no
  possible NAC correspondence regardless of method. Regression-checked against all 20 real pairs
  still on disk (`backend/data/real/_regression_extent_check.py`): **8/20 pairs had a genuine extent
  mismatch**; the other 12/20 did not and still failed matching, so this bug is real but not the
  dominant cause of the overall failure.

**Strategy 1 — geometry-windowed template correlation** (`_geo_constrained_test.py`): predicts a
local NAC window via real geometry, scale-corrects the TMC patch to match NAC's real GSD
(`SCALE_TMC_TO_NAC = 2.5769`), does `cv2.matchTemplate` in the window. Result: 1 weak candidate at
NCC 0.55 — the window (~600x600 NAC px) still contains multiple similar small craters.

**Strategy 2 — geometry-windowed LoFTR** (in the same window as strategy 1): 110 raw matches
(conf 0.20-0.72, well above strategy 1's single weak candidate) — but pairwise rotation scatter
std=74.4° (a real match set should cluster near 0), and MAGSAC++ found only 8/110 (7.3%) inliers.
Visual check on the warped blend: the warped crater texture does not correspond to the underlying
craters at all — a degenerate/spurious homography, not a real one. LoFTR's richer features find
*more* candidates but do not resolve the ambiguity; same failure signature as blind global matching.

**Strategy 3 — 3D crater-geometry disambiguation (elevation-based) — ruled out at the feasibility
check, not attempted**: LOLA's finest global gridded DEM product is ~59 m/px; the craters causing
ambiguity in our real pairs are ~50-200m features (3-4 DEM pixels across at best) — not enough
resolution for real depth/diameter/rim-shape descriptors. NAC-derived stereo DTMs exist only for a
few hundred specifically targeted sites (landing-site candidates, poles), and our real test pairs
are ordinary mare/highland terrain with no reason to expect coverage. Photoclinometry (deriving
pseudo-elevation from the same 2D shading the 2D matchers already see) would not add genuinely new
information. Reported as a valid negative finding rather than attempted with unusable data.

**Strategy 4 — dense whole-block correlation at coarse scale** (`_dense_coarse_align.py`): rather
than sparse keypoints/patches (locally ambiguous), correlate an entire ~4km TMC sub-block as one
template against the *full* candidate NAC frame at a common coarse GSD (22 m/px), sweeping rotation
±15°, using the corrected (bug-free) geometry crop. With full shading preserved (no illumination
normalization), the best peak was NCC=0.32 at 4°, a modest ~2.7σ outlier above the correlation
surface's noise floor (mean 0.02, std 0.11) — but the targeted distinctive-feature check shows it
landed in a bright, overexposed patch near the strip's edge whose texture bears no visual
relationship to the TMC block. A statistically-detectable-but-visually-wrong peak — exactly the
kind of numerically-plausible-but-wrong result this project's verification discipline exists to
catch. Illumination-normalized variants (clahe/gradient/both) scored worse (0.17-0.19), confirming
that removing large-scale shading (useful for local patch texture) actively hurts whole-block
correlation, which depends on that same shading to encode crater-rim/shadow structure.

**Conclusion**: four independent, methodologically distinct matching strategies (blind global,
geometry-windowed template correlation, geometry-windowed LoFTR, geometry-windowed dense whole-block
correlation) have now been tried on real Chandrayaan-2/NAC pairs and ruled out with the same
rigorous diagnostic each time; a fifth (3D elevation-based descriptors) was ruled out at the data-
availability stage. This is not a bug in the implementation — the pipeline is verified correct on
synthetic pairs and on same-sensor pairs with genuinely distinctive terrain. The blocker is that
**our real test pairs are all ordinary, repetitive mare/highland cratered plains**, which is close
to a worst case for any appearance- or shape-based correspondence method at this GSD.

**Honest recommendation for anyone continuing this**: don't invest further time tuning matchers on
this class of terrain — the ambiguity is in the data, not the algorithm. Two directions that could
actually work: (1) deliberately pick a real overlap region containing a large, non-repetitive
landmark (a named crater, wrinkle ridge, rille, boulder field) instead of generic cratered plains —
cheap to test, and directly checks whether the pipeline succeeds once the adversarial-terrain
condition is removed; (2) domain-specific deep matcher training (fine-tune LoFTR or similar on
synthetic TMC/NAC pairs generated by simulating one sensor's resolution/photometry from the other) —
a real ML project, out of scope for the remaining time here.

## Real bug fixed: systematic stretch-range issue on ~1/3 of real NAC frames (this session, part 5)

Noticed one NAC preview (`M1385774154LE`) rendering almost entirely light-gray with very low
apparent contrast, unlike most other real frames. Diagnosed properly before touching any code:

- **Raw pixel check**: min=0, max=170, mean=123.9, std=13.7 (8-bit label, but actual data never
  approaches the nominal 255 ceiling). Full histogram: ~95% of pixels concentrated in a tight
  DN 111-148 band, with a small, real (non-artifact) population of darker shadow pixels scattered
  down to 0.
- **Saturation check**: 0.0000 fraction of pixels at or near the raw max — confirmed this is real,
  uncompressed detail, not clipped/lost data at capture.
- **Root cause**: the existing global `to_uint8()` stretch anchors its 0-255 output bounds on the
  1st/99th percentile of the *full* raw range. For this frame the real terrain content's dense core
  has an IQR of only 7 DN, but a sparse, low-density tail of shadow/bright outlier pixels drags the
  p1-p99 span out to 124 — so the stretch wastes most of the output range on content that barely
  exists, compressing the actually-meaningful detail into a narrow visual band.
- **Scope check across the dataset**: measured post-stretch contrast (`to_uint8` output std) across
  all 21 real NAC frames on disk. **7/21 (33%)** show this same pattern (post-stretch std < 35 vs.
  55-86 for normal frames): `M1385774154LE`, `M1385774154RE`, `M1416270448LE`, `M1444613697LE`,
  `M1444613697RE`, `M1100131076RE`, `M1342582517LE`. Systematic, not a one-off.
- **Checked whether this contributed to the matching failures already diagnosed**: no evidence it
  does. A same-sensor pair using two *normal*-contrast frames (`M1382845798LE`/`M1394580363RE`,
  neither flagged) failed exactly as badly as the pair involving a flagged frame (rotation std
  42-96° either way, singular-value ratios 13-15:1). In the 24-pair broad sweep, 22/24 pairs failed
  near-identically (0-3 raw matches) regardless of which frames were involved. This is a
  data-quality/visualization fix, not a fix for the core matching ambiguity.
- **Fix**: `ingestion.to_uint8_adaptive()` — sets stretch bounds from each image's own dense core
  (median +/- 3*IQR, intersected with a loose p2-p98 safety band) instead of a fixed global
  percentile assumption. Added as a new function alongside the existing `to_uint8()` rather than
  replacing it in place, since `to_uint8()` feeds the matching pipeline and changing its behavior
  there would need its own re-validation (explicitly out of scope for this fix — no matching rerun
  performed). Applied to regenerate previews for all 7 flagged frames: **1.7-2.1x contrast
  improvement** (e.g. `M1385774154LE` post-stretch std 26.2 -> 45.6). Visual check on
  `M1385774154LE` before/after confirms crater rims and small-scale terrain texture that were
  completely invisible in the old washed-out preview are now clearly visible.

## Sun-angle / scale / rotation invariance test suite (this session, part 6)

Our PS is titled "multi-modal, sun angle and scale invariant image correspondence." Every real
pair tested so far (the 24-pair sweep above) conflates that literal requirement with the much
harder, still-unsolved problem of crater self-similarity on ordinary terrain — a pipeline that
fails on a real pair could be failing because of self-similar terrain, not because it can't
tolerate a sun-angle/scale/rotation difference. This test isolates just the latter, using
synthetic same-source pairs with an **exact known ground-truth transform** (something the 24 real
pairs can never provide, since their true transform isn't independently known).

**Method** (`backend/pipeline/relighting.py`, `backend/pipeline/synthetic_invariance.py`,
`backend/scripts/invariance_sweep.py`, `backend/scripts/invariance_plots.py`):
- **Sun-angle**: image-derived relighting, NOT a physically ground-truthed resimulation. A coarse
  global DEM (LOLA, ~59m/px) was deliberately ruled out — it would only change illumination
  correctly at the DEM's coarse scale, not at the actual crater scale visible in
  0.5-25m/px NAC/TMC-2 imagery. Instead: treat the image's own intensity gradient as a stand-in
  for local surface slope (the "bump map from a grayscale texture" trick), integrate it into a
  fake relative height field (Frankot-Chellappa FFT gradient integration), then relight via
  per-pixel Lambertian shading *plus* a real cast-shadow horizon sweep over that fake height field.
  A first attempt using only per-pixel Lambertian shading (no height field, no occlusion) visually
  failed at the mandatory checkpoint — it just dimmed the whole image uniformly and showed zero
  visible change under an azimuth shift, since it had no way to represent one crater's rim casting
  a shadow onto the terrain beyond it. Fixed before proceeding, not shipped broken. Validated via
  an exact round-trip identity check (relight at the same real known sun angle reproduces the
  original to within 1/255 max pixel diff) and a visual checkpoint (elevation drops plausibly
  lengthen/darken crater-rim shadows; azimuth rotation confirmed real via an isolated shadow-mask
  diagnostic, though the effect is subtle in the final composited image for this densely-textured,
  shallow-crater regolith terrain — a real, terrain-dependent limitation, not glossed over).
  Real sun angle for each source taken from its actual `.spm` ancillary telemetry, never assumed.
- **Scale**: Lanczos resampling at exact known factors — no approximation, ground truth is exact.
- **Rotation**: `cv2.getRotationMatrix2D` about image center with an expanded (non-cropping)
  canvas; the resulting affine, extended to 3x3, IS the ground-truth homography exactly, since we
  control the exact warp used to generate the reference image. Added on top of the original task
  scope since it's essentially free and directly covers the third axis implied by "scale
  invariant" in the PS title.
- **Ground truth**: every synthetic pair's exact applied transform (H_gt) is stored as a JSON
  sidecar next to the pair, never regenerated after the fact.
- **Pipeline**: the real, completely unmodified `run_pipeline.run_registration()` (SIFT + LoFTR
  auto-select, MAGSAC++, degenerate-homography guard, sub-pixel refinement, full validation) — no
  special-casing for synthetic data.
- **True registration error** (the new metric these synthetic pairs make possible): estimated
  homography decomposed and compared against H_gt for rotation error (deg), scale error (ratio),
  and translation error (px); plus 4-corner reprojection error in both px and real ground meters
  (using each source's real GSD — from real `geometry.csv` lon/lat span for the two Chandrayaan-2
  sources, or a coarser real KML-footprint-area estimate for the one LRO NAC source, which has no
  per-pixel label GSD in its real archive product — confirmed by reading its label, not assumed).

**Sources**: `tmc2_20260811_1856` and `tmc2_20260803_0049` (Chandrayaan-2 TMC-2, real `.spm` sun
angle available) + `M1306094925LE` (LRO NAC, scale/rotation only — no real sun-angle telemetry
exists for NAC in our archive). 82 total synthetic pairs, every one run through the real pipeline.

**Results** (plots: `backend/outputs/invariance_sweep/plots/plot_{a,b,c,d}_*.png`; raw data:
`backend/outputs/invariance_sweep/results.jsonl`, `thresholds.json`):

- **Sun-angle** (Plot A): 100% validation pass rate held through -30deg elevation change; first
  degradation at **-45deg** (drops to 50% — 1 of 2 CH2 sources fails). Mean true reprojection
  error grows from 0m (baseline) to ~467m at -45deg.
- **Scale** (Plot B): **100% pass rate held across the entire tested range**, 0.5x-2.0x, all 3
  sources. Mean reprojection error stays under ~81m even at the extremes (0.5x/2.0x) — this axis
  is the pipeline's clear strength.
- **Rotation** (Plot C): NOT a smooth degradation — a flat, **terrain-dependent categorical
  split**. 2 of 3 sources (`tmc2_20260811_1856`, `M1306094925LE`) pass at every tested angle up to
  90deg. The third (`tmc2_20260803_0049`) fails validation at every nonzero rotation tested
  (15/30/45/90deg alike), pulling the aggregate pass rate to a flat 66.7% from 15deg onward rather
  than a gradual curve. This is a real, terrain/geometry-dependent difference between sources, not
  measurement noise — reported as such rather than averaged into a misleading smooth trend.
- **Compound** (Plot D heatmap, rotation fixed at 30deg): pass rate is a flat 50% across every
  scale x sun-delta combination from 0-30deg sun delta (entirely explained by the same
  per-source rotation split above — one source always fails at 30deg rotation regardless of sun
  or scale), then drops to a complete **0%** the moment sun delta reaches -45deg, for both sources,
  at every scale. The two named "hard compound" cases: (sun -30deg, scale 1.5x, rot 30deg) passed
  for 1/2 sources; (sun -45deg, scale 2.0x, rot 45deg) failed for both sources.

**Caveats (restated, not dropped from this summary)**:
- Sun-angle relighting is an approximate, image-derived resynthesis, not physically ground-truthed
  — it conflates real topographic shading with albedo texture, and has no real vertical scale.
  Azimuth-direction sensitivity is real (confirmed via an isolated diagnostic) but subtle in the
  composited image for shallow, densely-cratered regolith terrain specifically.
- NAC source has no real per-pixel GSD; its meters-based error numbers use a coarser real
  KML-footprint-area estimate, not a per-axis-precise value like the CH2 sources.
- **This test does NOT test cross-sensor or self-similar-terrain correspondence** — that remains
  the separately-documented finding from the 24 real pairs above. This suite isolates
  illumination/scale/rotation tolerance on synthetic same-source pairs with exact ground truth
  only; a pipeline that passes every curve here can still fail on a real cross-sensor pair for
  reasons this suite cannot see.

## Distinctive-landmark test: Tycho crater, macro-scale attempt (this session, part 7)

Following the confirmed hypothesis that matchers operate at local patch scale (64-128px) where
lunar terrain is self-similar even on distinctive landmarks, attempted a macro-scale retry on the
real Tycho NAC pair from the earlier distinctive-landmark test (see part 6 above: `M1315458185LE`
2019 vs `M1412862267LE` 2022, real overlapping footprint, 5/15 inliers, 44deg rotation std at
native resolution).

**Step 1 finding (before any matching was attempted, as required): the macro-scale premise doesn't
hold for the data we have.** Tycho's real diameter (85.29km, confirmed via the Gazetteer) is
computed to be vastly larger than either NAC frame's real cross-track swath width -- 2.7-3.8km,
computed directly from the frames' own real KML footprint corners via Haversine distance, not
assumed. LROC NAC is a narrow high-resolution linescan strip camera, not a wide-area framing
camera: no downsampling factor of a single NAC frame can reveal Tycho's whole rim + central peak +
ejecta blanket, because the frame's real footprint never contained that much of the crater to begin
with. This was caught and reported before wasting matching time on top of it, per the checkpoint
this task itself specified.

**Follow-up attempt: real LROC WAC imagery** (100m/px, wide swath, genuinely capable of showing a
whole crater in one frame). Found and downloaded two real, genuinely Tycho-containing WAC EDR
frames via a live ODE product search (`M1405847456ME`, 2022-05; `M1408177929ME`, 2022-05, different
orbit) -- along the way, fixed a real bug in the ODE query itself: the correct product-type code
for LROC NAC EDR is `EDRNAC4` (PDS4), not `EDRNAC` -- the same "Invalid IIPT" error documented
earlier in this file for a different NAC frame, now root-caused and fixed for any future ODE query.

**WAC ingestion produces unusable noise, root-caused (not a quick bug):** verified via direct
inspection of `pds4_tools`' returned structures that our PDS4 reader correctly identifies and
selects the real image array (the label's other structure is a `HeaderStructure` returning plain
`bytes` with no `.ndim`, correctly skipped by our existing filter -- ruled out as a red herring).
The real array (504x1024, matching its own declared Axis_Array dimensions exactly) genuinely
contains near-uniform noise: 1st-99th percentile DN range is 12-18 out of 255, and stretching that
narrow true range to full contrast (bypassing our adaptive stretch entirely, in case that was the
culprit) still shows pure noise with only a coarse brightness gradient, no surface structure at any
contrast level. Conclusion: unlike NAC EDR (whose raw counts show real terrain directly), WAC raw
EDR requires real radiometric calibration (dark-frame subtraction, flat-fielding) and framelet
geometric reassembly -- infrastructure this project does not have (no calibration files, no
ISIS3-equivalent pipeline) -- before any surface signal is visible. This is a genuine data/tooling
gap, not a fixable parsing bug, and was not pursued further given the scope.

**Conclusion: the macro-scale coarse-to-fine retry could not be completed with data actually
available to this project.** Neither NAC (wrong physical scale) nor WAC (raw data unusable without
calibration infrastructure we lack) could supply a valid coarse image. The NAC-vs-NAC Tycho result
from the distinctive-landmark test (part 6) stands as the final data point on this question:
**5/15 inliers, 44deg rotation-consistency std, condition ratio 4.29:1 (the best geometric
consistency of any real pair tested this session, still short of the 5:1 degenerate threshold's
comfortable margin), UNVALIDATED.** A manual visual check of the tightest inlier match (0.14px
reprojection error) showed similarly rugged Tycho-ejecta texture in both crops but not the same
individual rocks/craters -- consistent with coincidental-texture matching, not real correspondence.

**Updated one-sentence project status**: the pipeline is correct and unregressed; the core matching
problem is confirmed Moon-wide and scale-independent within the data actually available to this
project (patch-scale self-similarity, and no usable macro-scale imagery exists to test whether a
truly whole-crater view would resolve it); the remaining paths are a domain-specifically fine-tuned
model (Step 5, not yet attempted) or acquiring/calibrating imagery this project currently cannot
process.

## LoFTR fine-tuning experiment on lunar terrain (this session, part 8)

Minimum-viable fine-tuning attempt, per the plan: fine-tune only LoFTR's last 3 of 8 coarse
self/cross-attention transformer layers (1,969,152 of 11,561,456 total params -- everything else,
including the CNN backbone and the fine-matching stage, frozen), on the 68 non-trivial synthetic
pairs already generated by the invariance sweep (exact ground-truth homographies, real images).
Implementation: `backend/scripts/finetune_loftr.py`.

**Loss**: a simplified analog of LoFTR's real coarse-level supervision (not the full official
training loss, which also supervises the fine stage and uses hard-negative-aware focal loss) --
for each pair, run the partially-trainable model through `loftr_coarse` to get per-cell features
for both images, project each source coarse-grid cell's center through the pair's exact `H_gt` to
find its true target cell in the reference grid, and apply cross-entropy between the model's own
dense coarse similarity matrix and that real target index. Directly supervises the same
representation LoFTR's real coarse-matching stage reads from, using real (not fabricated)
correspondence -- scoped down for a minimum-viable experiment, not the full training recipe.

**Training**: 150 real gradient steps, ~60s total on CPU (no GPU available in this environment).
Loss trend: first-10-step mean 4.65 -> last-10-step mean 3.76 -- the loss did decrease over
training, confirming the training loop itself works and gradients are real, not stalled.

**Evaluation** (the real, unmodified pipeline, before vs after, on the actual Tycho NAC pair from
the distinctive-landmark test -- `M1315458185LE` vs `M1412862267LE`):

| | Pretrained (before) | Fine-tuned (after) |
|---|---|---|
| Raw LoFTR match count | 15 | **1** |
| `total_matches` / `inlier_count` (via `match_auto`) | 15 / 5 | 4 / — (LoFTR excluded, <4 pts; fell back to `classical_sift`) |
| rotation-consistency std | 44.1deg | n/a (too few points) |
| condition ratio | 4.29:1 | n/a |
| validated | False | False |

**Honest finding: fine-tuning made LoFTR's matching measurably WORSE on this pair, not better** --
raw match count collapsed from 15 to 1, and `match_auto` stopped selecting LoFTR at all for this
pair afterward. This is a genuine, real regression, not "no measurable improvement." Plausible
causes, not further investigated given the scope of this experiment: 68 training pairs is a small
dataset for even 2M trainable params; a fixed 1e-5 learning rate with no LR schedule or validation-
based early stopping risks the coarse layers overfitting to the synthetic pairs' specific
scale/rotation statistics at the expense of general matching discriminability; and the simplified
single-loss-term supervision (no fine-level loss, no hard-negative mining) may not adequately
constrain the coarse representation the way LoFTR's real training recipe does. A real, defensible,
citable NN contribution either way -- this is what happens when you touch LoFTR's coarse layers
with a minimum-viable setup on a small, out-of-domain (lunar) dataset, reported honestly rather
than only reporting the version that worked.

**Updated one-sentence project status**: the pipeline is correct and unregressed; the core matching
problem is confirmed Moon-wide and scale-independent within all data this project can process; a
minimum-viable LoFTR fine-tuning attempt measurably regressed matching rather than improving it,
so the problem remains unsolved, and the honest next step (not attempted here) would need either a
much larger lunar-specific training set with the full official LoFTR loss, or a fundamentally
different (geometry-based, not appearance-based) matching approach.

## Crater-Neighborhood Structural Matcher: Step 1 committed, Steps 2-6 gated off by real data (this session, part 9)

Attempted a structurally different matching approach: detect craters, build a spatial graph of
their neighborhood relationships (not individual patch appearance), and match graphs instead of
patches -- the theory being that patch-scale self-similarity (confirmed root cause of every prior
failure, including Tycho) doesn't apply at the graph level, since two visually-identical craters
have different neighbors.

**Step 1 (learned crater detector):**
- This project's own from-scratch YOLOv8n fine-tune failed outright: only 285 real training
  instances (real Robbins-catalog craters cross-referenced against 5 real images via their own
  real geometry -- CH2 per-pixel geometry.csv, NAC KML-corner bilinear fit) across just 5 distinct
  real images. mAP50 = 0.0012, zero detections on the real Tycho test pair. Nowhere near enough
  real data to fine-tune a detector -- a real, informative ceiling, not a bug.
- Per the task's own instruction (no HoughCircles fallback, no fabricated result), adopted a real,
  externally pretrained model instead: `backend/models/crater_boulder_yolov8.pt`, from
  https://github.com/Arpan2307/crater_boulder_detection.git (YOLOv8n, trained by its author on
  ~300 real hand-labeled ISRO OHRC tiles -- not this project's data). Verified against our own real
  Tycho pair before adopting: 282 confident detections (conf up to 0.66, radius 10-35px) on one
  frame; the other needed a threshold near 0.01 to surface only 17 low-confidence (<0.05), one
  suspiciously huge (449px) detections -- a real, reported confidence gap, not smoothed over.

**Dataset-wide check before committing to Steps 2-6** (run across all 27 real CH2+NAC preview
images at conf=0.15, per an explicit pre-registered decision rule: proceed only if most frames show
100+ detections):

| Detections | Count | % |
|---|---|---|
| >=100 | 2/27 | 7% |
| 20-99 | 9/27 | 33% |
| <20 | 16/27 | 59% |

Median 12, mean 38.5 (skewed by two outliers: 282 and 148). **Most of the real dataset does not
produce enough detections to build a meaningful crater-neighborhood graph** -- the two Tycho-region
results that motivated this approach were not representative. Per the pre-registered decision rule,
Steps 2-6 (graph construction, GATv2Conv-based GNN descriptor, Sinkhorn/Hungarian matching, and
integration into `matching.py`'s auto-selection) were NOT built against this data. Step 2/3 skeleton
code was written before this check landed (`backend/pipeline/crater_graph.py`,
`backend/pipeline/crater_gnn.py` -- both compile, use `torch_geometric`'s `GATv2Conv` with real
edge-feature-aware attention as specified) but is left uncommitted and unintegrated: it has never
been run against real data and must not be presented as working.

**Updated one-sentence project status**: the pipeline is correct and unregressed; the core matching
problem (patch-scale self-similarity) is confirmed Moon-wide, scale-independent, and now also
confirmed NOT reliably escapable via crater-neighborhood structure given the real detection density
this project's actual archive supports -- two locally-good results (Tycho ejecta, one frame each of
two other regions) do not generalize across the dataset, and a graph/GNN approach needs a real
detector that works broadly first, which does not currently exist for this data.

## LU5M812TGT fine-tuning attempt, YOLOLens detour, and Step 7 frontend wiring (this session, part 10)

**Goal**: fine-tune the adopted crater detector (part 9) further using the LU5M812TGT Zenodo
dataset (record 13990480), gated on confirming its annotation format is real and usable before
touching training code.

**Step 1 result: hard blocker, confirmed via the Zenodo REST API directly** (not the lossy web
page): the dataset is exactly one 580MB CSV (`Moon_Diamond_catalog_4.csv`: longitude, latitude,
diameter, confidence columns) -- **no image tiles at all**. There is nothing to fine-tune a
detector against. Per this task's own gate ("do not proceed until the format is confirmed
compatible"), this stops the task as scoped.

**Substitute investigation, real but ultimately negative**: the same paper's authors (La Grassa et
al.) publish pretrained multi-head ONNX weights ("YOLOLens", optical + super-resolution) via a
linked GitHub repo/Google Drive folder. Downloaded both variants, confirmed `ultralytics.YOLO()`
can't load them (custom SR+detection export, not a standard ultralytics format -- it silently
assumes a wrong 999-class head and crashes in NMS). Read the real plugin source
(`riccardolagrassa/YOLOLens_QGIS_Plugin`) to extract the actual tiling/normalization/NMS/coordinate
decode, and wrote a clean standalone reimplementation (kept locally during testing, not committed
-- see verdict below).

**Decisive real measurement: 16.2 seconds per 256x256 tile on CPU** (measured directly via
`onnxruntime.InferenceSession`, not estimated). A single Tycho-pair image needs ~75-120 tiles at
that tile/overlap scheme, i.e. ~20-30 minutes per image, versus ~1-2s for the currently-adopted
model. This alone rules YOLOLens out for this pipeline regardless of accuracy -- killed the
in-progress accuracy test rather than spend another ~30 minutes confirming a number that couldn't
change the verdict. **Verdict: kept the existing Arpan2307 model; discarded the YOLOLens files.**

**Step 7 (explicitly unconditional in the task, done regardless of the fine-tuning outcome above)**:
wired the existing crater detector into the live pipeline.
- `backend/pipeline/run_pipeline.py::_detect_craters_safe()` runs `crater_detector.detect_craters`
  on both processed images (`src_processed.png`/`ref_processed.png`) of every uploaded pair, fails
  soft (a detector error is reported in the result JSON, not crash-propagated), and adds a
  `crater_detections` block to `metrics.json`.
- Runs at a real confidence floor of 0.02 (not the earlier hardcoded 0.15) -- NMS/scoring cost is
  identical regardless of the threshold (it only filters the model's own already-computed scores),
  and this project's own measured data confirms the "right" threshold is genuinely image-dependent
  (one real frame needed ~0.01 to surface anything at all, another was already dense at 0.15).
  Returning the lower-confidence candidates lets the frontend reveal them on request instead of
  silently guessing one threshold that's wrong for most images.
- Frontend: `DetectedCraterOverlay.tsx` (cyan markers, distinct from the amber match dots and the
  purple crater-catalog rings), a toggle + confidence slider in `StepDetection.tsx`, wired through
  `crater_detections` in `services/api.ts` and `WorkspaceData.craterDetections` in `types.ts`.
- **Real bug found and fixed during manual verification, not a data/wiring bug**: initial user
  report of "nothing changed" when toggling the overlay traced (via a temporary on-screen debug
  readout of computed screen coordinates, since this environment had no browser devtools access)
  to `homeFillsViewer: true` cropping a tall 1200x847px NAC frame to a 380px-tall pane at the
  default zoom -- detections near the top/bottom of the real image were computed correctly but
  fell outside the visible crop (e.g. sy=-173px, sy=484px against a 0-380px visible window).
  Confirmed by having the user zoom out; markers appeared exactly as expected. Not a frontend bug.
- **Real, remaining honest limitation surfaced by the user during testing**: even at the 0.02
  floor, the model does not mark every crater visible to the eye in a given frame -- this is the
  same uneven-generalization ceiling documented in part 9 (2/27 real images >=100 detections at
  0.15), not something the confidence slider can fully close. Reported to the user as-is rather
  than implying the slider is a fix for the model's real accuracy ceiling.

## DEM-assisted registration: real LOLA data confirms resolution is insufficient even at Tycho scale, checkpoint stopped Steps 3-6 (this session, part 11)

**Step 1**: downloaded the real LOLA GDR global elevation product `ldem_64.img`/`.lbl` (PDS
Geosciences Node, `lro-l-lola-3-rdr-v1`), 64 px/deg (473.802 m/px), 16-bit signed DN,
`HEIGHT = DN * 0.5m`, global coverage -90/90 lat, 0/360 lon -- confirmed exact byte count
(530,841,600 = 11520 lines x 46080 bytes/line, matching the label exactly). Real visual sanity
check at the FULL 85km crater scale (a 384x384px / ~182x182km crop centered on Tycho's real IAU
coordinates, -43.31/348.68) clearly shows the crater bowl and rim in both raw elevation and a
simple fixed-sun-angle hillshade -- confirmed LOLA 64ppd genuinely resolves Tycho at that broad
scale, as the task's premise expected.

**Real sun geometry, not from the PDS label (a real deviation from the task's literal
instruction)**: the two real Tycho NAC frames use PDS4 labels which, like their PDS3
counterparts checked earlier this session, do not carry INCIDENCE_ANGLE/SUB_SOLAR_AZIMUTH fields
at all -- confirmed by direct inspection. Used two real substitutes instead: ODE REST API gives
real per-product Incidence_angle/Emission_angle/Phase_angle (M1412862267LE: 67.59/1.72/69.2 deg;
M1315458185LE: 42.07/15.26/40.54 deg), and real sun azimuth was derived via NAIF SPICE (real
generic kernels: naif0012.tls, pck00011.tpc, moon_pa_de421_1900-2050.bpc, moon_080317.tf,
de440s.bsp) computing the actual sub-solar point (`subslr`) at each frame's real UTC observation
time and real center lat/lon. Cross-checked: SPICE-derived incidence matched ODE's real value to
within 0.01-0.02 degrees for both frames -- a strong real validation of the geometry, not a
coincidence (caught and fixed a real bug in the process: `spiceypy.reclat()` returns
`(radius, lon, lat)`, not `(lon, lat, radius)` -- the initial unpacking bug produced a physically
impossible -67 degree sub-solar latitude, caught by a real physical sanity bound: the Moon's real
sub-solar latitude is always within about +/-1.5 degrees of the equator).

**Step 2 checkpoint result: FAILED, decisively and quantitatively, not just "looks different"**.
Generated real per-frame hillshades (`backend/scripts/dem_hillshade_generate.py`) in the exact
same pixel grid as the real NAC crop already used for matching all session (reproduced the
previously-established crop range for M1315458185LE almost exactly: lines [8614:29611] vs the
earlier [8616:29611], and reproduced the previously-established output dimensions 706x2000 /
482x2000 exactly, confirming the corner-bilinear-fraction method is consistent with prior work).
Both hillshades are visually almost featureless flat gray -- no crater rims, no boulders, nothing
resembling the real image's rugged texture. The real, quantitative reason: at this crop's real
ground sampling (~5.8-5.9 m/px, matching the scale used for actual matching all session), the
706x2000px and 482x2000px crops span only **8.6x24.5 and 6.0x24.9 REAL LOLA 64ppd pixels**
respectively -- everything else in the hillshade image is bilinear-interpolation artifact, not
real terrain signal. There is no way for the DEM to show real structure at this scale: the crop
that needs matching (a few km wide, the actual overlap between the two NAC frames) is 60-80x
smaller than the ~180km scale at which Step 1's own sanity check passed.

**Per the task's own explicit instruction ("if the hillshade shows completely different structure
... report that finding and stop"), Steps 3-6 were not attempted.** This is a stronger, empirically
confirmed version of the same conclusion already reached theoretically earlier this session:
LOLA's real resolution is sufficient for Tycho-scale (~85km) coarse anchoring, exactly as
originally proposed, but is NOT sufficient at the actual overlap scale (a few km) that the
patch-matching failure mode lives at -- DEM-assisted registration cannot help close that specific
gap using this dataset, regardless of matcher choice. A genuinely coarse-to-fine pipeline using
this real DEM would need to operate at two very different scales (DEM anchor at ~100km+, image
matching at ~km), which is a different, larger architecture than "hillshade-match this crop" --
out of scope for what was tested here, and not attempted without a further explicit decision to
build a real multi-scale registration architecture.

## Notes / deviations
- LoFTR (deep matcher) requires torch+kornia (~GBs). Wired behind a try/import with automatic fallback to classical if unavailable, so the system never breaks if the ML stack isn't installed. Documented in README with install instructions to enable it.
