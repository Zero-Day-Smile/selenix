// workspace_components/InterpretationCard.tsx
//
// Shared display for all 4 real-time Groq interpretations. Fetches once
// when `payload` changes (a new pipeline result), shows a loading state,
// then the real interpretation text + attribution. If Groq wasn't
// reachable (no API key configured, network error, rate limit) this
// renders nothing at all rather than a placeholder message -- the rest of
// the UI reads its own real data independent of whether this call
// succeeds, so an unavailable interpretation just means one less card,
// never an error the user has to parse.
import { useEffect, useRef, useState } from 'react';
import { interpretMetrics, type InterpretResult } from '../services/api';

export default function InterpretationCard({
  callType,
  fields,
  prominent = false,
}: {
  callType: 1 | 2 | 3 | 4 | 5;
  fields: Record<string, unknown>;
  // Call 3 (the registration verdict) is the most visible -- styled
  // larger per the task spec, everything else is the smaller default.
  prominent?: boolean;
}) {
  const [result, setResult] = useState<InterpretResult | null>(null);
  const fieldsKey = JSON.stringify(fields);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const reqId = ++reqIdRef.current;
    setResult(null);
    interpretMetrics(callType, fields).then((r) => {
      if (reqIdRef.current === reqId) setResult(r);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callType, fieldsKey]);

  const base = prominent
    ? 'bg-gray-50 border border-gray-200 dark:bg-white/[0.03] dark:border-white/10 rounded-sm p-4'
    : 'bg-gray-50 border border-gray-200 dark:bg-white/[0.02] dark:border-white/5 rounded-sm p-3';
  const loading = result == null;

  // Nothing to show and nothing in flight -- render nothing, not an
  // "unavailable" placeholder box.
  if (result != null && !result.available) return null;

  return (
    <div
      className={`${base} ${loading ? 'animate-pulse-slow' : ''}`}
      // 4px left border -- visually distinguishes this Groq
      // interpretation card from the chart cards around it.
      style={{ borderLeft: '4px solid #0E0E0E' }}
    >
      <style>{`
        @keyframes pulse-slow-bg {
          0%, 100% { background-color: rgba(255,255,255,0.02); }
          50% { background-color: rgba(14,14,14,0.06); }
        }
        .animate-pulse-slow { animation: pulse-slow-bg 1.6s ease-in-out infinite; }
      `}</style>
      <div className={`flex items-center gap-1.5 mb-1.5 ${prominent ? 'text-[10px]' : 'text-[9px]'} font-mono uppercase tracking-widest text-gray-500`}>
        {/* Small Groq attribution mark -- text badge, not an external image
            (no CDN/logo asset dependency, and this app's strict-origin
            constraints elsewhere this session make a hotlinked logo the
            wrong call anyway). */}
        <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm bg-orange-500 text-white text-[7px] font-bold shrink-0">G</span>
        AI Interpretation
      </div>

      {loading && (
        // Breathing skeleton, not a spinner -- two placeholder lines
        // pulsing opacity while the real Groq call is in flight.
        <div className="space-y-1.5">
          <div className="h-2.5 rounded-sm bg-gray-300/60 dark:bg-white/10 w-full" />
          <div className="h-2.5 rounded-sm bg-gray-300/60 dark:bg-white/10 w-4/5" />
        </div>
      )}
      {result != null && result.available && result.text && (
        <>
          <p className={`italic text-gray-600 dark:text-gray-300 leading-relaxed ${prominent ? 'text-sm' : 'text-xs'}`}>
            {result.text}
          </p>
          {/* Real model actually serving this text -- kept in sync with
              backend/pipeline/groq_interpret.py::GROQ_MODEL. The task's
              originally-specified llama-3.3-70b-versatile no longer exists
              on Groq's real API (confirmed via a real /v1/models query
              against this project's own key) -- this label must never
              claim a model that isn't the one actually generating the
              text above. */}
          <p className="text-[9px] text-gray-500 mt-2">Interpreted by Groq (openai/gpt-oss-120b) from real pipeline metrics</p>
        </>
      )}
    </div>
  );
}
