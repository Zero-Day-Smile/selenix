// workspace_components/StepUpload.tsx
import React, { useEffect, useState } from 'react';
import type { WorkspaceData } from './types';
import ImageUpload from './ImageUpload';
import { PIPELINE_STAGES, type RunParams } from '../services/api';

interface Props {
  data: WorkspaceData;
  setData: React.Dispatch<React.SetStateAction<WorkspaceData>>;
  loading: boolean;
  onRun: (params: RunParams) => void;
  runError: string | null;
  backendAvailable: boolean | null;
  activeStageIndex: number;
  checkBackendHealth: () => Promise<boolean>;
}

export default function StepUpload({
  data,
  setData,
  loading,
  onRun,
  runError,
  backendAvailable,
  activeStageIndex,
  checkBackendHealth,
}: Props) {
  const [matcher, setMatcher] = useState<RunParams['matcher']>('auto');
  const [illumMode, setIllumMode] = useState<RunParams['illum_mode']>('gradient');
  const [sensorType, setSensorType] = useState<RunParams['sensor_type']>('ohrc');
  const [healthy, setHealthy] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    checkBackendHealth().then((ok) => {
      if (!cancelled) setHealthy(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [checkBackendHealth]);

  const handleFileChange = (field: 'source' | 'ref', file: File | null) => {
    setData((prev) => ({
      ...prev,
      [field === 'source' ? 'sourceFile' : 'refFile']: file,
      [field === 'source' ? 'sourceUrl' : 'refUrl']: file ? URL.createObjectURL(file) : null,
    }));
  };

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ImageUpload
          label="Source Image (Moving)"
          file={data.sourceFile}
          onFileChange={(f) => handleFileChange('source', f)}
          disabled={loading}
          previewUrl={data.sourceUrl}
        />
        <ImageUpload
          label="Reference Image (Fixed)"
          file={data.refFile}
          onFileChange={(f) => handleFileChange('ref', f)}
          disabled={loading}
          previewUrl={data.refUrl}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 bg-white border border-gray-200 p-4 shadow-sm rounded-sm">
        <Select
          label="Matcher"
          value={matcher}
          onChange={(v) => setMatcher(v as RunParams['matcher'])}
          disabled={loading}
          options={[
            { value: 'auto', label: 'Auto (best of classical + deep)' },
            { value: 'classical', label: 'Classical (SIFT)' },
            { value: 'deep', label: 'Deep (LoFTR)' },
          ]}
        />
        <Select
          label="Illumination normalization"
          value={illumMode}
          onChange={(v) => setIllumMode(v as RunParams['illum_mode'])}
          disabled={loading}
          options={[
            { value: 'gradient', label: 'Shading removal (gradient)' },
            { value: 'clahe', label: 'CLAHE' },
            { value: 'both', label: 'Both' },
            { value: 'none', label: 'None' },
          ]}
        />
        <Select
          label="Sensor type"
          value={sensorType}
          onChange={(v) => setSensorType(v as RunParams['sensor_type'])}
          disabled={loading}
          options={[
            { value: 'ohrc', label: 'OHRC (Chandrayaan-2)' },
            { value: 'tmc', label: 'TMC' },
            { value: 'iirs', label: 'IIRS' },
            { value: 'nac', label: 'LRO NAC' },
          ]}
        />
      </div>

      <div className="flex items-center justify-between mt-4">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest">
          <span className={`w-2 h-2 rounded-full ${healthy ? 'bg-green-500' : healthy === false ? 'bg-amber-500' : 'bg-gray-300'}`} />
          <span className="text-gray-500">
            {healthy === null ? 'Checking backend…' : healthy ? 'Backend reachable' : 'Backend unreachable — will simulate'}
          </span>
        </div>
        <button
          onClick={() => onRun({ matcher, illum_mode: illumMode, sensor_type: sensorType })}
          disabled={!data.sourceFile || !data.refFile || loading}
          className="px-6 py-3 text-xs font-bold tracking-wide rounded-sm bg-black text-white hover:opacity-80 disabled:bg-gray-300 disabled:text-gray-500"
        >
          {loading ? 'Running…' : 'Run Pipeline →'}
        </button>
      </div>

      {loading && (
        <div className="mt-6 bg-white border border-gray-200 p-5 shadow-sm rounded-sm">
          <h3 className="text-[10px] font-bold tracking-widest uppercase mb-3 text-gray-500">Pipeline progress</h3>
          <ul className="space-y-2">
            {PIPELINE_STAGES.map((stage, i) => {
              const state = i < activeStageIndex ? 'done' : i === activeStageIndex ? 'active' : 'pending';
              return (
                <li key={stage} className="flex items-center gap-3 text-xs">
                  <span
                    className={`w-4 h-4 flex items-center justify-center rounded-full text-[9px] font-mono shrink-0 ${
                      state === 'done'
                        ? 'bg-black text-white'
                        : state === 'active'
                        ? 'border-2 border-black animate-pulse'
                        : 'border border-gray-300 text-gray-300'
                    }`}
                  >
                    {state === 'done' ? '✓' : i + 1}
                  </span>
                  <span className={state === 'pending' ? 'text-gray-400' : 'text-black'}>{stage}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between mt-4">
        {runError && <span className="text-xs text-red-600">Error: {runError}</span>}
        {backendAvailable === false && !loading && (
          <span className="text-xs text-amber-600">
            ⚡ Backend unreachable — showing a simulated pipeline run for demonstration purposes.
          </span>
        )}
        {backendAvailable === true && !loading && data.keypointsSource > 0 && (
          <span className="text-xs text-green-600">✅ Processed by backend</span>
        )}
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold tracking-widest uppercase text-gray-500 block mb-1">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-sm px-2 py-2 text-xs font-mono bg-white disabled:bg-gray-100"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}