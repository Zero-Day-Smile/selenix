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
    """Per-image feature detection with a disk cache keyed by file hash + method,
    so repeat processing of the same source/reference image doesn't recompute
    SIFT/ORB from scratch."""
    from . import memory
    key = memory.cache_key(file_hash, {"method": method, "stage": "features"})
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
                     ref_hash: str | None = None) -> MatchResult:
    norm = cv2.NORM_L2 if method == "sift" else cv2.NORM_HAMMING

    if src_hash and ref_hash:
        kp1, des1 = detect_features_cached(src_u8, src_hash, method)
        kp2, des2 = detect_features_cached(ref_u8, ref_hash, method)
    else:
        detector = cv2.SIFT_create(nfeatures=8000) if method == "sift" else cv2.ORB_create(nfeatures=8000)
        kp1, des1 = detector.detectAndCompute(src_u8, None)
        kp2, des2 = detector.detectAndCompute(ref_u8, None)

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


def match_deep_loftr(src_u8: np.ndarray, ref_u8: np.ndarray, conf_thresh: float = 0.5) -> MatchResult | None:
    """LoFTR outdoor-ds matcher via kornia. Returns None (caller falls back to
    classical) if torch/kornia are not installed — kept optional so the
    pipeline never breaks in an environment without the ML stack."""
    if not _try_load_loftr():
        return None
    import torch

    def prep(img):
        t = torch.from_numpy(img).float()[None, None] / 255.0
        return t

    with torch.no_grad():
        batch = {"image0": prep(src_u8), "image1": prep(ref_u8)}
        out = _loftr_model(batch)

    conf = out["confidence"].cpu().numpy()
    keep = conf >= conf_thresh
    src_pts = out["keypoints0"].cpu().numpy()[keep]
    ref_pts = out["keypoints1"].cpu().numpy()[keep]
    confidences = conf[keep].astype(np.float32)

    return MatchResult(src_pts.astype(np.float32), ref_pts.astype(np.float32), confidences,
                        "deep_loftr")


def match_auto(src_u8: np.ndarray, ref_u8: np.ndarray, inlier_ratio_fn,
               src_hash: str | None = None, ref_hash: str | None = None) -> tuple[MatchResult, dict]:
    """Runs classical (SIFT) and, if available, deep (LoFTR); picks whichever
    yields the higher post-RANSAC inlier ratio. `inlier_ratio_fn(MatchResult)
    -> float` is supplied by the caller (geometry stage) to avoid a circular
    import and to keep this module matcher-only."""
    candidates = {}
    classical = match_classical(src_u8, ref_u8, "sift", src_hash=src_hash, ref_hash=ref_hash)
    candidates["classical_sift"] = (classical, inlier_ratio_fn(classical))

    deep = match_deep_loftr(src_u8, ref_u8)
    if deep is not None and len(deep.src_pts) >= 4:
        candidates["deep_loftr"] = (deep, inlier_ratio_fn(deep))

    best_name = max(candidates, key=lambda k: candidates[k][1])
    best_result, best_score = candidates[best_name]
    summary = {name: score for name, (_, score) in candidates.items()}
    summary["chosen"] = best_name
    return best_result, summary
