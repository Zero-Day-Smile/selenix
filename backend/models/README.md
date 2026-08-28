# crater_boulder_yolov8.pt

Real, externally pretrained YOLOv8n crater+boulder detector, sourced from:
https://github.com/Arpan2307/crater_boulder_detection.git (commit at
time of import: see `external_crater_repo/` if still present, or the
GitHub history).

Trained by that repo's author on ~300 real, hand-labeled ISRO OHRC lunar
image tiles (LabelImg-annotated), 2 classes: crater (0), boulder (1).
Not trained by or on data from this project.

Verified on this project's own real data before adopting (not assumed to
work): run on the real Tycho NAC pair (M1315458185LE, M1412862267LE) --
282 real crater detections on one frame (confidence up to 0.66, radius
10-35px), 21 on the other at a low (0.01) confidence threshold -- a real,
working signal, unlike this project's own from-scratch fine-tune attempt
(285 training instances across only 5 real images -- mAP50 0.0012, zero
detections on the same Tycho pair). See TASKS.md "Crater-neighborhood
structural matcher" for the full comparison.
