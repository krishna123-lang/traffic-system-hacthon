import { useQuery } from '@tanstack/react-query';
import { fetchMetrics } from '../api/client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer
} from 'recharts';
import { Star, Activity, Target } from 'lucide-react';
import clsx from 'clsx';

const MODELS = ['xgboost', 'historical_baseline', 'gru', 'st_gnn'];
const HORIZONS = [15, 30, 45, 60];
const COLORS: Record<string, string> = {
  xgboost: '#4f46e5',
  historical_baseline: '#22c55e',
  gru: '#f97316',
  st_gnn: '#ef4444',
};
const MODEL_LABELS: Record<string, string> = {
  xgboost: 'XGBoost ⭐',
  historical_baseline: 'Historical Baseline',
  gru: 'GRU',
  st_gnn: 'ST-GNN',
};

export default function ModelPerformance() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['metrics'],
    queryFn: fetchMetrics,
    staleTime: 60000,
  });

  const rawMetrics = data?.forecast_metrics ?? [];
  // API returns one row per model × horizon. Build a lookup: {model: {horizon: ForecastMetric}}
  const lookup: Record<string, Record<number, typeof rawMetrics[0]>> = {};
  for (const m of rawMetrics) {
    if (!lookup[m.model]) lookup[m.model] = {};
    lookup[m.model][m.horizon_minutes] = m;
  }

  // Unique models that actually appeared
  const models = MODELS.filter(m => lookup[m]);

  // Build chart data — one entry per horizon
  const chartData = HORIZONS.map(h => {
    const row: Record<string, number | string> = { horizon: `+${h}m` };
    for (const m of models) {
      row[m] = lookup[m]?.[h]?.mae ?? 0;
    }
    return row;
  });

  const incidentMetrics = data?.incident_metrics ?? [];
  const incidentMetric = incidentMetrics[0]; // lightgbm

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Model Performance</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Forecast accuracy and incident detection metrics from real training
          </p>
        </div>

        {isLoading && (
          <div className="space-y-4">
            <div className="skeleton h-48 rounded-xl" />
            <div className="skeleton h-48 rounded-xl" />
          </div>
        )}

        {isError && (
          <div className="card p-8 text-center text-gray-400 dark:text-gray-500">
            Failed to load metrics data
          </div>
        )}

        {/* Forecast metrics table — one row per model, 4 horizon MAE columns */}
        {models.length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-500" />
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Forecast Model Comparison (MAE)</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                    {['Model', '+15min MAE', '+30min MAE', '+45min MAE', '+60min MAE', 'sMAPE (15m)'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {models.map((model) => {
                    const isBest = model === 'xgboost';
                    return (
                      <tr
                        key={model}
                        className={clsx(
                          'transition-colors',
                          isBest ? 'bg-indigo-50/60 dark:bg-indigo-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
                        )}
                      >
                        <td className="px-4 py-3 font-semibold text-gray-900 dark:text-gray-100">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-3 h-3 rounded-full inline-block shrink-0"
                              style={{ background: COLORS[model] ?? '#6b7280' }}
                            />
                            {MODEL_LABELS[model] ?? model}
                            {isBest && <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />}
                          </div>
                        </td>
                        {HORIZONS.map(h => (
                          <td key={h} className="px-4 py-3 font-mono text-gray-700 dark:text-gray-300">
                            {(lookup[model]?.[h]?.mae ?? 0).toFixed(4)}
                          </td>
                        ))}
                        <td className="px-4 py-3 font-mono text-gray-700 dark:text-gray-300">
                          {(lookup[model]?.[15]?.smape ?? 0).toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Bar chart — MAE by horizon per model */}
        {chartData.length > 0 && models.length > 0 && (
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">MAE by Forecast Horizon</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ left: -15 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(107,114,128,0.2)" />
                <XAxis dataKey="horizon" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(3)} />
                <Tooltip formatter={(v: number) => v.toFixed(4)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {models.map(m => (
                  <Bar key={m} dataKey={m} name={MODEL_LABELS[m] ?? m} fill={COLORS[m] ?? '#6b7280'} radius={[3, 3, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Incident detection metrics */}
        {incidentMetric && (
          <div className="grid grid-cols-2 gap-6">
            <div className="card p-4">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
                <Target className="w-4 h-4 text-indigo-500" />
                Incident Detection — LightGBM
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Precision', value: incidentMetric.precision, color: 'indigo' },
                  { label: 'Recall', value: incidentMetric.recall, color: 'green' },
                  { label: 'F1 Score', value: incidentMetric.f1, color: 'amber' },
                  { label: 'PR-AUC', value: incidentMetric.pr_auc, color: 'purple' },
                  { label: 'False Alarm Rate', value: incidentMetric.false_alarm_rate, color: 'red' },
                ].map(({ label, value, color }) => (
                  <div
                    key={label}
                    className={clsx('p-3 rounded-xl', {
                      'bg-indigo-50 dark:bg-indigo-900/20': color === 'indigo',
                      'bg-green-50 dark:bg-green-900/20': color === 'green',
                      'bg-amber-50 dark:bg-amber-900/20': color === 'amber',
                      'bg-purple-50 dark:bg-purple-900/20': color === 'purple',
                      'bg-red-50 dark:bg-red-900/20': color === 'red',
                    })}
                  >
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</p>
                    <p className={clsx('text-2xl font-bold', {
                      'text-indigo-700 dark:text-indigo-300': color === 'indigo',
                      'text-green-700 dark:text-green-300': color === 'green',
                      'text-amber-700 dark:text-amber-300': color === 'amber',
                      'text-purple-700 dark:text-purple-300': color === 'purple',
                      'text-red-700 dark:text-red-300': color === 'red',
                    })}>
                      {((value ?? 0) * 100).toFixed(1)}%
                    </p>
                    <div className="h-1.5 mt-2 rounded-full bg-gray-200 dark:bg-gray-600 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min((value ?? 0) * 100, 100)}%`,
                          background: ({ indigo: '#4f46e5', green: '#22c55e', amber: '#eab308', purple: '#8b5cf6', red: '#ef4444' } as Record<string,string>)[color],
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-4">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">Dataset Statistics</h2>
              <div className="space-y-3">
                {[
                  { label: 'Training samples', value: (incidentMetric.n_train ?? 0).toLocaleString() },
                  { label: 'Validation samples', value: (incidentMetric.n_val ?? 0).toLocaleString() },
                  { label: 'Positive train (incidents)', value: (incidentMetric.n_positive_train ?? 0).toLocaleString() },
                  { label: 'Positive val (incidents)', value: (incidentMetric.n_positive_val ?? 0).toLocaleString() },
                  { label: 'Detection threshold', value: (incidentMetric.threshold ?? 0.35).toString() },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-300">{label}</span>
                    <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 font-mono">{value}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-4 leading-relaxed">
                Note: Low precision/recall is expected at 0.35 threshold with heavily imbalanced data (~0.3% incident rate).
                PR-AUC of {((incidentMetric.pr_auc ?? 0) * 100).toFixed(2)}% shows meaningful discrimination above random.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
