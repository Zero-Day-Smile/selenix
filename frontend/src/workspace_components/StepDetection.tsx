// workspace_components/StepDetection.tsx
import React, { useMemo, useRef, useState } from 'react';
import type { WorkspaceData } from './types';
import { useOsdViewer } from './useOsdViewer';
import OsdPointOverlay from './OsdPointOverlay';
import CorrespondenceCanvas, { type CorrespondencePoint } from './CorrespondenceCanvas';

export default function StepDetection({ data }: { data: WorkspaceData }) {
  const [mode, setMode] = useState<'lines' | 'zoom'>('zoom');

  const srcImg = data.srcProcessedUrl || data.sourceUrl;
  const refImg = data.refProcessedUrl || data.refUrl;
  const srcShape = data.srcShape;
  const refShape = data.refShape;

  const srcElRef = useRef<HTMLDivElement>(null);
  const refElRef = useRef<HTMLDivElement>(null);
  const srcViewer = useOsdViewer(srcElRef, mode === 'zoom' ? srcImg : null);
  const refViewer = useOsdViewer(refElRef, mode === 'zoom' ? refImg : null);

  // Detection shows the matcher's raw output, BEFORE geometric verification --
  // colored by match confidence only, never by inlier/outlier. That verdict
  // doesn't exist yet at this stage; it's what the next step (RANSAC) computes.
  // Coloring these by p.inlier would show the RANSAC step's answer one step
  // early and make the two panels look like duplicates of each other.
  const confidences = data.matchPoints.map((p) => p.confidence).filter((c): c is number => c != null);
  const hasConfidence = confidences.length > 0;
  const colorForConfidence = (c: number | null) => {
    if (c == null) return { color: '#f59e0b', opacity: 0.75 };
    return { color: '#f59e0b', opacity: 0.3 + 0.6 * Math.max(0, Math.min(1, c)) };
  };
  const srcOverlayPoints = useMemo(
    () => data.matchPoints.map((p) => ({ x: p.src_x, y: p.src_y, ...colorForConfidence(p.confidence) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.matchPoints]
  );
  const refOverlayPoints = useMemo(
    () => data.matchPoints.map((p) => ({ x: p.ref_x, y: p.ref_y, ...colorForConfidence(p.confidence) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.matchPoints]
  );

  const linePoints: CorrespondencePoint[] = useMemo(
    () =>
      data.matchPoints.map((p) => {
        const c = p.confidence ?? 0.6;
        const { color, opacity } = colorForConfidence(p.confidence);
        return {
          src_x: p.src_x,
          src_y: p.src_y,
          ref_x: p.ref_x,
          ref_y: p.ref_y,
          color,
          opacity,
          dotRadius: 3,
          lineWidth: 1,
          lineOpacity: 0.15 + 0.45 * Math.max(0, Math.min(1, c)),
          sortWeight: c,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.matchPoints]
  );

  return (
    <div>
      <div className="bg-white border border-gray-200 p-6 shadow-sm rounded-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold tracking-wide uppercase text-gray-700">Candidate matches (pre-verification)</h3>
          <ModeToggle mode={mode} setMode={setMode} />
        </div>

        {mode === 'lines' && srcImg && refImg && srcShape && refShape ? (
          <CorrespondenceCanvas srcUrl={srcImg} refUrl={refImg} srcShape={srcShape} refShape={refShape} points={linePoints} capLabel="match" />
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Source</span>
              <div className="relative h-[380px] overflow-hidden rounded-sm">
                <div ref={srcElRef} className="w-full h-full border border-gray-300 bg-black" />
                <OsdPointOverlay viewer={srcViewer} points={srcOverlayPoints} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Reference</span>
              <div className="relative h-[380px] overflow-hidden rounded-sm">
                <div ref={refElRef} className="w-full h-full border border-gray-300 bg-black" />
                <OsdPointOverlay viewer={refViewer} points={refOverlayPoints} />
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-between mt-4 text-xs text-gray-500">
          <span>Keypoints (source): {data.keypointsSource}</span>
          <span>Keypoints (reference): {data.keypointsRef}</span>
          <span>Candidate matches: {data.candidateMatches}</span>
        </div>
        <p className="text-[10px] text-gray-400 mt-2">
          {mode === 'lines'
            ? 'Lines connect each candidate match across the two images; brightness/opacity encode match confidence.'
            : 'Both panes fill the frame at the same height by default — zoom out or use the home button to see the whole image, pan/zoom either pane independently.'}{' '}
          {hasConfidence
            ? ''
            : "This run's matcher doesn't report per-match confidence, so all points/lines show at a fixed brightness. "}
          Before geometric verification — which of these are inliers vs outliers is what the next step, RANSAC, determines, not shown here.
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
        <Stat label="Keypoints (source)" value={data.keypointsSource} />
        <Stat label="Keypoints (ref)" value={data.keypointsRef} />
        <Stat label="Candidate matches" value={data.candidateMatches} />
        <Stat
          label="Mean match confidence"
          value={hasConfidence ? (confidences.reduce((s, c) => s + c, 0) / confidences.length).toFixed(2) : 'n/a'}
        />
      </div>
    </div>
  );
}

const ModeToggle = ({ mode, setMode }: { mode: 'lines' | 'zoom'; setMode: (m: 'lines' | 'zoom') => void }) => (
  <div className="flex text-[10px] font-mono uppercase tracking-wide border border-gray-300 rounded-sm overflow-hidden">
    <button
      onClick={() => setMode('lines')}
      className={`px-3 py-1.5 ${mode === 'lines' ? 'bg-black text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
    >
      Correspondence lines
    </button>
    <button
      onClick={() => setMode('zoom')}
      className={`px-3 py-1.5 border-l border-gray-300 ${mode === 'zoom' ? 'bg-black text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
    >
      Zoom &amp; pan
    </button>
  </div>
);

const Stat = ({ label, value }: { label: string; value: number | string }) => (
  <div className="bg-white border border-gray-200 p-4 shadow-sm rounded-sm">
    <div className="font-mono text-2xl font-bold text-black">{value}</div>
    <div className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</div>
  </div>
);
