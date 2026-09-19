import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchIncidents } from '../api/client';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useJourneyStore, buildXAIExplanation } from '../stores/journeyStore';
import { JourneyBanner } from '../components/JourneyBanner';
import { XAIPanel } from '../components/XAIPanel';

import clsx from 'clsx';
import type { Incident } from '../api/client';
import { AlertTriangle, Brain, Filter } from 'lucide-react';

const INCIDENT_COLORS: Record<string, string> = {
  stalled_vehicle: '#f59e0b',
  accident_like: '#ef4444',
  road_closure: '#3b82f6',
  demand_surge: '#06b6d4',
  weather_hazard: '#8b5cf6',
  debris: '#6b7280',
  other: '#9ca3af',
};

const SEVERITY_BADGE: Record<number, string> = {
  1: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  2: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  3: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};
const SEVERITY_LABEL: Record<number, string> = { 1: 'Minor', 2: 'Moderate', 3: 'Severe' };

export default function IncidentIntelligence() {
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [filterType, setFilterType] = useState('');
  const [routeOnlyFilter, setRouteOnlyFilter] = useState(false);

  const { analysis } = useJourneyStore();
  const journeyActive = !!analysis;
  
  // NOTE: routeIncidents, activeIncidents, routeSegments, simTimestamp have been removed from store
  const currentRoute = analysis?.routes?.[useJourneyStore.getState().selectedRouteIdx] ?? null;
  const routeIncidents = currentRoute?.incidents_on_route ?? [];
  const activeIncidents = currentRoute?.incidents_on_route ?? [];
  const routeSegments = currentRoute?.segments ?? [];
  const simTimestamp = analysis?.departure_time;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['incidents'],
    queryFn: fetchIncidents,
    refetchInterval: 30000,
  });

  const allIncidents: Incident[] = data?.incidents ?? [];

  // When journey is active, auto-enable route filter
  const showRouteOnly = journeyActive && (routeOnlyFilter || routeIncidents.length > 0);
  const displayIncidents = showRouteOnly
    ? routeIncidents
    : filterType
    ? allIncidents.filter(i => i.incident_type === filterType)
    : allIncidents;

  const types = [...new Set(allIncidents.map(i => i.incident_type ?? 'other'))];

  // Type distribution for pie chart (from display set)
  const typeDistribution = displayIncidents.reduce<Record<string, number>>((acc, i) => {
    const t = i.incident_type ?? 'other';
    acc[t] = (acc[t] ?? 0) + 1;
    return acc;
  }, {});
  const pieData = Object.entries(typeDistribution).map(([name, value]) => ({ name, value }));

  const xai = selectedIncident ? buildXAIExplanation(selectedIncident) : null;

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* Journey banner */}
        {journeyActive && <JourneyBanner />}

        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Incident Intelligence</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {journeyActive
                ? `Showing incidents on your route (${routeSegments.length} segments) · Sim time: ${simTimestamp?.slice(11, 16) ?? '--'}`
                : 'AI-detected traffic incidents from training dataset (Jan 1–15, 2026)'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {journeyActive && (
              <button
                onClick={() => setRouteOnlyFilter(v => !v)}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                  showRouteOnly
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
                )}
              >
                <Filter className="w-3 h-3" />
                {showRouteOnly ? `Route only (${routeIncidents.length})` : 'All incidents'}
              </button>
            )}
            <select
              className="select text-xs"
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
            >
              <option value="">All types ({allIncidents.length})</option>
              {types.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
            <span className="badge bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-sm px-3 py-1">
              {displayIncidents.length} shown
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Incident table */}
          <div className="col-span-2 card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Incident Records</h2>
              {journeyActive && activeIncidents.length > 0 && (
                <span className="badge bg-red-500 text-white text-xs animate-pulse">
                  {activeIncidents.length} active now
                </span>
              )}
            </div>
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-12 rounded" />)}
              </div>
            ) : isError ? (
              <div className="p-8 text-center text-gray-400 text-sm">Failed to load incidents</div>
            ) : !displayIncidents.length ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                {journeyActive
                  ? 'No incidents detected on your route in the selected time window.'
                  : 'No incident records found.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                      {['Incident ID', 'Segment', 'Type', 'Severity', 'Lanes', 'Start', 'Confidence'].map(h => (
                        <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {displayIncidents.map(inc => {
                      const isActive = activeIncidents.some((a: any) => a.incident_id === inc.incident_id);
                      const isOnRoute = routeSegments.includes(inc.segment_id);
                      const severityNum = typeof inc.severity === 'number' ? inc.severity : 1;
                      return (
                        <tr
                          key={inc.incident_id}
                          onClick={() => setSelectedIncident(selectedIncident?.incident_id === inc.incident_id ? null : inc)}
                          className={clsx(
                            'cursor-pointer transition-colors',
                            isActive
                              ? 'bg-red-50 dark:bg-red-900/20 animate-pulse'
                              : selectedIncident?.incident_id === inc.incident_id
                              ? 'bg-indigo-50 dark:bg-indigo-900/20'
                              : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
                          )}
                        >
                          <td className="px-3 py-2.5 font-mono text-xs text-gray-500 dark:text-gray-400">
                            {String(inc.incident_id).slice(0, 14)}
                            {isOnRoute && <span className="ml-1 text-indigo-500">●</span>}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs text-gray-700 dark:text-gray-300">{inc.segment_id}</td>
                          <td className="px-3 py-2.5 text-gray-800 dark:text-gray-200">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ background: INCIDENT_COLORS[inc.incident_type ?? 'other'] ?? '#6b7280' }}
                              />
                              <span className="capitalize text-xs">{(inc.incident_type ?? 'other').replace(/_/g, ' ')}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={clsx('badge text-xs', SEVERITY_BADGE[severityNum] ?? SEVERITY_BADGE[1])}>
                              {SEVERITY_LABEL[severityNum] ?? `Sev ${severityNum}`}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300 text-xs">{inc.lanes_blocked ?? '?'}</td>
                          <td className="px-3 py-2.5 text-xs text-gray-400 font-mono">{inc.start_time?.slice(5, 16)}</td>
                          <td className="px-3 py-2.5 text-xs text-gray-500">
                            {((inc.confidence ?? 0) * 100).toFixed(0)}%
                            {isActive && (
                              <span className="ml-2 badge bg-red-500 text-white text-xs">NOW</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Right column: pie + XAI */}
          <div className="space-y-4">
            <div className="card p-4">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Type Distribution</h2>
              {pieData.length ? (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={75}
                      paddingAngle={3}
                      dataKey="value"
                      label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={INCIDENT_COLORS[entry.name] ?? '#6b7280'} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v, name) => [v, String(name).replace(/_/g, ' ')]} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-40 flex items-center justify-center text-gray-400 text-sm">No data</div>
              )}
              {pieData.length > 0 && (
                <div className="mt-2 space-y-1">
                  {pieData.map(d => (
                    <div key={d.name} className="flex items-center gap-2 text-xs">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: INCIDENT_COLORS[d.name] ?? '#6b7280' }} />
                      <span className="text-gray-600 dark:text-gray-400 capitalize flex-1">{d.name.replace(/_/g, ' ')}</span>
                      <span className="font-medium text-gray-800 dark:text-gray-200">{d.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* XAI explanation for selected incident */}
            {xai && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Brain className="w-4 h-4 text-indigo-500" />
                  <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">XAI Explanation</h3>
                </div>
                <XAIPanel xai={xai} onDismiss={() => setSelectedIncident(null)} />
              </div>
            )}

            {!xai && (
              <div className="card p-4 text-center">
                <Brain className="w-6 h-6 text-indigo-400 mx-auto mb-2" />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Click any incident row to see an AI explanation of why it happened
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
