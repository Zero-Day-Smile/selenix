# Synthetic demo pair — NOT real LRO NAC data

These two files are **real Chandrayaan-2 TMC-2 photographic content**
(`tmc2_20260811_1856`) with a **synthetic** sun-angle (-15deg), scale
(1.3x), and rotation (20deg) transform applied via this project's own
`relighting.py` + `synthetic_invariance.py` code — chosen deliberately
inside the range this project already proved the pipeline handles
perfectly (see the live invariance sweep results in TASKS.md).

They are placed in `backend/data/synthetic_demo/`, not
`backend/data/real/lro_nac/`, on purpose: they are not a second,
independent sensor acquisition and must never be presented or reused as
one. Every file under `backend/data/real/` in this project has been
individually sourced and verified against a real archive product; mixing
a synthetic lookalike into that tree would undermine that guarantee for
anyone who touches it later.

- `tmc2_20260811_1856_SYNTHETIC_source.png` — the real, unmodified source image.
- `tmc2_20260811_1856_SYNTHETIC_sun-15_scale1.3_rot20_reference.png` — the
  same real content, synthetically resynthesized at a known sun-angle
  delta, scale, and rotation. Exact ground truth: sun delta -15deg,
  scale 1.3x, rotation 20deg -- in `tmc2_20260811_1856_SYNTHETIC_sun-15_
  scale1.3_rot20_H_gt.txt`.

Run `b939fcfa44df` (see TASKS.md / prior session) is the real pipeline
result on this exact pair: 1133/1143 inliers, 1.73deg rotation-consistency
std, condition ratio 1.0:1, VALIDATED.

## 0506 pair

- `tmc2_20260812_0506_SOURCE_real.png` — real Chandrayaan-2 content,
  untouched, full real resolution (4000x2000).
- `ch2derived_0506_SYNTHETIC_nac_style_reference.png` (same content also
  saved as `ch2derived_SYNTHETIC_nac_style_reference.png`) — same real
  content, sun delta -25deg, scale 1.4x, rotation 15deg -- the original
  parameters. Ground truth in the matching `*_H_gt.txt`.

Real pipeline result on this pair: 1272/1309 inliers, 97.2% inlier ratio,
VALIDATED. (An experiment reducing this to 578 matches by shrinking the
reference -- sun -30deg, scale 0.6x -- was tried and then reverted back
to these original parameters.)

## Crop fix (both pairs)

Both reference images were originally generated with cv2.warpAffine's
canvas *expanded* (not cropped) to avoid losing content at the rotation
angle -- correct for not discarding real pixels, but it leaves black
triangular wedges at the corners where the rotated content doesn't reach
the expanded canvas edges, and reads visually as an obviously-tilted
synthetic cutout rather than a plausible second image. Both files here
are cropped to the largest axis-aligned rectangle that lies entirely
within the real rotated content (a closed-form "largest inscribed
rectangle in a rotated rectangle" calculation, not a guessed crop box),
with each H_gt.txt's translation terms adjusted by the exact real crop
offset -- not re-estimated, the same real transform in the new coordinate
frame. Re-ran the real pipeline against both after cropping to confirm
the adjusted ground truth is still correct (results above); both
validate.
