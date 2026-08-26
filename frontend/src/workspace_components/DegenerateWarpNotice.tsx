// workspace_components/DegenerateWarpNotice.tsx
//
// Shown instead of a warped-image/heatmap panel when the backend's homography
// condition-number check flags the transform as near-singular. A degenerate
// homography throws part of the warped image toward the projective line at
// infinity, producing a split, radiating-streak pattern -- visually
// indistinguishable from a rendering bug if shown without context. This is a
// hard replacement (the caller must not render the image at all when
// `degenerate` is true), not an overlay, so a screenshot of just this panel
// is still self-evidently a failure state on its own.
import type { WorkspaceData } from './types';

export default function DegenerateWarpNotice({ hq }: { hq: NonNullable<WorkspaceData['homographyQuality']> }) {
  return (
    <div className="border border-red-300 bg-red-50 rounded-sm p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-red-700">
        Degenerate homography — matching failed, transform is not geometrically valid
      </p>
      <p className="text-[11px] text-red-800 mt-2 leading-relaxed">
        The estimated transform is near-singular — warping the source image through it produces a
        split, radiating-streak pattern (parts of the image thrown toward the projective line at
        infinity), not a real alignment. Rendering it here would be indistinguishable from a
        rendering bug, so this panel is suppressed instead. This is a data-driven verdict:
      </p>
      <ul className="text-[11px] font-mono text-red-800 mt-2 space-y-0.5 list-disc list-inside">
        <li>
          homography condition ratio (largest/smallest singular value):{' '}
          <span className="font-bold">{hq.conditionRatio.toFixed(2)}:1</span> (threshold: {hq.threshold}:1)
        </li>
      </ul>
    </div>
  );
}
