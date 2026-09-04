// workspace_components/ShadowCoverageCard.tsx
//
// Surfaces backend/pipeline/shadow.py's existing per-image shadow
// detection in the area report -- it was already computed on every real
// run but never shown anywhere in the frontend before this. The real %
// shadowed comes directly from shadow.py's own shadow_fraction output
// (see WorkspaceData.shadowAnalysis), never estimated here. The diagram
// reuses ShadowRegionOverlay.tsx (the same clickable-region overlay
// StepDetection.tsx already uses) rather than rebuilding shadow
// rendering from scratch -- composed here with the same useOsdViewer /
// useShadowOverlayLayer hooks that drive it there.
//
// Only rendered when data.shadowAnalysis is actually present, i.e. only
// for a real backend run shadow.py actually ran on -- never fabricates a
// percentage for a frame it wasn't computed on (simulation mode, or no
// run yet, both leave shadowAnalysis null and this component renders
// nothing).
import { useRef } from 'react';
import OpenSeadragon from 'openseadragon';
import type { ShadowStats } from '../services/api';
import { useOsdViewer } from './useOsdViewer';
import { useShadowOverlayLayer } from './useShadowOverlayLayer';
import ShadowRegionOverlay from './ShadowRegionOverlay';

function SideShadowPanel({
  label, imgUrl, overlayUrl, stats,
}: {
  label: string;
  imgUrl: string | null;
  overlayUrl: string | null;
  stats: ShadowStats;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const viewer: OpenSeadragon.Viewer | null = useOsdViewer(elRef, imgUrl);
  useShadowOverlayLayer(viewer, overlayUrl, 0.85);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-bold uppercase tracking-widest text-gray-500">{label}</span>
        <span className="font-mono text-xs font-bold text-orange-500 dark:text-orange-300">
          {(stats.shadow_fraction * 100).toFixed(1)}% shadowed
        </span>
      </div>
      <div
        className="relative w-full rounded-sm overflow-hidden border border-gray-200 dark:border-white/10 bg-black/5"
        style={{ height: 170 }}
      >
        <div ref={elRef} className="absolute inset-0" />
        <ShadowRegionOverlay viewer={viewer} regions={stats.regions} sunAngleContext={stats.sun_angle_context} />
      </div>
    </div>
  );
}

export interface ShadowCoverageCardProps {
  shadowAnalysis: { src: ShadowStats; ref: ShadowStats } | null;
  srcImgUrl: string | null;
  refImgUrl: string | null;
  srcShadowOverlayUrl: string | null;
  refShadowOverlayUrl: string | null;
}

export default function ShadowCoverageCard({
  shadowAnalysis, srcImgUrl, refImgUrl, srcShadowOverlayUrl, refShadowOverlayUrl,
}: ShadowCoverageCardProps) {
  // Only for images shadow.py actually ran on -- never render a made-up
  // section for a run that has no real shadow_analysis at all.
  if (!shadowAnalysis) return null;

  return (
    <div className="bg-white border border-gray-200 dark:bg-white/[0.04] dark:backdrop-blur-md dark:border-white/10 rounded-sm p-4 text-xs">
      <h4 className="text-[9px] font-bold tracking-widest uppercase text-gray-500 mb-2">Shadow coverage</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <SideShadowPanel label="Source" imgUrl={srcImgUrl} overlayUrl={srcShadowOverlayUrl} stats={shadowAnalysis.src} />
        <SideShadowPanel label="Reference" imgUrl={refImgUrl} overlayUrl={refShadowOverlayUrl} stats={shadowAnalysis.ref} />
      </div>
      <p className="text-[9px] text-gray-500 leading-relaxed mt-3 pt-2 border-t border-gray-200 dark:border-white/10">
        Shadow detected in this single image at time of capture. This is not a permanently shadowed region (PSR)
        analysis, PSR identification requires multi-temporal data this project does not currently model.
      </p>
    </div>
  );
}
