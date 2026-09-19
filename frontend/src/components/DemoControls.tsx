import { Play, Pause, RotateCcw, Clock } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useDemoStore } from '../hooks/useDemo';
import { fetchDemoState } from '../api/client';
import clsx from 'clsx';

interface Props {
  onStateChange?: (state: Awaited<ReturnType<typeof fetchDemoState>>) => void;
}

export function DemoControls({ onStateChange }: Props) {
  const {
    isPlaying, speed, step, totalSteps, simulationTime, scenarioId,
    play, pause, reset, setSpeed, setStep, setTotalSteps,
    setSimulationTime, setIncidentActive, setIncidentSegment, setPropagationSegments,
    nextStep,
  } = useDemoStore();

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchingRef = useRef(false);

  const loadStep = async (s: number) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const data = await fetchDemoState(scenarioId, s);
      const anyData = data as typeof data & { total_steps?: number };
      if (typeof anyData.total_steps === 'number') {
        setTotalSteps(anyData.total_steps);
      }
      setSimulationTime(data.simulation_time ?? data.timestamp ?? '');
      setIncidentActive(data.incident_active ?? false);
      setIncidentSegment(data.incident_segment ?? null);
      setPropagationSegments(data.propagation_segments ?? []);
      onStateChange?.(data);
    } catch {
      // silently ignore fetch errors during demo playback
    } finally {
      fetchingRef.current = false;
    }
  };

  useEffect(() => {
    loadStep(step);
  }, [step]); // eslint-disable-line

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (!isPlaying) return;
    const delay = Math.floor(5000 / speed);
    intervalRef.current = setInterval(() => {
      useDemoStore.getState().nextStep();
      const s = useDemoStore.getState().step;
      loadStep(s);
    }, delay);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isPlaying, speed]); // eslint-disable-line

  const speedBtn = (s: 1 | 2 | 5) => (
    <button
      key={s}
      onClick={() => setSpeed(s)}
      className={clsx(
        'px-2 py-1 text-xs rounded font-medium transition-colors',
        speed === s
          ? 'bg-indigo-600 text-white'
          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
      )}
    >
      {s}x
    </button>
  );

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-4">
      <div className="flex items-center gap-1">
        <button
          onClick={isPlaying ? pause : play}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
        >
          {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button
          onClick={reset}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
          title="Reset"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center gap-1 border-l border-gray-200 dark:border-gray-700 pl-4">
        <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">Speed:</span>
        {([1, 2, 5] as const).map(speedBtn)}
      </div>

      <div className="flex items-center gap-2 border-l border-gray-200 dark:border-gray-700 pl-4">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Step: <span className="font-semibold text-gray-900 dark:text-gray-100">{step + 1}/{totalSteps}</span>
        </span>
        <div className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400">
          <Clock className="w-3.5 h-3.5" />
          <span className="text-sm font-semibold">{simulationTime}</span>
        </div>
      </div>

      <div className="border-l border-gray-200 dark:border-gray-700 pl-4">
        <input
          type="range"
          min={0}
          max={totalSteps - 1}
          value={step}
          onChange={e => setStep(Number(e.target.value))}
          className="w-24 accent-indigo-600"
        />
      </div>
    </div>
  );
}
