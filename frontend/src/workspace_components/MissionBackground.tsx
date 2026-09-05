import { memo } from 'react';

const MissionBackground = memo(() => {
  return (
    <>
      <style>{`
        @keyframes moon-bg-pan {
          from { background-position-x: 0; }
          to { background-position-x: -3600px; }
        }
      `}</style>
      
      {/* Base Layer: Dark/Light Mode Deep Gradient */}
      <div className="fixed inset-0 pointer-events-none -z-20 bg-white dark:bg-[#0a0b0f] transition-colors duration-500" />

      {/* Texture Layer: Panning Lunar Surface */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none -z-10 opacity-[0.15] dark:opacity-[0.35] mix-blend-multiply dark:mix-blend-screen"
        style={{
          backgroundImage: 'url(/assets/moon-bg.jpg)',
          backgroundRepeat: 'repeat-x',
          backgroundSize: 'auto 100%',
          animation: 'moon-bg-pan 120s linear infinite',
          filter: 'grayscale(1) contrast(1.2)',
        }}
      />

      {/* Vignette Layer: Softens top/bottom seams and focuses the center */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none z-0 bg-[radial-gradient(ellipse_at_center,_transparent_40%,_rgba(255,255,255,0.85)_100%)] dark:bg-[radial-gradient(ellipse_at_center,_transparent_40%,_rgba(10,11,15,0.95)_100%)]"
      />
    </>
  );
});

MissionBackground.displayName = 'MissionBackground';

// THIS LINE IS CRITICAL - It provides the "default" export the error says is missing
export default MissionBackground;