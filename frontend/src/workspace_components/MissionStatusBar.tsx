// workspace_components/MissionStatusBar.tsx
//
// Persistent "mission status" strip for the pipeline flow (Idea 2): current
// stage name and a mini 5-dot pipeline diagram (current stage highlighted,
// completed green, upcoming gray) connected by a line -- styled to read as
// a ground-control status strip rather than a form-wizard's step tabs. A
// dot pulses green once, briefly, the moment its stage newly completes.
import React, { useEffect, useRef, useState } from 'react';

export default function MissionStatusBar({
  steps,
  currentStep,
  completedUpTo,
}: {
  steps: string[];
  currentStep: number;
  completedUpTo: number[];
}) {
  const completedSet = new Set(completedUpTo);
  const prevCompletedRef = useRef<Set<number>>(new Set());
  const [justCompleted, setJustCompleted] = useState<number | null>(null);

  useEffect(() => {
    const newlyDone = [...completedSet].find((i) => !prevCompletedRef.current.has(i));
    prevCompletedRef.current = completedSet;
    if (newlyDone != null) {
      setJustCompleted(newlyDone);
      const t = setTimeout(() => setJustCompleted(null), 900);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedUpTo.join(',')]);

  return (
    <div className="sticky top-0 z-40 bg-white/90 dark:bg-[#0a0b0f]/90 backdrop-blur-md border-b border-gray-200 dark:border-white/10">
      <style>{`
        @keyframes mission-dot-pulse {
          0% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.7); }
          70% { box-shadow: 0 0 0 8px rgba(74, 222, 128, 0); }
          100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0); }
        }
        .mission-dot-pulse { animation: mission-dot-pulse 0.9s ease-out; }
      `}</style>
      <div className="max-w-6xl mx-auto px-6 py-2.5 flex items-center justify-between gap-6">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-[#0E0E0E] dark:bg-white animate-pulse shrink-0" />
          <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500 shrink-0">Stage</span>
          <span className="text-[11px] font-mono uppercase tracking-widest text-[#0E0E0E] dark:text-white truncate">{steps[currentStep]}</span>
        </div>

        {/* Mini pipeline diagram: dots connected by a line */}
        <div className="flex items-center flex-1 max-w-md">
          {steps.map((label, i) => {
            const isCurrent = i === currentStep;
            const isDone = completedSet.has(i) && !isCurrent;
            const color = isCurrent ? 'bg-[#0E0E0E] dark:bg-white' : isDone ? 'bg-green-400' : 'bg-gray-600';
            return (
              <React.Fragment key={label}>
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${color} ${isCurrent ? 'ring-2 ring-[#0E0E0E]/30 dark:ring-white/30' : ''} ${
                      justCompleted === i ? 'mission-dot-pulse' : ''
                    }`}
                    title={label}
                  />
                  <span className={`text-[8px] font-mono uppercase tracking-wide hidden sm:block ${isCurrent ? 'text-[#0E0E0E] dark:text-white' : isDone ? 'text-green-400/80' : 'text-gray-600'}`}>
                    {label}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <div className={`flex-1 h-px mx-1 ${i < currentStep ? 'bg-green-400/50' : 'bg-gray-700'}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
