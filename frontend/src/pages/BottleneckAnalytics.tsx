import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchBottlenecks, fetchPlanningCandidates, fetchState } from '../api/client';
import type { NetworkState } from '../api/client';
import { getCongestionColor } from '../lib/congestion';
import { JourneyBanner } from '../components/JourneyBanner';
import { useJourneyStore } from '../stores/journeyStore';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { BarChart2, Activity } from 'lucide-react';
import clsx from 'clsx';

export default function BottleneckAnalytics() {
  const [selectedSegment, setSelectedSegment] = useState<string | null>(null);
  const { analysis } = useJourneyStore();
  const journeyActive = !!analysis;
  const routeSegments = analysis?.routes?.[useJourneyStore.getState().selectedRouteIdx]?.segments ?? [];


  const { data: bottleneckData, isLoading: bnLoading } = useQuery({
    queryKey: ['bottlenecks'],
    queryFn: fetchBottlenecks,
    staleTime: 60000,
  });

  const { data: stateData, isLoading: stateLoading } = useQuery<NetworkState>({
    queryKey: ['state'],
    queryFn: () => fetchState(),
    staleTime: 30000,
    refetchInterval: 30000,
  });

  const { data: candidatesData } = useQuery({
    queryKey: ['planning-candidates'],
    queryFn: fetchPlanningCandidates,
    staleTime: 60000,
  });

  const historicalBottlenecks = bottleneckData?.bottlenecks ?? [];

  // Use live state segments ranked by congestion_score as "current hotspots"
  const liveSegments = stateData?.segments ?? [];
  const currentHotspots = [...liveSegments]
    .sort((a, b) => (b.congestion_score ?? 0) - (a.congestion_score ?? 0))
    .slice(0, 15);
  const top10Chart = currentHotspots.slice(0, 10);

  const allCandidates = candidatesData?.candidates ?? [];
  const filteredCandidates = selectedSegment
    ? allCandidates.filter(c => c.target_segment === selectedSegment)
    : allCandidates.slice(0, 10);

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-6">
        {journeyActive && <JourneyBanner />}

        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Bottleneck Analytics</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {journeyActive
              ? `Live congestion hotspots · ${routeSegments.length} route segments highlighted`
              : 'Live congestion hotspots ranked by impact score'}
          </p>
        </div>


        {/* Summary KPIs */}
        {stateData?.summary && (
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Network Health', value: `${((stateData.summary.network_health ?? 0) * 100).toFixed(0)}%`, color: 'text-green-600 dark:text-green-400' },
              { label: 'Avg Congestion', value: `${((stateData.summary.avg_congestion ?? 0) * 100).toFixed(1)}%`, color: 'text-indigo-600 dark:text-indigo-400' },
              { label: 'Severe Segments', value: stateData.summary.severe_segments ?? 0, color: 'text-red-600 dark:text-red-400' },
              { label: 'High Segments', value: stateData.summary.high_segments ?? 0, color: 'text-orange-600 dark:text-orange-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="card p-4">
                <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                <p className={clsx('text-2xl font-bold mt-1', color)}>{value}</p>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-6">
          {/* Bar chart — live congestion */}
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-indigo-500" />
              Top 10 by Live Congestion Score
            </h2>
            {stateLoading ? (
              <div className="skeleton h-52 rounded" />
            ) : top10Chart.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={top10Chart} margin={{ left: -15, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(107,114,128,0.2)" />
                  <XAxis
                    dataKey="segment_id"
                    tick={{ fontSize: 9 }}
                    angle={-35}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 0.5]} />
                  <Tooltip
                    formatter={(v: number, name: string) => [`${(v * 100).toFixed(1)}%`, 'Congestion Score']}
                  />
                  <Bar dataKey="congestion_score" radius={[4, 4, 0, 0]}>
                    {top10Chart.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={getCongestionColor(entry.congestion_state ?? 'normal')}
                        cursor="pointer"
                        onClick={() => setSelectedSegment(
                          entry.segment_id === selectedSegment ? null : entry.segment_id
                        )}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-52 flex items-center justify-center text-gray-400 text-sm">No live data</div>
            )}
          </div>

          {/* Intervention candidates */}
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
              Intervention Candidates
              {selectedSegment && (
                <span className="ml-2 text-xs text-gray-400 font-mono">{selectedSegment}</span>
              )}
            </h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
              {selectedSegment
                ? `Candidates for ${selectedSegment}.`
                : `Top from ${allCandidates.length} candidates. Click a bar to filter.`}
              {selectedSegment && (
                <button
                  className="ml-2 text-indigo-500 hover:text-indigo-700 underline"
                  onClick={() => setSelectedSegment(null)}
                >
                  Clear
                </button>
              )}
            </p>
            {filteredCandidates.length ? (
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {filteredCandidates.map(c => (
                  <div key={c.candidate_id} className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 capitalize">
                          {c.intervention_type.replace(/_/g, ' ')}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                          {c.target_segment}
                        </p>
                      </div>
                      <span className={clsx(
                        'badge text-xs shrink-0',
                        c.feasibility_band === 'high' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                        c.feasibility_band === 'medium' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                        'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      )}>
                        {c.feasibility_band}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      +{c.capacity_delta_vph} vph &middot; Cost: {c.cost_index}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-40 flex items-center justify-center text-gray-400 text-sm">
                {selectedSegment ? 'No candidates for this segment' : 'Loading...'}
              </div>
            )}
          </div>
        </div>

        {/* Live hotspots table */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <Activity className="w-4 h-4 text-indigo-500" />
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              Top 15 Current Congestion Hotspots
            </h2>
            {stateData?.timestamp && (
              <span className="ml-auto text-xs text-gray-400 font-mono">{stateData.timestamp}</span>
            )}
          </div>
          {stateLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-10 rounded" />)}
            </div>
          ) : !currentHotspots.length ? (
            <div className="p-8 text-center text-gray-400 text-sm">No segment data available</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                    {['#', 'Segment', 'Congestion', 'State', 'Speed', 'Flow', 'Delay'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {currentHotspots.map((b, idx) => (
                    <tr
                      key={b.segment_id}
                      onClick={() => setSelectedSegment(b.segment_id === selectedSegment ? null : b.segment_id)}
                      className={clsx(
                        'cursor-pointer transition-colors',
                        selectedSegment === b.segment_id
                          ? 'bg-indigo-50 dark:bg-indigo-900/20'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
                      )}
                    >
                      <td className="px-3 py-2.5">
                        <span className={clsx(
                          'w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold text-white',
                          idx < 3 ? 'bg-red-500' : idx < 7 ? 'bg-orange-500' : 'bg-gray-400'
                        )}>
                          {idx + 1}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-gray-700 dark:text-gray-300">{b.segment_id}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min((b.congestion_score ?? 0) * 100 / 0.5, 100)}%`,
                                background: getCongestionColor(b.congestion_state ?? 'normal'),
                              }}
                            />
                          </div>
                          <span className="font-semibold text-gray-900 dark:text-gray-100 text-xs font-mono">
                            {((b.congestion_score ?? 0) * 100).toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className="badge text-white text-xs"
                          style={{ background: getCongestionColor(b.congestion_state ?? 'normal') }}
                        >
                          {b.congestion_state ?? 'normal'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300 text-xs">{(b.speed_kmh ?? 0).toFixed(0)} km/h</td>
                      <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300 text-xs">{(b.flow_vph ?? 0).toFixed(0)} vph</td>
                      <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300 text-xs">{(b.delay_min ?? 0).toFixed(2)} min</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Historical note */}
        {!bnLoading && historicalBottlenecks.length === 0 && (
          <div className="card p-4 bg-gray-50 dark:bg-gray-700/30 border-gray-200 dark:border-gray-600">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              <strong>Historical recurring bottlenecks:</strong> Not available for this validation window (Jan 16, 2026 midnight — all congestion below normal threshold).
              The table above shows live segment congestion from the current network state.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
