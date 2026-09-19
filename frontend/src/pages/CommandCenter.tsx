import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAlerts, fetchState, fetchForecastBatch } from '../api/client';
import { useNetwork } from '../hooks/useNetwork';
import { useDemoStore } from '../hooks/useDemo';
import { KPICard } from '../components/KPICard';
import { AlertList } from '../components/AlertList';
import { NetworkMap } from '../components/NetworkMap';
import { ForecastChart } from '../components/ForecastChart';
import { SegmentDrawer } from '../components/SegmentDrawer';
import { JourneyBanner } from '../components/JourneyBanner';
import { getMapLineColor, getMapLineWidth } from '../lib/congestion';
import {
  AlertTriangle, Activity, TrendingDown, Zap, Lightbulb, ChevronRight
} from 'lucide-react';

const RECOMMENDATIONS = [
  { id: 1, text: 'Reroute outbound traffic via NH-44 bypass to ease Ring Road congestion.', priority: 'high' },
  { id: 2, text: 'Signal optimization at Jubilee Hills junction could reduce avg delay by ~3 min.', priority: 'medium' },
  { id: 3, text: 'Pre-emptive advisory for Tank Bund road — incident probability rising.', priority: 'low' },
];

export default function CommandCenter() {
  const [selectedSegment, setSelectedSegment] = useState<string | null>(null);
  const { data: network, isLoading: netLoading } = useNetwork();
  const { data: state, isLoading: stateLoading } = useQuery({
    queryKey: ['state'],
    queryFn: () => fetchState(),
    refetchInterval: 30000,
  });
  const { data: alertsData, isLoading: alertsLoading } = useQuery({
    queryKey: ['alerts'],
    queryFn: fetchAlerts,
    refetchInterval: 30000,
  });

  // Pick a few segment IDs for forecast chart demo
  const sampleSegIds = (network?.segments?.slice(0, 3).map(s => s.segment_id).filter(Boolean) ?? []) as string[];
  const { data: batchForecast } = useQuery({
    queryKey: ['forecast-batch', sampleSegIds],
    queryFn: () => fetchForecastBatch(sampleSegIds),
    enabled: sampleSegIds.length > 0,
    staleTime: 60000,
  });

  const { incidentActive, incidentSegment, propagationSegments } = useDemoStore();

  const summary = state?.summary;
  const alerts = alertsData?.alerts ?? [];
  const criticalAlerts = alerts.filter(a => a.severity === 'critical').length;

  // Merge demo state into segment states
  const segmentStates = state?.segments ?? [];

  const firstForecast = batchForecast?.forecasts
    ? Object.values(batchForecast.forecasts)[0]
    : undefined;

  // Use network_health (not network_health_score) from new API shape
  const networkHealth = summary?.network_health ?? 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 pt-4"><JourneyBanner /></div>
      {/* KPI Bar */}
      <div className="grid grid-cols-4 gap-3 p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shrink-0">
        <KPICard
          label="Active Alerts"
          value={alerts.length}
          sub={`${criticalAlerts} critical`}
          icon={<AlertTriangle className="w-4 h-4" />}
          color={criticalAlerts > 0 ? 'red' : 'amber'}
          loading={alertsLoading}
        />
        <KPICard
          label="Active Incidents"
          value={incidentActive ? 1 : 0}
          sub="Real-time detection"
          icon={<Zap className="w-4 h-4" />}
          color={incidentActive ? 'red' : 'green'}
          loading={stateLoading}
        />
        <KPICard
          label="Network Health"
          value={summary ? `${(networkHealth * 100).toFixed(0)}%` : '—'}
          sub="Overall score"
          icon={<Activity className="w-4 h-4" />}
          color={networkHealth > 0.7 ? 'green' : 'amber'}
          loading={stateLoading}
        />
        <KPICard
          label="Severe Segments"
          value={summary?.severe_segments ?? '—'}
          sub={`of ${summary?.total_segments ?? '—'} total`}
          icon={<TrendingDown className="w-4 h-4" />}
          color={(summary?.severe_segments ?? 0) > 10 ? 'red' : 'amber'}
          loading={stateLoading}
        />
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden gap-0">
        {/* Map — 60% */}
        <div className="flex-[3] min-w-0 relative p-4">
          {netLoading ? (
            <div className="skeleton rounded-xl h-full" />
          ) : (
            <NetworkMap
              network={network}
              segmentStates={segmentStates}
              incidentSegment={incidentActive ? incidentSegment : null}
              propagationSegments={propagationSegments}
              onSegmentClick={setSelectedSegment}
              selectedSegmentId={selectedSegment}
              height="h-full"
              showIncidentMarker={incidentActive}
            />
          )}
        </div>

        {/* Right Panel — 40% */}
        <div className="flex-[2] min-w-0 flex flex-col border-l border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* Alerts */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                Active Alerts
                {alerts.length > 0 && (
                  <span className="ml-2 badge bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                    {alerts.length}
                  </span>
                )}
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto">
              <AlertList alerts={alerts} loading={alertsLoading} maxHeight="" />
            </div>
          </div>

          {/* Forecast timeline */}
          <div className="border-t border-gray-200 dark:border-gray-700 p-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
              Forecast Timeline
              {firstForecast?.segment_id && (
                <span className="ml-2 text-xs text-gray-400 font-normal font-mono">
                  {firstForecast.segment_id}
                </span>
              )}
            </h2>
            <ForecastChart
              historical={firstForecast?.historical}
              horizons={firstForecast?.horizons}
              loading={!batchForecast && sampleSegIds.length > 0}
              height={180}
            />
          </div>

          {/* AI Recommendations */}
          <div className="border-t border-gray-200 dark:border-gray-700 p-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2 flex items-center gap-1.5">
              <Lightbulb className="w-4 h-4 text-amber-500" />
              AI Recommendations
            </h2>
            <div className="space-y-2">
              {RECOMMENDATIONS.map(r => (
                <div
                  key={r.id}
                  className="flex items-start gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 group hover:bg-indigo-50 dark:hover:bg-indigo-900/20 cursor-pointer transition-colors"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${
                      r.priority === 'high' ? 'bg-red-500' :
                      r.priority === 'medium' ? 'bg-amber-500' : 'bg-green-500'
                    }`}
                  />
                  <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed flex-1">{r.text}</p>
                  <ChevronRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-500 group-hover:text-indigo-500 transition-colors mt-0.5 shrink-0" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Segment drawer */}
      <SegmentDrawer segmentId={selectedSegment} onClose={() => setSelectedSegment(null)} />
    </div>
  );
}
