"""Feature matching: classical (SIFT/ORB + FLANN/BFMatcher) and deep (LoFTR,
optional). Includes mutual nearest-neighbor check and Lowe's ratio test for
classical matches, and confidence-based filtering for LoFTR matches.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class MatchResult:
    src_pts: np.ndarray      # Nx2 float32
    ref_pts: np.ndarray      # Nx2 float32
    confidences: np.ndarray  # N float32 in [0,1]
    matcher_used: str
    n_keypoints_src: int = 0
    n_keypoints_ref: int = 0


def _mutual_nn_filter(matches_ab, matches_ba):
    ba_set = {(m.trainIdx, m.queryIdx) for m in matches_ba}
    return [m for m in matches_ab if (m.queryIdx, m.trainIdx) in ba_set]


def _kp_to_serializable(kp_list):
    return [((k.pt[0], k.pt[1]), k.size, k.angle, k.response, k.octave, k.class_id) for k in kp_list]


def _kp_from_serializable(data):
    return [cv2.KeyPoint(x=d[0][0], y=d[0][1], size=d[1], angle=d[2], response=d[3],
                          octave=d[4], class_id=d[5]) for d in data]


def detect_features_cached(img_u8: np.ndarray, file_hash: str, method: str = "sift"):
    """Per-image feature detection with a disk cache keyed by file hash +
    method + the actual working resolution passed in, so repeat processing
    of the same source/reference image doesn't recompute SIFT/ORB from
    scratch. The working-resolution component is real, not decorative: it's
    what makes a stale cache entry from before match_classical's max_side
    downsample was added (this session) correctly MISS rather than being
    silently reused as if it were the new downsampled-coordinate-space
    features -- which would have double-scaled every keypoint on first
    reuse for any file processed before this fix."""
    from . import memory
    key = memory.cache_key(file_hash, {"method": method, "stage": "features", "shape": img_u8.shape[:2]})
    cached = memory.cache_get(key)
    if cached is not None:
        kp_data, des = cached
        return _kp_from_serializable(kp_data), des

    if method == "sift":
        detector = cv2.SIFT_create(nfeatures=8000)
    else:
        detector = cv2.ORB_create(nfeatures=8000)
    kp, des = detector.detectAndCompute(img_u8, None)
    memory.cache_put(key, (_kp_to_serializable(kp or []), des))
    return kp, des


def match_classical(src_u8: np.ndarray, ref_u8: np.ndarray, method: str = "sift",
                     ratio: float = 0.75, src_hash: str | None = None,
                     ref_hash: str | None = None, max_side: int = 4000) -> MatchResult:
    """`max_side`: real Chandrayaan-2/LRO products can run to 147,741px on
    their long axis (a pushbroom strip's along-track length, not useful
    detail density) -- SIFT's detectAndCompute cost scales with pixel count,
    so running it at native resolution on a real full-size upload is
    genuinely slow (minutes, not seconds) for no matching-quality benefit
    beyond what a much smaller working resolution already captures (the
    existing multi-scale `level_for_matching` step already establishes that
    downsampling for matching doesn't hurt inlier ratio). Each image is
    independently downsampled (preserving aspect ratio) only if its own
    longer side exceeds max_side, features are detected on the downsampled
    copy, and keypoint coordinates are rescaled back to that image's own
    original resolution before returning -- RANSAC/refinement/output all
    still operate in true full-resolution coordinates, unaffected. Same
    pattern already used for LoFTR's max_side=840 cap below (added earlier
    for a real OOM bug); 4000 here is far more generous since classical
    SIFT needs more real resolution than LoFTR's dense coarse-matching stage
    to stay useful."""
    norm = cv2.NORM_L2 if method == "sift" else cv2.NORM_HAMMING

    def _prep(img: np.ndarray) -> tuple[np.ndarray, float]:
        h, w = img.shape[:2]
        scale = min(1.0, max_side / max(h, w))
        if scale >= 1.0:
            return img, 1.0
        small = cv2.resize(img, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA)
        return small, scale

    src_small, src_scale = _prep(src_u8)
    ref_small, ref_scale = _prep(ref_u8)

    if src_hash and ref_hash:
        # Cache key already includes file_hash+method; the working
        # resolution here is a deterministic function of the file itself
        # (same real file always downsamples to the same size), so this
        # stays correct without also encoding max_side into the key.
        kp1, des1 = detect_features_cached(src_small, src_hash, method)
        kp2, des2 = detect_features_cached(ref_small, ref_hash, method)
    else:
        detector = cv2.SIFT_create(nfeatures=8000) if method == "sift" else cv2.ORB_create(nfeatures=8000)
        kp1, des1 = detector.detectAndCompute(src_small, None)
        kp2, des2 = detector.detectAndCompute(ref_small, None)

    if src_scale != 1.0 and kp1:
        for k in kp1:
            k.pt = (k.pt[0] / src_scale, k.pt[1] / src_scale)
    if ref_scale != 1.0 and kp2:
        for k in kp2:
            k.pt = (k.pt[0] / ref_scale, k.pt[1] / ref_scale)

    if des1 is None or des2 is None or len(kp1) < 4 or len(kp2) < 4:
        return MatchResult(np.empty((0, 2), np.float32), np.empty((0, 2), np.float32),
                            np.empty((0,), np.float32), f"classical_{method}",
                            len(kp1 or []), len(kp2 or []))

    if method == "sift":
        index_params = dict(algorithm=1, trees=5)  # FLANN KDTree
        search_params = dict(checks=64)
        matcher = cv2.FlannBasedMatcher(index_params, search_params)
        des1f, des2f = des1.astype(np.float32), des2.astype(np.float32)
        knn_ab = matcher.knnMatch(des1f, des2f, k=2)
        knn_ba = matcher.knnMatch(des2f, des1f, k=2)
    else:
        matcher = cv2.BFMatcher(norm)
        knn_ab = matcher.knnMatch(des1, des2, k=2)
        knn_ba = matcher.knnMatch(des2, des1, k=2)

    # Lowe's ratio test both directions
    good_ab = [m for m, n in knn_ab if n is not None and m.distance < ratio * n.distance]
    good_ba = [m for m, n in knn_ba if n is not None and m.distance < ratio * n.distance]

    # Mutual nearest-neighbor consistency
    mutual = _mutual_nn_filter(good_ab, good_ba)

    if not mutual:
        return MatchResult(np.empty((0, 2), np.float32), np.empty((0, 2), np.float32),
                            np.empty((0,), np.float32), f"classical_{method}", len(kp1), len(kp2))

    src_pts = np.float32([kp1[m.queryIdx].pt for m in mutual])
    ref_pts = np.float32([kp2[m.trainIdx].pt for m in mutual])
    max_d = max((m.distance for m in mutual), default=1.0) or 1.0
    confidences = np.float32([1.0 - (m.distance / max_d) for m in mutual])

    return MatchResult(src_pts, ref_pts, confidences, f"classical_{method}", len(kp1), len(kp2))


_loftr_model = None
_loftr_available = None


def _try_load_loftr():
    global _loftr_model, _loftr_available
    if _loftr_available is not None:
        return _loftr_available
    try:
        import torch  # noqa
        import kornia.feature as KF  # noqa
        _loftr_model = KF.LoFTR(pretrained="outdoor")
        _loftr_model.eval()
        _loftr_available = True
    except Exception:
        _loftr_available = False
    return _loftr_available


def match_deep_loftr(src_u8: np.ndarray, ref_u8: np.ndarray, conf_thresh: float = 0.5,
                      max_side: int = 840) -> MatchResult | None:
    """LoFTR outdoor-ds matcher via kornia. Returns None (caller falls back to
    classical) if torch/kornia are not installed — kept optional so the
    pipeline never breaks in an environment without the ML stack.

    LoFTR's coarse-matching stage computes a dense similarity matrix between
    every 1/8-resolution patch of image A and every patch of image B — its
    memory cost scales with the *product* of both images' patch counts, not
    their sum. Confirmed by hitting a real 169GB allocation attempt on an
    ~8000x1700 real crop. `max_side` (840px, LoFTR's typical usage size)
    caps each image's longer side before inference; keypoints are rescaled
    back to the caller's original coordinate space afterward, so this is
    transparent to callers — MatchResult is always in input-image pixels."""
    if not _try_load_loftr():
        return None
    import torch

    def prep(img):
        h, w = img.shape[:2]
        scale = min(1.0, max_side / max(h, w))
        resized = cv2.resize(img, (max(1, int(w * scale)), max(1, int(h * scale)))) if scale < 1.0 else img
        t = torch.from_numpy(resized).float()[None, None] / 255.0
        return t, scale, resized.shape[:2]

    with torch.no_grad():
        src_t, src_scale, src_resized_shape = prep(src_u8)
        ref_t, ref_scale, ref_resized_shape = prep(ref_u8)
        batch = {"image0": src_t, "image1": ref_t}
        out = _loftr_model(batch)

    conf = out["confidence"].cpu().numpy()
    keep = conf >= conf_thresh
    src_pts = out["keypoints0"].cpu().numpy()[keep] / src_scale
    ref_pts = out["keypoints1"].cpu().numpy()[keep] / ref_scale
    confidences = conf[keep].astype(np.float32)

    # LoFTR has no discrete keypoint-detection stage (unlike SIFT/ORB) -- it
    # runs dense matching over every 1/8-resolution patch of the resized
    # image via its stride-8 CNN backbone. That patch grid is the real,
    # honest analogue of "keypoints considered" for this matcher: it's what
    # the match candidates were actually drawn from, just not a filtered
    # discrete set the way SIFT keypoints are. Reporting 0 here (the old
    # behavior) was flatly wrong -- 36+ matches cannot come from 0 considered
    # locations on either side.
    n_kp_src = (src_resized_shape[0] // 8) * (src_resized_shape[1] // 8)
    n_kp_ref = (ref_resized_shape[0] // 8) * (ref_resized_shape[1] // 8)

    return MatchResult(src_pts.astype(np.float32), ref_pts.astype(np.float32), confidences,
                        "deep_loftr", n_kp_src, n_kp_ref)


def match_auto(src_u8: np.ndarray, ref_u8: np.ndarray, inlier_ratio_fn,
               src_hash: str | None = None, ref_hash: str | None = None) -> tuple[MatchResult, dict]:
    """Runs classical (SIFT) and, if available, deep (LoFTR); picks whichever
    yields the higher post-RANSAC inlier ratio. `inlier_ratio_fn(MatchResult)
    -> float` is supplied by the caller (geometry stage) to avoid a circular
    import and to keep this module matcher-only.

    The two candidates are independent (deep_loftr touches no shared state;
    classical's on-disk feature cache is only ever written by the classical
    call itself, never contended) so they run concurrently in a thread pool
    -- both numpy/opencv and torch release the GIL during their real compute,
    so this is a genuine wall-clock win, not just a reshuffle, cutting
    "auto" mode's cost from sequential-both to whichever candidate is
    slower. Found necessary live: the invariance sweep (18 variants, every
    one calling match_auto) was taking far longer than its own timing
    estimate before this fix -- see TASKS.md."""
    from concurrent.futures import ThreadPoolExecutor

    candidates = {}
    with ThreadPoolExecutor(max_workers=2) as pool:
        classical_future = pool.submit(match_classical, src_u8, ref_u8, "sift", src_hash=src_hash, ref_hash=ref_hash)
        deep_future = pool.submit(match_deep_loftr, src_u8, ref_u8)
        classical = classical_future.result()
        deep = deep_future.result()

    candidates["classical_sift"] = (classical, inlier_ratio_fn(classical))
    if deep is not None and len(deep.src_pts) >= 4:
        candidates["deep_loftr"] = (deep, inlier_ratio_fn(deep))

    best_name = max(candidates, key=lambda k: candidates[k][1])
    best_result, best_score = candidates[best_name]
    summary = {name: score for name, (_, score) in candidates.items()}
    summary["chosen"] = best_name
    return best_result, summary
