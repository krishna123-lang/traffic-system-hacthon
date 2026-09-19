import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { fetchPlanningCandidates, simulateIntervention } from '../api/client';
import type { InterventionResult, PlanningCandidate } from '../api/client';
import { JourneyBanner } from '../components/JourneyBanner';
import { useJourneyStore } from '../stores/journeyStore';
import {
  FlaskConical, TrendingUp, TrendingDown, Minus, AlertTriangle,
  CheckCircle, Info, ArrowRight
} from 'lucide-react';
import clsx from 'clsx';

const FEASIBILITY_CONFIDENCE: Record<string, { pct: string; label: string; color: string }> = {
  low:    { pct: '55%', label: 'Lower confidence — complex or costly intervention', color: 'text-red-600 dark:text-red-400' },
  medium: { pct: '70%', label: 'Moderate confidence — standard intervention', color: 'text-amber-600 dark:text-amber-400' },
  high:   { pct: '85%', label: 'Higher confidence — straightforward intervention', color: 'text-green-600 dark:text-green-400' },
};

function DeltaBadge({ direction, changePct }: { direction: string; changePct: number }) {
  if (direction === 'unchanged' || Math.abs(changePct) < 0.001) {
    return <span className="flex items-center gap-1 text-gray-400 text-xs"><Minus className="w-3 h-3" /> No change</span>;
  }
  const improved = direction === 'improved';
  return (
    <span className={clsx('flex items-center gap-1 font-semibold text-xs', improved ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>
      {improved ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
      {changePct > 0 ? '+' : ''}{changePct.toFixed(2)}% ({direction})
    </span>
  );
}

export default function PlanningLab() {
  const [selectedCandidate, setSelectedCandidate] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');
  const { journeyActive, routeSegments } = useJourneyStore();


  const { data: candData, isLoading: candLoading } = useQuery({
    queryKey: ['planning-candidates'],
    queryFn: fetchPlanningCandidates,
    staleTime: 60000,
  });

  const {
    mutate: simulate,
    data: result,
    isPending,
    isError,
    reset: resetResult,
  } = useMutation({ mutationFn: () => simulateIntervention(selectedCandidate) });

  const allCandidates: PlanningCandidate[] = candData?.candidates ?? [];
  const types = [...new Set(allCandidates.map(c => c.intervention_type))];

  // When journey active, prioritize route segments; otherwise use type filter
  const routeSegsSet = new Set(routeSegments);
  const baseCandidates = journeyActive && routeSegments.length > 0
    ? [...allCandidates.filter(c => routeSegsSet.has(c.target_segment)), ...allCandidates.filter(c => !routeSegsSet.has(c.target_segment))]
    : allCandidates;

  const filteredCandidates = filterType
    ? baseCandidates.filter(c => c.intervention_type === filterType)
    : baseCandidates;

  const selectedCandidateObj = allCandidates.find(c => c.candidate_id === selectedCandidate);
  const confInfo = FEASIBILITY_CONFIDENCE[selectedCandidateObj?.feasibility_band ?? 'medium'];

  // Metrics from result.changes dict (has change_pct and direction from backend)
  const changeEntries = result
    ? Object.entries(result.changes ?? {}).map(([key, val]) => ({
        key,
        label: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        before: val.before,
        after: val.after,
        changePct: val.change_pct,
        direction: val.direction,
      }))
    : [];

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        {journeyActive && <JourneyBanner />}

        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Planning / Simulation Lab</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {journeyActive
              ? `Showing route-relevant interventions first (${routeSegments.length} route segments)`
              : 'Simulate infrastructure interventions and measure projected network impact'}
          </p>
        </div>

        {/* Info */}
        <div className="card p-4 flex items-start gap-3 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700">
          <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700 dark:text-blue-300">
            Select any intervention candidate from <strong>{allCandidates.length}</strong> options.
            Confidence reflects feasibility: <strong>Low→55%</strong>, <strong>Medium→70%</strong>, <strong>High→85%</strong>.
            Small before/after differences are expected in low-congestion baseline (midnight validation period).
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Left: Candidate selector */}
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">1. Select Intervention</h2>
            <div className="mb-3">
              <select
                className="select w-full text-xs"
                value={filterType}
                onChange={e => { setFilterType(e.target.value); setSelectedCandidate(''); resetResult(); }}
              >
                <option value="">All types ({allCandidates.length})</option>
                {types.map(t => (
                  <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>

            {candLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map(i => <div key={i} className="skeleton h-16 rounded-lg" />)}
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {filteredCandidates.slice(0, 20).map(c => {
                  const isOnRoute = journeyActive && routeSegsSet.has(c.target_segment);
                  return (
                  <button
                    key={c.candidate_id}
                    onClick={() => { setSelectedCandidate(c.candidate_id); resetResult(); }}
                    className={clsx(
                      'w-full text-left px-3 py-2.5 rounded-lg border transition-all',
                      selectedCandidate === c.candidate_id
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                        : isOnRoute
                        ? 'border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/10'
                        : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 capitalize truncate">
                          {c.intervention_type.replace(/_/g, ' ')}
                          {isOnRoute && <span className="ml-1 badge bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-xs">on route</span>}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                          Seg: {c.target_segment}
                        </p>
                      </div>
                      <span className={clsx('badge text-xs shrink-0',
                        c.feasibility_band === 'high' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                        c.feasibility_band === 'medium' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                        'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      )}>
                        {c.feasibility_band}
                      </span>
                    </div>
                    <div className="flex gap-3 mt-1 text-xs text-gray-400">
                      <span>+{c.capacity_delta_vph} vph</span>
                      <span>Cost: {c.cost_index}</span>
                    </div>
                  </button>
                  );
                })}
                {filteredCandidates.length > 20 && (
                  <p className="text-xs text-gray-400 text-center py-2">Showing 20 of {filteredCandidates.length}</p>
                )}
              </div>
            )}
          </div>

          {/* Right: Simulate + result */}
          <div className="card p-4 flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">2. Run Simulation</h2>

            {selectedCandidateObj && (
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-xs space-y-1">
                <p><span className="text-gray-400">Selected:</span> <span className="font-mono font-semibold">{selectedCandidateObj.candidate_id}</span></p>
                <p><span className="text-gray-400">Type:</span> {selectedCandidateObj.intervention_type.replace(/_/g, ' ')}</p>
                <p><span className="text-gray-400">Target segment:</span> <span className="font-mono">{selectedCandidateObj.target_segment}</span></p>
                <p><span className="text-gray-400">Capacity delta:</span> +{selectedCandidateObj.capacity_delta_vph} vph</p>
                <p><span className="text-gray-400">Feasibility:</span> {selectedCandidateObj.feasibility_band}</p>
              </div>
            )}

            <button
              className="btn-primary w-full flex items-center justify-center gap-2"
              disabled={!selectedCandidate || isPending}
              onClick={() => simulate()}
            >
              <FlaskConical className="w-4 h-4" />
              {isPending ? 'Simulating...' : 'Simulate Intervention'}
            </button>

            {isError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 text-xs">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                Simulation failed. Please try again.
              </div>
            )}

            {result && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">SIMULATION ESTIMATE</span>
                </div>

                {/* Confidence with explanation */}
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Confidence</p>
                    <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
                      {((result.confidence ?? 0) * 100).toFixed(0)}%
                    </p>
                  </div>
                  <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-600 overflow-hidden">
                    <div
                      className={clsx('h-full rounded-full', {
                        'bg-red-500': result.confidence < 0.6,
                        'bg-amber-500': result.confidence >= 0.6 && result.confidence < 0.8,
                        'bg-green-500': result.confidence >= 0.8,
                      })}
                      style={{ width: `${(result.confidence ?? 0) * 100}%` }}
                    />
                  </div>
                  {confInfo && (
                    <p className={clsx('text-xs mt-1.5', confInfo.color)}>
                      {confInfo.label}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Before/After comparison — use changes dict from backend */}
        {result && (
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Impact Analysis — Before vs After</h2>
              <span className="badge bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-xs">SIMULATION ESTIMATE</span>
            </div>

            {changeEntries.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Metric</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Before</th>
                      <th className="px-4 py-3 text-center text-xs text-gray-400">→</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">After</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Change</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {changeEntries.map(({ key, label, before, after, changePct, direction }) => {
                      const isScore = key.includes('score') || key.includes('congestion') || key.includes('health');
                      const isSpeed = key.includes('speed');
                      const isInt = key.includes('segments');
                      const fmt = (v: number) =>
                        isInt ? Math.round(v).toString()
                        : isSpeed ? `${v.toFixed(1)} km/h`
                        : isScore ? (v * 100).toFixed(2) + '%'
                        : v.toFixed(4);
                      return (
                        <tr key={key} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100 text-xs">{label}</td>
                          <td className="px-4 py-3 font-mono text-gray-600 dark:text-gray-300 text-xs">{fmt(before ?? 0)}</td>
                          <td className="px-4 py-3 text-center text-gray-400"><ArrowRight className="w-3 h-3 mx-auto" /></td>
                          <td className="px-4 py-3 font-mono text-gray-900 dark:text-gray-100 text-xs">{fmt(after ?? 0)}</td>
                          <td className="px-4 py-3">
                            <DeltaBadge direction={direction} changePct={changePct} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                      {['Metric', 'Before', '→', 'After', 'Change'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {[
                      { label: 'Avg Congestion Score', b: result.before.avg_congestion_score, a: result.after.avg_congestion_score, pct: true },
                      { label: 'Max Congestion Score', b: result.before.max_congestion_score, a: result.after.max_congestion_score, pct: true },
                      { label: 'Severe Segments', b: result.before.severe_segments, a: result.after.severe_segments, pct: false },
                      { label: 'Avg Delay (min)', b: result.before.avg_delay_min, a: result.after.avg_delay_min, pct: false },
                      { label: 'Avg Speed (km/h)', b: result.before.avg_speed_kmh, a: result.after.avg_speed_kmh, pct: false },
                      { label: 'Network Health', b: result.before.network_health_score, a: result.after.network_health_score, pct: true },
                    ].map(({ label, b, a, pct }) => {
                      const diff = (a ?? 0) - (b ?? 0);
                      const fmt = (v: number) => pct ? `${(v * 100).toFixed(2)}%` : (v ?? 0).toFixed(4);
                      return (
                        <tr key={label} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{label}</td>
                          <td className="px-4 py-3 font-mono text-gray-600 dark:text-gray-300 text-xs">{fmt(b ?? 0)}</td>
                          <td className="px-4 py-3 text-center text-gray-400"><ArrowRight className="w-3 h-3 mx-auto" /></td>
                          <td className="px-4 py-3 font-mono text-gray-900 dark:text-gray-100 text-xs">{fmt(a ?? 0)}</td>
                          <td className="px-4 py-3">
                            <DeltaBadge
                              direction={Math.abs(diff) < 0.0001 ? 'unchanged' : diff < 0 ? 'improved' : 'worsened'}
                              changePct={b !== 0 ? (diff / b) * 100 : 0}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Key benefits */}
            {(result.key_benefits?.length ?? 0) > 0 && (
              <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Key Benefits</h3>
                <div className="grid grid-cols-2 gap-2">
                  {result.key_benefits.map((b, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                      <span>{b}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Disclaimer */}
            {result.disclaimer && (
              <div className="px-4 pb-4">
                <p className="text-xs text-gray-400 dark:text-gray-500 italic">{result.disclaimer}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
