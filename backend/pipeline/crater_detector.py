"""Learned crater detector -- YOLOv8, NOT HoughCircles (deliberately; see
module docstring in the CNSFM task this supports). This project's own
from-scratch fine-tune attempt failed the acceptance test outright (285
real training instances across only 5 real images -- nowhere near enough
data -- mAP50 0.0012, zero detections on the real Tycho test pair). Rather
than substitute a worse method (explicitly disallowed) or fabricate a
result, adopted a real, externally pretrained model instead:
backend/models/crater_boulder_yolov8.pt, from
https://github.com/Arpan2307/crater_boulder_detection.git, trained by its
author on ~300 real hand-labeled ISRO OHRC tiles. Verified on this
project's own real Tycho pair before adopting -- see backend/models/README.md.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

MODEL_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models", "crater_boulder_yolov8.pt")

_model = None


@dataclass
class CraterDetection:
    cx: float
    cy: float
    radius_px: float
    confidence: float
    class_name: str  # "crater" or "boulder" -- this model detects both


def _load_model():
    global _model
    if _model is None:
        from ultralytics import YOLO
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(
                f"{MODEL_PATH} not found -- see backend/models/README.md for the real source "
                f"(https://github.com/Arpan2307/crater_boulder_detection.git)."
            )
        _model = YOLO(MODEL_PATH)
    return _model


def detect_craters(image_path: str, conf: float = 0.15, craters_only: bool = True,
                    max_side: int = 2000) -> list[CraterDetection]:
    """Real YOLOv8 inference, no synthetic/fabricated fallback. `conf`
    defaults to 0.15 -- calibrated against this project's own real Tycho
    test images (0.15 gave 282 real detections on one frame; the other
    needed a much lower threshold, ~0.01, to surface anything -- a real,
    image-dependent confidence gap worth knowing about, not smoothed over
    by silently lowering the default for everyone).

    `max_side`: `model.predict(image_path, ...)` used to hand ultralytics
    the raw file path directly, letting it load+letterbox the image
    internally with no cap -- for a real full-resolution Chandrayaan-2
    processed PNG (up to ~110,000px on the long side) that's real, wasted
    I/O and memory pressure loading a multi-hundred-megapixel image just to
    downscale it to the model's own inference size anyway (this model, per
    its own real training data -- ~300 hand-labeled OHRC tiles -- was never
    trained to expect a whole-strip input in the first place; it already
    only ever sees a much smaller effective resolution once ultralytics'
    own internal resize runs). Loading and downsampling here first, before
    handing ultralytics an array instead of a path, avoids that waste;
    detections are rescaled back to the caller's original image coordinates
    so nothing downstream needs to change."""
    import cv2

    img = cv2.imread(image_path)
    if img is None:
        raise FileNotFoundError(f"could not read image at {image_path} for crater detection")
    h, w = img.shape[:2]
    scale = min(1.0, max_side / max(h, w))
    if scale < 1.0:
        img = cv2.resize(img, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA)

    model = _load_model()
    results = model.predict(img, conf=conf, verbose=False)
    boxes = results[0].boxes
    names = model.names

    detections = []
    for i in range(len(boxes)):
        cls_id = int(boxes.cls[i].item())
        class_name = names[cls_id]
        if craters_only and class_name != "crater":
            continue
        x, y, bw, bh = boxes.xywh[i].tolist()
        if scale < 1.0:
            x, y, bw, bh = x / scale, y / scale, bw / scale, bh / scale
        detections.append(CraterDetection(
            cx=x, cy=y, radius_px=(bw + bh) / 4.0,
            confidence=float(boxes.conf[i].item()), class_name=class_name,
        ))
    return detections
