// workspace_components/StepRegistration.tsx
import React, { useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import type { WorkspaceData } from './types';

export default function StepRegistration({ data }: { data: WorkspaceData }) {
  const [blend, setBlend] = useState(50);

  const refImg = data.refProcessedUrl || data.refUrl;
  // Prefer the backend's real warped output; only fall back to an approximate
  // source preview when running in simulation mode / no real warp is available.
  const hasRealWarp = !!data.registeredGlobalUrl && !data.simulationMode;
  const warpedImg = hasRealWarp ? data.registeredGlobalUrl : data.srcProcessedUrl || data.sourceUrl;

  const elRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const warpedItemRef = useRef<OpenSeadragon.TiledImage | null>(null);

  useEffect(() => {
    if (!refImg || !warpedImg || !elRef.current) return;
    const viewer = OpenSeadragon({
      element: elRef.current,
      showNavigationControl: true,
      prefixUrl: '/openseadragon-images/',
      homeFillsViewer: true,
      visibilityRatio: 1,
      minZoomImageRatio: 0.3,
      defaultZoomLevel: 0,
      gestureSettingsMouse: { clickToZoom: false },
      drawer: 'canvas',
      tileSources: { type: 'image', url: refImg },
    });
    viewerRef.current = viewer;
    viewer.addOnceHandler('open', () => {
      viewer.addTiledImage({
        tileSource: { type: 'image', url: warpedImg },
        opacity: blend / 100,
        success: (e) => {
          warpedItemRef.current = e.item;
        },
      });
    });
    return () => {
      viewer.destroy();
      viewerRef.current = null;
      warpedItemRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refImg, warpedImg]);

  useEffect(() => {
    warpedItemRef.current?.setOpacity(blend / 100);
  }, [blend]);

  const { rotation, scale, tx, ty } = data.transformParams;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-white border border-gray-200 p-6 shadow-sm rounded-sm">
        <h3 className="text-xs font-bold tracking-wide uppercase mb-4">
          {hasRealWarp ? 'Warped source over reference' : 'Approximate warp preview (simulated)'}
        </h3>
        <div ref={elRef} className="w-full h-[420px] border border-gray-300 rounded-sm overflow-hidden bg-black" />
        <div className="flex items-center gap-4 mt-4">
          <span className="text-xs text-gray-500">Reference</span>
          <input type="range" min="0" max="100" value={blend} onChange={(e) => setBlend(parseInt(e.target.value))} className="flex-1 accent-black" />
          <span className="text-xs text-gray-500">Warped source</span>
        </div>
        <p className="text-[10px] text-gray-400 mt-2">
          Both layers are real images in one pannable/zoomable viewer — fills the frame by default; zoom out or use
          the home button to see the whole, uncropped pair. The slider cross-fades the warped source over the
          reference.
        </p>
        {!hasRealWarp && (
          <p className="text-[10px] text-amber-600 mt-2">
            No real warped raster available — showing the unwarped source preview instead of a true per-pixel warp.
          </p>
        )}
      </div>
      <div className="bg-white border border-gray-200 p-6 shadow-sm rounded-sm">
        <h3 className="text-xs font-bold tracking-wide uppercase mb-4">Estimated homography</h3>
        <div className="grid grid-cols-3 gap-2 bg-gray-50 p-4 border border-gray-200 font-mono text-xs text-center">
          {data.homography.flat().map((v, i) => (
            <div key={i}>{typeof v === 'number' ? v.toFixed(4) : v}</div>
          ))}
        </div>
        <div className="mt-6 space-y-2">
          <Param label="Rotation θ (from homography)" value={`${rotation.toFixed(2)}°`} />
          <Param label="Scale factor (from homography)" value={`${scale.toFixed(3)}×`} />
          <Param label="Scale factor (dimension-based)" value={`${data.metrics.scaleFactorDimensionBased.toFixed(3)}×`} />
          <Param label="Translation (tx, ty)" value={`${tx.toFixed(1)}, ${ty.toFixed(1)} px`} />
          <Param label="Post-refinement RMSE" value={`${data.transformParams.residualRMS.toFixed(3)} px`} />
        </div>
      </div>
    </div>
  );
}

const Param = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between text-xs border-b border-gray-100 py-1">
    <span className="text-gray-500">{label}</span>
    <span className="font-mono">{value}</span>
  </div>
);
