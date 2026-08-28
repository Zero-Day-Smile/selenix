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


def detect_craters(image_path: str, conf: float = 0.15, craters_only: bool = True) -> list[CraterDetection]:
    """Real YOLOv8 inference, no synthetic/fabricated fallback. `conf`
    defaults to 0.15 -- calibrated against this project's own real Tycho
    test images (0.15 gave 282 real detections on one frame; the other
    needed a much lower threshold, ~0.01, to surface anything -- a real,
    image-dependent confidence gap worth knowing about, not smoothed over
    by silently lowering the default for everyone)."""
    model = _load_model()
    results = model.predict(image_path, conf=conf, verbose=False)
    boxes = results[0].boxes
    names = model.names

    detections = []
    for i in range(len(boxes)):
        cls_id = int(boxes.cls[i].item())
        class_name = names[cls_id]
        if craters_only and class_name != "crater":
            continue
        x, y, w, h = boxes.xywh[i].tolist()
        detections.append(CraterDetection(
            cx=x, cy=y, radius_px=(w + h) / 4.0,
            confidence=float(boxes.conf[i].item()), class_name=class_name,
        ))
    return detections
