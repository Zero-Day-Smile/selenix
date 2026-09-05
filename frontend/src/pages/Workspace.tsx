import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Zap, CheckCircle2, RotateCcw, Trash2 } from 'lucide-react';
import Navbar, { type Page } from '../landing_components/Navbar';
import WorkspaceHeader from '../workspace_components/WorkspaceHeader';
import StepUpload from '../workspace_components/StepUpload';
import StepDetection from '../workspace_components/StepDetection';
import StepRANSAC from '../workspace_components/StepRANSAC';
import StepRegistration from '../workspace_components/StepRegistration';
import StepEvaluation from '../workspace_components/StepEvaluation';
import OrbitalGeometryPanel from '../workspace_components/OrbitalGeometryPanel';
import MissionStatusBar from '../workspace_components/MissionStatusBar';
import MissionBackground from '../workspace_components/MissionBackground';
import { useTheme } from '../workspace_components/useTheme';
import { ThemeProvider } from '../workspace_components/ThemeContext';
import { emptyWorkspaceData, type WorkspaceData } from '../workspace_components/types';
import { processPipelineResult } from '../utils/payloadTransformer';
import {
  runRegistration,
  runSimulatedPipeline,
  checkBackendHealth,
  fetchMatchPoints,
  outputUrl,
  PIPELINE_STAGES,
  type RunParams,
  type RunResultOk,
} from '../services/api';

const STEPS = ['Upload', 'Detection', 'RANSAC', 'Registration', 'Evaluation'];
const SESSION_KEY = 'selenix:lastRun';

function getImageDims(files: File[]): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const imgFile = files.find((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|tiff?|bmp)$/i.test(f.name));
    if (!imgFile) {
      resolve({ w: 800, h: 600 });
      return;
    }
    const url = URL.createObjectURL(imgFile);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => resolve({ w: 800, h: 600 });
    img.src = url;
  });
}

export default function Workspace({ onNavigate }: { onNavigate?: (page: Page) => void }) {
  const { stepIndex } = useParams();
  const navigate = useNavigate();
  const parsedStep = parseInt(stepIndex || '0', 10);
  const currentStep = isNaN(parsedStep) ? 0 : Math.min(STEPS.length - 1, Math.max(0, parsedStep));

  const [loading, setLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);
  const [activeStageIndex, setActiveStageIndex] = useState(-1);
  const [restorableRun, setRestorableRun] = useState<any | null>(null);
  const tickerRef = useRef<number | null>(null);

  const [data, setData] = useState<WorkspaceData>(emptyWorkspaceData());
  const [theme, toggleTheme] = useTheme();

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && !saved.simulationMode && saved.runDirId) {
          setRestorableRun(saved);
        }
      }
    } catch {
      // Ignore parsing errors
    }
  }, []);

  const handleRestoreRun = () => {
    if (!restorableRun) return;
    const runDirId = restorableRun.runDirId;
    setData((prev) => ({
      ...prev,
      ...restorableRun,
      sourceFile: [],
      refFile: [],
      sourceUrl: null,
      refUrl: null,
      srcProcessedUrl: outputUrl(runDirId, 'src_processed.png'),
      refProcessedUrl: outputUrl(runDirId, 'ref_processed.png'),
      registeredGlobalUrl: restorableRun.hasRegisteredGlobalUrl ? outputUrl(runDirId, 'registered_global.png') : null,
      ssimHeatmapUrl: restorableRun.hasSsimHeatmapUrl ? outputUrl(runDirId, 'ssim_heatmap.png') : null,
      ssimHeatmapDataUrl: restorableRun.hasSsimHeatmapDataUrl ? outputUrl(runDirId, 'ssim_heatmap_data.json') : null,
      srcShadowOverlayUrl: restorableRun.hasSrcShadowOverlayUrl ? outputUrl(runDirId, 'src_shadow_overlay.png') : null,
      refShadowOverlayUrl: restorableRun.hasRefShadowOverlayUrl ? outputUrl(runDirId, 'ref_shadow_overlay.png') : null,
      matchPointsCsvUrl: outputUrl(runDirId, 'match_points.csv'),
      metricsJsonUrl: outputUrl(runDirId, 'metrics.json'),
    }));
    setRestorableRun(null);
  };

  const handleDiscardRun = () => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {}
    setRestorableRun(null);
  };

  const isStepComplete = (step: number): boolean => {
    switch (step) {
      case 0: // Upload
        return (data.sourceFile.length > 0 && data.refFile.length > 0) || !!data.runDirId;
      case 1: // Detection
        return data.candidateMatches > 0;
      case 2: // RANSAC
        return data.inliers > 0 && data.inlierRatio > 0;
      case 3: { // Registration
        const h = data.homography;
        return (
          h[0][0] !== 1 || h[0][1] !== 0 || h[0][2] !== 0 ||
          h[1][0] !== 0 || h[1][1] !== 1 || h[1][2] !== 0 ||
          h[2][0] !== 0 || h[2][1] !== 0 || h[2][2] !== 1
        );
      }
      case 4: // Evaluation
        return data.metrics.rmse > 0 || data.ssim.mean > 0;
      default:
        return false;
    }
  };

  const startOptimisticTicker = () => {
    let i = 0;
    setActiveStageIndex(0);
    tickerRef.current = window.setInterval(() => {
      i += 1;
      if (i >= PIPELINE_STAGES.length - 1) {
        if (tickerRef.current) clearInterval(tickerRef.current);
        return;
      }
      setActiveStageIndex(i);
    }, 700);
  };

  const stopTicker = () => {
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
  };

  const runPipeline = async (params: RunParams) => {
    if (data.sourceFile.length === 0 || data.refFile.length === 0) return;
    setLoading(true);
    setRunError(null);
    setBackendAvailable(null);
    setActiveStageIndex(-1);

    const [srcDims, refDims] = await Promise.all([getImageDims(data.sourceFile), getImageDims(data.refFile)]);

    try {
      startOptimisticTicker();
      let result;
      let simulationMode = false;
      let runDirId: string | null = null;
      let matchPoints: any[] = [];
      let pipelineFailedReason: string | null = null;

      try {
        result = await runRegistration(data.sourceFile, data.refFile, params);
        stopTicker();
        setActiveStageIndex(PIPELINE_STAGES.length - 1);
        setBackendAvailable(true);
        runDirId = (result as any).run_dir_id || null;

        if (result.status === 'failed') {
          pipelineFailedReason = `Pipeline could not complete: ${result.reason || 'unknown reason'}`;
        } else if (runDirId) {
          try {
            matchPoints = await fetchMatchPoints(runDirId);
          } catch {
            matchPoints = [];
          }
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Backend error')) {
          throw err;
        }
        console.warn('Backend unreachable, switching to simulation:', err);
        stopTicker();
        setBackendAvailable(false);
        simulationMode = true;
        result = await runSimulatedPipeline(
          params,
          { srcW: srcDims.w, srcH: srcDims.h, refW: refDims.w, refH: refDims.h },
          (idx) => setActiveStageIndex(idx)
        );
        matchPoints = (globalThis as any).__lastSimulatedMatchPoints || [];
      }

      if (pipelineFailedReason) {
        setData((prev) => ({ ...prev, runDirId, simulationMode: false }));
        setRunError(pipelineFailedReason);
        return;
      }

      const payload = processPipelineResult(
        result as RunResultOk,
        data,
        matchPoints,
        simulationMode,
        runDirId,
        srcDims
      );
      
      setData((prev) => ({ ...prev, ...payload }));
      navigate(`/workspace/step/1`);
    } catch (err) {
      setRunError((err as Error).message || 'Unknown error');
    } finally {
      stopTicker();
      setLoading(false);
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <div className="relative min-h-screen text-black dark:text-gray-100 font-sans flex flex-col transition-colors">
        <MissionBackground />
        
        <div className="relative z-10 flex flex-col min-h-screen">
          <Navbar onNavigate={onNavigate} dark={theme === 'dark'} theme={theme} onToggleTheme={toggleTheme} />
          
          <MissionStatusBar
            steps={STEPS}
            currentStep={currentStep}
            completedUpTo={[0, 1, 2, 3, 4].filter((s) => s < currentStep || (s === currentStep && isStepComplete(s)))}
          />
          
          <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-12">
            {restorableRun && (
              <div className="mb-6 bg-[#0E0E0E]/[0.04] dark:bg-white/[0.06] border border-[#0E0E0E]/40 dark:border-white/40 rounded-lg px-5 py-4 flex flex-wrap items-center justify-between gap-4 shadow-sm backdrop-blur-md">
                <div className="flex items-center gap-3">
                  <RotateCcw className="w-5 h-5 text-[#0E0E0E] dark:text-white" />
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    A previous run (<code className="font-bold text-gray-900 dark:text-white px-1.5 py-0.5 bg-white dark:bg-black/30 rounded">{restorableRun.runDirId}</code>) is available from your session.
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={handleDiscardRun}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors focus:outline-none"
                    aria-label="Discard Run"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleRestoreRun}
                    className="px-4 py-2 bg-[#0E0E0E] hover:opacity-80 dark:bg-white dark:text-[#0E0E0E] text-white text-sm font-semibold rounded-md shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[#0E0E0E] dark:focus:ring-white focus:ring-offset-2 dark:focus:ring-offset-[#0a0b0f]"
                  >
                    Restore Run
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <WorkspaceHeader
                stage={`0${currentStep + 1}/05`}
                title={STEPS[currentStep]}
                description={
                  currentStep === 0
                    ? 'Upload the Source and Reference images. Then run the pipeline to get results.'
                    : currentStep === 1
                    ? 'Keypoints detected on both images (illumination-normalized). Candidate matches shown.'
                    : currentStep === 2
                    ? 'MAGSAC++ geometric verification separates inliers (green) from outliers (red).'
                    : currentStep === 3
                    ? 'Estimated homography warps the source. Use the slider to blend with the reference.'
                    : 'Evaluation metrics, validation status, SSIM, and export options.'
                }
              />
              
              {(data.runDirId !== null || data.simulationMode) ? (
                <span
                  className={`px-3 py-1.5 rounded-full text-[10px] font-bold tracking-widest uppercase flex items-center gap-1.5 border backdrop-blur-md shadow-sm ${
                    data.simulationMode
                      ? 'border-amber-200 text-amber-700 bg-amber-50/50 dark:border-amber-900/50 dark:text-amber-400 dark:bg-amber-900/20'
                      : 'border-green-200 text-green-700 bg-green-50/50 dark:border-green-900/50 dark:text-green-400 dark:bg-green-900/20'
                  }`}
                >
                  {data.simulationMode ? <Zap className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  {data.simulationMode ? 'Simulation mode' : 'Backend result'}
                </span>
              ) : null}
            </div>

            <OrbitalGeometryPanel
              runDirId={data.runDirId}
              ssimMean={data.ssim.mean}
              ssimValidFraction={data.ssim.validFraction}
              elapsedSeconds={data.elapsedSeconds}
              matcherUsed={data.matcherUsed}
              data={data}
            />

            <div className="mt-8">
              {currentStep === 0 && (
                <StepUpload
                  data={data}
                  setData={setData}
                  loading={loading}
                  onRun={runPipeline}
                  runError={runError}
                  backendAvailable={backendAvailable}
                  activeStageIndex={activeStageIndex}
                  checkBackendHealth={checkBackendHealth}
                />
              )}
              {currentStep === 1 && <StepDetection data={data} />}
              {currentStep === 2 && <StepRANSAC data={data} />}
              {currentStep === 3 && <StepRegistration data={data} />}
              {currentStep === 4 && <StepEvaluation data={data} />}
            </div>

            <div className="flex justify-between mt-10 border-t border-[#0E0E0E]/15 dark:border-white/10 pt-6">
              <button
                onClick={() => navigate(`/workspace/step/${currentStep - 1}`)}
                disabled={currentStep === 0}
                aria-label="Navigate to previous step"
                className="px-6 py-2.5 text-xs font-bold tracking-wide rounded-md border border-gray-300 dark:border-white/15 text-gray-700 dark:text-gray-200 hover:border-gray-900 dark:hover:border-white/60 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5 disabled:bg-gray-50 dark:disabled:bg-white/[0.02] disabled:text-gray-400 dark:disabled:text-gray-600 disabled:border-[#0E0E0E]/15 dark:disabled:border-white/5 disabled:cursor-not-allowed transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 dark:focus-visible:ring-white"
              >
                ← Back
              </button>
              <button
                onClick={() => navigate(`/workspace/step/${currentStep + 1}`)}
                disabled={!isStepComplete(currentStep) || currentStep === STEPS.length - 1}
                className="px-6 py-2.5 text-xs font-bold tracking-wide rounded-md bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:opacity-85 disabled:bg-gray-200 dark:disabled:bg-white/10 disabled:text-gray-400 dark:disabled:text-gray-500 disabled:cursor-not-allowed transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 dark:focus-visible:ring-white"
              >
                {currentStep === STEPS.length - 1 ? 'Completed' : `Go to ${STEPS[currentStep + 1]} →`}
              </button>
            </div>
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}