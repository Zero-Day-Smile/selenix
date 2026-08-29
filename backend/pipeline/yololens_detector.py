"""YOLOLens1 crater detector -- real pretrained ONNX weights (La Grassa et al.,
optical-only variant, no DTM required) adapted to run on our plain PNG
preview images without the original QGIS/GDAL plugin runtime.

Provenance: weights downloaded from the Google Drive folder linked in
https://github.com/riccardolagrassa/YOLOLens_QGIS_Plugin (itself linked
from the LU5M812TGT Zenodo dataset page, record 13990480). The decode
logic below (tiling, normalization, NMS, /sr_factor coordinate scale-back,
IoU-based cross-tile dedup) is a from-scratch reimplementation of the real
algorithm read directly out of the plugin's own crater_detector.py
(non_max_suppression / get_local_pred / apply_deduplication), stripped of
its GDAL/QGIS/DTM-specific plumbing since we only have plain optical PNGs
and no elevation rasters (Model 2 / DTM-fused inference is not usable
here). We did NOT use ultralytics.YOLO() to load this ONNX file --
confirmed incompatible: it assumes a standard ultralytics export and
defaulted to a wrong 999-class assumption, crashing in NMS.

Real, empirically-confirmed yolo_out shape for a 256x256 tile: (1, 5,
5376) -- 4 box params + 1 class ("crater"), 5376 anchors for a 512x512
internal (2x super-resolved) detection grid (8/16/32 strides ->
64*64+32*32+16*16=5376). This confirms sr_factor=2 exactly as read from
the plugin source.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "external_yololens" / "YOLOLens1.onnx"
TILE_SIZE = 256
OVERLAP = 128
STRIDE = TILE_SIZE - OVERLAP
SR_FACTOR = 2
DEFAULT_CONF = 0.15
DEFAULT_IOU = 0.45
DEDUP_IOU = 0.6  # matches the plugin's real 0.6 intersection-over-union merge threshold

_session = None


@dataclass
class YoloLensDetection:
    cx: float
    cy: float
    w: float
    h: float
    confidence: float


def _load_session():
    global _session
    if _session is None:
        import onnxruntime as ort
        _session = ort.InferenceSession(str(MODEL_PATH))
    return _session


def _xywh2xyxy(box: np.ndarray) -> np.ndarray:
    y = np.copy(box)
    y[..., 0] = box[..., 0] - box[..., 2] / 2
    y[..., 1] = box[..., 1] - box[..., 3] / 2
    y[..., 2] = box[..., 0] + box[..., 2] / 2
    y[..., 3] = box[..., 1] + box[..., 3] / 2
    return y


def _nms_single_class(pred: np.ndarray, conf_thres: float, iou_thres: float) -> np.ndarray:
    """pred: (5, num_anchors) = [x, y, w, h, conf]. Returns (N, 5) xyxy+conf
    surviving boxes, in the tile's own (super-resolved) pixel space."""
    conf = pred[4, :]
    keep_mask = conf > conf_thres
    if not keep_mask.any():
        return np.zeros((0, 5), dtype=np.float32)
    box = pred[:4, keep_mask].T  # (n, 4) xywh
    conf = conf[keep_mask]
    xyxy = _xywh2xyxy(box)

    order = conf.argsort()[::-1]
    boxes, scores = xyxy[order], conf[order]
    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = np.maximum(x2 - x1, 0) * np.maximum(y2 - y1, 0)
    keep = []
    idxs = list(range(len(boxes)))
    while idxs:
        i = idxs[0]
        keep.append(i)
        rest = idxs[1:]
        if not rest:
            break
        xx1 = np.maximum(x1[i], x1[rest])
        yy1 = np.maximum(y1[i], y1[rest])
        xx2 = np.minimum(x2[i], x2[rest])
        yy2 = np.minimum(y2[i], y2[rest])
        inter = np.maximum(xx2 - xx1, 0) * np.maximum(yy2 - yy1, 0)
        iou = inter / np.maximum(areas[i] + areas[rest] - inter, 1e-9)
        idxs = [j for j, v in zip(rest, iou) if v <= iou_thres]
    kept = boxes[keep]
    kept_conf = scores[keep]
    return np.concatenate([kept, kept_conf[:, None]], axis=1)


def _iou_xywh(a: YoloLensDetection, b: YoloLensDetection) -> float:
    ax1, ay1, ax2, ay2 = a.cx - a.w / 2, a.cy - a.h / 2, a.cx + a.w / 2, a.cy + a.h / 2
    bx1, by1, bx2, by2 = b.cx - b.w / 2, b.cy - b.h / 2, b.cx + b.w / 2, b.cy + b.h / 2
    xx1, yy1 = max(ax1, bx1), max(ay1, by1)
    xx2, yy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(xx2 - xx1, 0) * max(yy2 - yy1, 0)
    union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
    return inter / union if union > 0 else 0.0


def _deduplicate(dets: list[YoloLensDetection]) -> list[YoloLensDetection]:
    """Real merge rule from the plugin: cluster boxes whose IoU >= 0.6 and
    keep the highest-confidence one per cluster (plain IoU here in place
    of the plugin's shapely/geopandas polygon-intersection version --
    equivalent result for axis-aligned boxes, no geopandas dependency
    needed for our use case)."""
    n = len(dets)
    visited = [False] * n
    kept = []
    for i in range(n):
        if visited[i]:
            continue
        cluster = [i]
        visited[i] = True
        stack = [i]
        while stack:
            a = stack.pop()
            for b in range(n):
                if not visited[b] and _iou_xywh(dets[a], dets[b]) >= DEDUP_IOU:
                    visited[b] = True
                    cluster.append(b)
                    stack.append(b)
        best = max(cluster, key=lambda idx: dets[idx].confidence)
        kept.append(dets[best])
    return kept


def detect_craters_yololens(image_path: str, conf: float = DEFAULT_CONF,
                             iou: float = DEFAULT_IOU) -> list[YoloLensDetection]:
    """Real sliding-window inference over the full image using YOLOLens1
    (optical-only, no DTM). Mirrors the plugin's real algorithm: grayscale
    -> 3-channel replication, per-tile max-normalization, 256px tiles with
    128px overlap/stride, zero-pad partial edge tiles, decode via NMS,
    divide box coords by sr_factor=2, add tile offset, then cross-tile
    IoU dedup."""
    gray = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    if gray is None:
        raise FileNotFoundError(image_path)
    h, w = gray.shape
    session = _load_session()

    all_dets: list[YoloLensDetection] = []
    y = 0
    while y < h:
        x = 0
        win_h = min(TILE_SIZE, h - y)
        while x < w:
            win_w = min(TILE_SIZE, w - x)
            patch = gray[y:y + win_h, x:x + win_w].astype(np.float32)
            if win_h < TILE_SIZE or win_w < TILE_SIZE:
                padded = np.zeros((TILE_SIZE, TILE_SIZE), dtype=np.float32)
                padded[:win_h, :win_w] = patch
                patch = padded

            max_v = max(patch.max(), 255.0) if patch.max() > 1.001 else 1.0
            input_data = np.stack([patch / max_v] * 3, axis=0)[None].astype(np.float32)

            yolo_out = session.run(["yolo_out"], {"input": input_data})[0][0]  # (5, num_anchors)
            boxes = _nms_single_class(yolo_out, conf, iou)
            for bx1, by1, bx2, by2, c in boxes:
                bw, bh = (bx2 - bx1) / SR_FACTOR, (by2 - by1) / SR_FACTOR
                bcx, bcy = (bx1 + bx2) / 2 / SR_FACTOR, (by1 + by2) / 2 / SR_FACTOR
                all_dets.append(YoloLensDetection(cx=bcx + x, cy=bcy + y, w=bw, h=bh, confidence=float(c)))

            if x + TILE_SIZE >= w:
                break
            x += STRIDE
        if y + TILE_SIZE >= h:
            break
        y += STRIDE

    return _deduplicate(all_dets)
