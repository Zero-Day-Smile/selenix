"""Lightweight GNN descriptor (CNSFM Step 3) -- 3 layers of edge-feature-
aware graph attention (GATv2Conv, from torch_geometric -- message passing
is NOT reimplemented from scratch, per the task spec), producing a
128-dim descriptor per crater node that encodes both that crater's own
local properties and its spatial relationship to its neighbors.

Training signal: REAL cross-image crater correspondence, not synthetic
pairs -- a real Robbins-catalog crater has its own independently-computed
real pixel position in each real image (via that image's own real
geometry: geometry.csv for CH2, KML-corner bilinear fit for NAC), so the
same catalog crater_id appearing in two real, real-overlapping images IS
a real correspondence, without needing a synthetic relit variant. See
backend/scripts/train_crater_gnn.py for how this is actually used, and
TASKS.md for how much real training signal that provides (honestly, not
much -- reported as-is).
"""
from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import GATv2Conv

NODE_IN_DIM = 12   # 4 base features (cx/w, cy/h, r/norm, confidence) + 8 rim-texture bins
EDGE_DIM = 4       # dist_norm, bearing, radius_ratio, texture_diff
OUT_DIM = 128


class CraterGNN(nn.Module):
    def __init__(self, in_dim: int = NODE_IN_DIM, edge_dim: int = EDGE_DIM,
                 hidden: int = 64, out_dim: int = OUT_DIM, heads: int = 4):
        super().__init__()
        self.gat1 = GATv2Conv(in_dim, hidden, heads=heads, edge_dim=edge_dim, concat=True)
        self.gat2 = GATv2Conv(hidden * heads, hidden, heads=heads, edge_dim=edge_dim, concat=True)
        self.gat3 = GATv2Conv(hidden * heads, out_dim, heads=1, edge_dim=edge_dim, concat=False)

    def forward(self, x, edge_index, edge_attr):
        h = F.elu(self.gat1(x, edge_index, edge_attr))
        h = F.elu(self.gat2(h, edge_index, edge_attr))
        h = self.gat3(h, edge_index, edge_attr)
        return F.normalize(h, dim=-1)  # unit-norm descriptors -> cosine distance == Euclidean on the sphere
