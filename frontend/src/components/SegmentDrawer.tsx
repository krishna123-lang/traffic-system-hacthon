import { useQuery } from '@tanstack/react-query';
import { fetchSegmentDetail, fetchPropagation } from '../api/client';
import { X, TrendingUp, Navigation } from 'lucide-react';
import { getCongestionColor, getCongestionLabel } from '../lib/congestion';
import { ForecastChart } from './ForecastChart';

interface Props {
  segmentId: string | null;
  onClose: () => void;
}

export function SegmentDrawer({ segmentId, onClose }: Props) {
  const { data: detail, isLoading } = useQuery({
    queryKey: ['segment', segmentId],
    queryFn: () => fetchSegmentDetail(segmentId!),
    enabled: !!segmentId,
  });

  const { data: prop, isLoading: propLoading } = useQuery({
    queryKey: ['propagation', segmentId],
    queryFn: () => fetchPropagation(segmentId!),
    enabled: !!segmentId,
  });

  if (!segmentId) return null;

  const currentState = detail?.current_state;
  const networkInfo = detail?.network;
  const incidentProb = detail?.incident_probability;
  const state = currentState?.congestion_state ?? 'normal';
  const color = getCongestionColor(state as never);

  const forecast = detail?.forecast ? { horizons: detail.forecast } : null;

  return (
    <div className="fixed right-0 top-0 bottom-0 w-96 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 shadow-2xl z-50 flex flex-col animate-slide-in">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Segment Detail</h2>
          <p className="text-xs text-gray-400 font-mono">{segmentId}</p>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-12 rounded" />)}
          </div>
        ) : detail ? (
          <>
            {/* State badge */}
            <div className="flex items-center gap-3">
              <span
                className="badge text-white font-medium"
                style={{ background: color }}
              >
                {getCongestionLabel(state as never)}
              </span>
              <span className="text-sm text-gray-600 dark:text-gray-300">
                Score: <strong>{(currentState?.congestion_score ?? 0).toFixed(3)}</strong>
              </span>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="card p-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">Speed</p>
                <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {currentState?.speed_kmh != null ? `${Math.round(currentState.speed_kmh)} km/h` : '—'}
                </p>
              </div>
              <div className="card p-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">Inc. Probability</p>
                <p className="text-lg font-bold text-red-600 dark:text-red-400">
                  {incidentProb != null ? `${(incidentProb * 100).toFixed(1)}%` : '—'}
                </p>
              </div>
              <div className="card p-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">Road Class</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 capitalize">
                  {networkInfo?.road_class ?? '—'}
                </p>
              </div>
              <div className="card p-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">Length</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {networkInfo?.length_km != null ? `${networkInfo.length_km.toFixed(2)} km` : '—'}
                </p>
              </div>
              {currentState?.flow_vph != null && (
                <div className="card p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Flow (vph)</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {Math.round(currentState.flow_vph)}
                  </p>
                </div>
              )}
              {currentState?.delay_min != null && (
                <div className="card p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Delay</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {currentState.delay_min.toFixed(2)} min
                  </p>
                </div>
              )}
            </div>

            {/* Incident probability bar */}
            {incidentProb != null && (
              <div>
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                  <span>Incident Risk</span>
                  <span>{(incidentProb * 100).toFixed(1)}%</span>
                </div>
                <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${(incidentProb * 100).toFixed(1)}%`,
                      background: incidentProb > 0.7 ? '#ef4444' :
                        incidentProb > 0.4 ? '#f97316' : '#22c55e',
                    }}
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-gray-400 dark:text-gray-500">Could not load segment data.</div>
        )}

        {/* Forecast */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" /> 4-Horizon Forecast
          </h3>
          {!forecast?.horizons?.length ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">No forecast data</p>
          ) : (
            <>
              <ForecastChart
                horizons={forecast.horizons as any}
                height={160}
              />
              <div className="grid grid-cols-4 gap-1 mt-2">
                {forecast.horizons.map(h => {
                  return (
                    <div key={h.horizon_minutes} className="text-center p-2 rounded-lg bg-gray-50 dark:bg-gray-700">
                      <p className="text-xs text-gray-400">+{h.horizon_minutes}m</p>
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                        {Number(h.predicted_value).toFixed(2)}
                      </p>
                      <div className="w-full h-1 rounded-full mt-1" style={{ background: getCongestionColor(h.congestion_state as never) }} />
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Propagation */}
        {prop?.neighbors?.length ? (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1">
              <Navigation className="w-3.5 h-3.5" /> Propagation Risk
            </h3>
            <div className="space-y-1.5">
              {prop.neighbors.slice(0, 5).map(n => (
                <div key={n.segment_id} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-gray-500 dark:text-gray-400 truncate flex-1">{n.segment_id}</span>
                  <span className="text-gray-400">{n.reason}</span>
                  <div className="w-16 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(n.risk * 100).toFixed(0)}%`,
                        background: n.risk > 0.6 ? '#ef4444' : n.risk > 0.3 ? '#f97316' : '#22c55e'
                      }}
                    />
                  </div>
                  <span className="text-gray-500 w-8 text-right">{(n.risk * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
