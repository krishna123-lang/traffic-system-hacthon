import { useQuery } from '@tanstack/react-query';
import { fetchDataHealth } from '../api/client';
import { CheckCircle, XCircle, Database, Clock } from 'lucide-react';
import clsx from 'clsx';

const DATASET_LABELS: Record<string, string> = {
  traffic_train: 'Traffic (Training)',
  traffic_validation: 'Traffic (Validation)',
  incidents_train: 'Incidents (Training)',
  context_train: 'Context (Training)',
  roadworks_train: 'Roadworks (Training)',
  signal_plans: 'Signal Plans',
  turn_restrictions: 'Turn Restrictions',
  planning_candidates: 'Planning Candidates',
};

export default function DataHealth() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['data-health'],
    queryFn: fetchDataHealth,
    staleTime: 60000,
  });

  // API returns plain object; filter out non-dataset fields (e.g. "timestamp" is an ISO string, not a dataset)
  const datasets = data
    ? Object.entries(data).filter(([, v]) => v !== null && typeof v === 'object')
    : [];
  const lastUpdated: string | null = (data as any)?.timestamp ?? null;

  const healthy = datasets.filter(([, d]) => (d as any).status === 'ok').length;
  const warnings = datasets.filter(([, d]) => (d as any).status === 'warning').length;
  const errors = datasets.filter(([, d]) => (d as any).status === 'error').length;


  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Data Health</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Dataset completeness, quality metrics, and connectivity status
          </p>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Healthy Datasets', value: healthy, icon: CheckCircle, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20' },
            { label: 'Warnings', value: warnings, icon: XCircle, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
            { label: 'Errors', value: errors, icon: XCircle, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20' },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className={clsx('card p-4 flex items-center gap-3', bg)}>
              <Icon className={clsx('w-8 h-8', color)} />
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                <p className={clsx('text-3xl font-bold', color)}>{isLoading ? '—' : value}</p>
              </div>
            </div>
          ))}
        </div>

        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-20 rounded-xl" />)}
          </div>
        )}

        {isError && (
          <div className="card p-8 text-center text-gray-400 dark:text-gray-500">
            Failed to load data health information
          </div>
        )}

        {/* Dataset cards */}
        {datasets.length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <Database className="w-4 h-4 text-indigo-500" />
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Dataset Status</h2>
              {lastUpdated && (
                <span className="ml-auto flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                  <Clock className="w-3 h-3" />
                  Last updated: {new Date(lastUpdated).toLocaleString('en-GB', {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
                  })} UTC
                </span>
              )}
            </div>
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {datasets.map(([key, dsRaw]) => {
                const ds = dsRaw as any;
                const isOk = ds.status === 'ok';
                return (
                  <div
                    key={key}
                    className="flex items-center gap-4 px-4 py-4 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                  >
                    {isOk
                      ? <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                      : <XCircle className="w-5 h-5 text-red-500 shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {DATASET_LABELS[key] ?? key.replace(/_/g, ' ')}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {ds.rows != null && <span>{ds.rows.toLocaleString()} rows</span>}
                        {ds.segments != null && <span className="ml-2">· {ds.segments} segments</span>}
                        {ds.time_range && (
                          <span className="ml-2 flex items-center gap-1 inline-flex">
                            <Clock className="w-3 h-3" />
                            {ds.time_range.start} → {ds.time_range.end}
                          </span>
                        )}
                      </p>
                    </div>

                    {/* Missing % bar */}
                    {ds.missing_pct && Object.keys(ds.missing_pct).length > 0 ? (
                      <div className="flex items-center gap-2 min-w-[130px]">
                        <div className="flex-1 h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min((Object.values(ds.missing_pct) as number[]).reduce((a: number, b: number) => a + b, 0) / Math.max(Object.keys(ds.missing_pct).length, 1), 100)}%`,
                              background: '#22c55e',
                            }}
                          />
                        </div>
                        <span className="text-xs text-gray-400 dark:text-gray-500">0% missing</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 min-w-[130px]">
                        <div className="flex-1 h-2 rounded-full bg-green-200 dark:bg-green-900/30 overflow-hidden">
                          <div className="h-full w-full rounded-full bg-green-500" />
                        </div>
                        <span className="text-xs text-green-600 dark:text-green-400">Complete</span>
                      </div>
                    )}

                    <span className={clsx(
                      'badge text-xs shrink-0',
                      isOk
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    )}>
                      {isOk ? 'ok' : ds.status}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Network summary */}
        {!isLoading && (
          <div className="grid grid-cols-2 gap-4">
            <div className="card p-4">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Training Window</h2>
              <div className="space-y-2">
                {data?.traffic_train?.time_range && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Start</span>
                      <span className="font-mono text-gray-800 dark:text-gray-200">{data.traffic_train.time_range.start}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">End</span>
                      <span className="font-mono text-gray-800 dark:text-gray-200">{data.traffic_train.time_range.end}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 dark:text-gray-400">Segments</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{data?.traffic_train?.segments ?? '—'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 dark:text-gray-400">Train rows</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{(data?.traffic_train?.rows ?? 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 dark:text-gray-400">Val rows</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{(data?.traffic_validation?.rows ?? 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
            <div className="card p-4">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Optional Datasets</h2>
              <div className="space-y-2">
                {[
                  ['incidents_train', 'Incidents'],
                  ['context_train', 'Context (weather/events)'],
                  ['roadworks_train', 'Roadworks'],
                ].map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400">{label}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-gray-800 dark:text-gray-200">
                        {(data as any)?.[key]?.rows ?? 0} rows
                      </span>
                      {(data as any)?.[key]?.status === 'ok'
                        ? <CheckCircle className="w-4 h-4 text-green-500" />
                        : <XCircle className="w-4 h-4 text-gray-400" />
                      }
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
