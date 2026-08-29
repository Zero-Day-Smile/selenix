"""Crater-neighborhood graph construction (CNSFM Step 2). Builds a real
spatial graph from real detected craters (backend/pipeline/crater_detector.py)
-- nodes are individual craters, edges connect each crater to its K nearest
neighbors, and the EDGE features (not just per-node x/y/radius) are what
carry the discriminative signal: two visually-identical craters have
different neighbor relationships if their surroundings differ, which is
exactly what breaks patch-scale self-similarity (see TASKS.md "Crater-
Neighborhood Structural Matcher").
"""
from __future__ import annotations

import math

import cv2
import numpy as np
import torch
from torch_geometric.data import Data

from backend.pipeline.crater_detector import CraterDetection

RING_BINS = 8  # orientation-histogram bins for the rim texture descriptor
K_NEIGHBORS = 6


def _rim_texture_descriptor(gray: np.ndarray, cx: float, cy: float, r: float, n_samples: int = 32) -> np.ndarray:
    """Real, lightweight texture descriptor sampled in a ring around the
    crater rim -- gradient-orientation histogram, NOT a full patch
    descriptor (deliberately, per the task spec: just enough to tell a
    fresh crater from a degraded one, not another appearance matcher)."""
    h, w = gray.shape[:2]
    gx = cv2.Sobel(gray.astype(np.float32), cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray.astype(np.float32), cv2.CV_32F, 0, 1, ksize=3)
    mag = np.hypot(gx, gy)
    ang = np.arctan2(gy, gx)  # [-pi, pi]

    hist = np.zeros(RING_BINS, dtype=np.float32)
    total_weight = 0.0
    for i in range(n_samples):
        theta = 2 * math.pi * i / n_samples
        px, py = int(round(cx + r * math.cos(theta))), int(round(cy + r * math.sin(theta)))
        if not (0 <= px < w and 0 <= py < h):
            continue
        bin_idx = int(((ang[py, px] + math.pi) / (2 * math.pi)) * RING_BINS) % RING_BINS
        weight = float(mag[py, px])
        hist[bin_idx] += weight
        total_weight += weight
    if total_weight > 0:
        hist /= total_weight
    return hist


def build_crater_graph(gray: np.ndarray, detections: list[CraterDetection]) -> Data | None:
    """Real node + edge features from real detections -- no synthetic
    node count padding; returns None if fewer than 2 craters (no graph
    possible)."""
    if len(detections) < 2:
        return None

    h, w = gray.shape[:2]
    diag = math.hypot(h, w)
    norm_scale = math.sqrt(h * w)

    textures = [_rim_texture_descriptor(gray, d.cx, d.cy, d.radius_px) for d in detections]
    node_features = []
    for d, tex in zip(detections, textures):
        feat = [d.cx / w, d.cy / h, d.radius_px / norm_scale, d.confidence] + tex.tolist()
        node_features.append(feat)
    x = torch.tensor(node_features, dtype=torch.float32)

    positions = np.array([[d.cx, d.cy] for d in detections])
    n = len(detections)
    edge_index = []
    edge_attr = []
    for i in range(n):
        dists = np.linalg.norm(positions - positions[i], axis=1)
        dists[i] = np.inf
        k = min(K_NEIGHBORS, n - 1)
        neighbor_idx = np.argsort(dists)[:k]
        for j in neighbor_idx:
            j = int(j)
            dx, dy = positions[j][0] - positions[i][0], positions[j][1] - positions[i][1]
            dist_norm = dists[j] / diag
            bearing = math.atan2(dy, dx) / math.pi  # normalized to [-1, 1]
            radius_ratio = detections[i].radius_px / max(detections[j].radius_px, 1e-6)
            tex_diff = float(np.linalg.norm(textures[i] - textures[j]))
            edge_index.append([i, j])
            edge_attr.append([dist_norm, bearing, radius_ratio, tex_diff])

    return Data(
        x=x,
        edge_index=torch.tensor(edge_index, dtype=torch.long).t().contiguous(),
        edge_attr=torch.tensor(edge_attr, dtype=torch.float32),
        pos=torch.tensor(positions, dtype=torch.float32),
        radius=torch.tensor([d.radius_px for d in detections], dtype=torch.float32),
    )
