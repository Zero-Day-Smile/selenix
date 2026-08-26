// workspace_components/OsdPointOverlay.tsx
//
// Draws colored dot markers over an OpenSeadragon viewer at real image
// pixel coordinates, kept in sync with that viewer's own pan/zoom via
// OpenSeadragon's viewport->viewer-element coordinate transform. Each
// pane gets its own overlay (rather than a single overlay with lines
// connecting the two panes) because once each viewer has independent
// zoom/pan, a straight line drawn across two independently-transformed
// viewports stops representing anything geometrically meaningful -- it
// would only look right when both panes happen to be at their home view.
import { useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';

export interface OverlayPoint {
  x: number;
  y: number;
  color: string;
  opacity: number;
}

export default function OsdPointOverlay({
  viewer,
  points,
}: {
  viewer: OpenSeadragon.Viewer | null;
  points: OverlayPoint[];
}) {
  const [screenPoints, setScreenPoints] = useState<(OverlayPoint & { sx: number; sy: number })[]>([]);
  const pointsRef = useRef(points);
  pointsRef.current = points;

  useEffect(() => {
    if (!viewer) return;
    const recompute = () => {
      const next = pointsRef.current.map((p) => {
        const px = viewer.viewport.imageToViewerElementCoordinates(new OpenSeadragon.Point(p.x, p.y));
        return { ...p, sx: px.x, sy: px.y };
      });
      setScreenPoints(next);
    };
    recompute();
    viewer.addHandler('animation', recompute);
    viewer.addHandler('open', recompute);
    viewer.addHandler('resize', recompute);
    return () => {
      viewer.removeHandler('animation', recompute);
      viewer.removeHandler('open', recompute);
      viewer.removeHandler('resize', recompute);
    };
  }, [viewer, points]);

  return (
    <div className="absolute inset-0 pointer-events-none">
      {screenPoints.map((p, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            left: p.sx - 3,
            top: p.sy - 3,
            width: 6,
            height: 6,
            background: p.color,
            opacity: p.opacity,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
          }}
        />
      ))}
    </div>
  );
}
