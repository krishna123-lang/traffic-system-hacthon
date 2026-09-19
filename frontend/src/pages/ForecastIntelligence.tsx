import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchForecast } from '../api/client';
import { useNetwork } from '../hooks/useNetwork';
import { ForecastChart } from '../components/ForecastChart';
import { JourneyBanner } from '../components/JourneyBanner';
import { getCongestionColor, getCongestionLabel } from '../lib/congestion';
import { useJourneyStore } from '../stores/journeyStore';
import { TrendingUp, Route } from 'lucide-react';
import clsx from 'clsx';

export default function ForecastIntelligence() {
  const { data: network } = useNetwork();
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>('');
  const { journeyActive, routeSegments, simStep } = useJourneyStore();

  const segments = network?.segments ?? [];
  // When journey is active, auto-select current route segment based on sim step
  useEffect(() => {
    if (journeyActive && routeSegments.length > 0) {
      const idx = Math.min(simStep, routeSegments.length - 1);
      setSelectedSegmentId(routeSegments[idx] ?? routeSegments[0]);
    }
  }, [journeyActive, routeSegments, simStep]);

  const effectiveId = selectedSegmentId || segments[0]?.segment_id || '';

  const { data: forecast, isLoading, isError } = useQuery({
    queryKey: ['forecast', effectiveId],
    queryFn: () => fetchForecast(effectiveId),
    enabled: !!effectiveId,
    staleTime: 30000,
  });


  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        {journeyActive && <JourneyBanner />}

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Forecast Intelligence</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {journeyActive
              ? `Auto-tracking route segments — step ${simStep + 1}/${routeSegments.length}`
              : 'ML-driven congestion predictions across all horizons'}
          </p>
        </div>

        {/* Segment selector */}
        <div className="card p-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
            {journeyActive ? 'Route Segment (auto-following journey)' : 'Select Segment'}
          </label>
          <div className="flex gap-3 items-center">
            <select
              className="select w-full max-w-md"
              value={selectedSegmentId || effectiveId}
              onChange={e => setSelectedSegmentId(e.target.value)}
            >
              {segments.map(s => (
                <option key={s.segment_id} value={s.segment_id}>{s.segment_id}</option>
              ))}

            </select>
            {forecast && (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Current: <strong className="text-gray-800 dark:text-gray-200">{(forecast.current_value ?? 0).toFixed(3)}</strong>
                &nbsp;·&nbsp;
                <span
                  className="badge text-white text-xs"
                  style={{ background: getCongestionColor(forecast.current_state) }}
                >
                  {getCongestionLabel(forecast.current_state)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Main chart */}
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-indigo-500" />
            Congestion Forecast — Predicted Horizons
          </h2>
          {isError ? (
            <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
              Failed to load forecast data
            </div>
          ) : (
            <ForecastChart
              horizons={forecast?.horizons}
              loading={isLoading}
              height={320}
            />
          )}
        </div>

        {/* Horizon comparison table */}
        {forecast?.horizons?.length ? (
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                Horizon Comparison
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Horizon</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Predicted Score</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">State</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Confidence Band</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Risk Bar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {forecast.horizons.map(h => {
                    // API fields: horizon_minutes, predicted_value, congestion_state, lower_bound, upper_bound, confidence
                    const val = h.predicted_value ?? 0;
                    const low = h.lower_bound ?? val * 0.9;
                    const high = h.upper_bound ?? val * 1.1;
                    return (
                      <tr key={h.horizon_minutes} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                        <td className="px-4 py-3 font-semibold text-gray-900 dark:text-gray-100">
                          +{h.horizon_minutes} min
                        </td>
                        <td className="px-4 py-3 font-mono font-medium text-gray-800 dark:text-gray-200">
                          {val.toFixed(4)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="badge text-white text-xs"
                            style={{ background: getCongestionColor(h.congestion_state) }}
                          >
                            {getCongestionLabel(h.congestion_state)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 font-mono">
                          [{low.toFixed(3)},&nbsp;{high.toFixed(3)}]
                        </td>
                        <td className="px-4 py-3 w-32">
                          <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.min(val * 100, 100)}%`,
                                background: getCongestionColor(h.congestion_state),
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {isLoading && (
          <div className="space-y-3">
            <div className="skeleton h-10 rounded-xl" />
            <div className="skeleton h-10 rounded-xl" />
            <div className="skeleton h-10 rounded-xl" />
          </div>
        )}
      </div>
    </div>
  );
}
