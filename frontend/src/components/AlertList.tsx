import { formatDistanceToNow } from 'date-fns';
import type { Alert } from '../api/client';
import clsx from 'clsx';
import { AlertCircle, Info, AlertTriangle, Zap } from 'lucide-react';

const ICONS = {
  info: Info,
  warning: AlertTriangle,
  high: AlertCircle,
  critical: Zap,
};

const COLORS = {
  info: 'border-blue-400 bg-blue-50 dark:bg-blue-900/20',
  warning: 'border-amber-400 bg-amber-50 dark:bg-amber-900/20',
  high: 'border-orange-400 bg-orange-50 dark:bg-orange-900/20',
  critical: 'border-red-500 bg-red-50 dark:bg-red-900/20',
};

const TEXT_COLORS = {
  info: 'text-blue-600 dark:text-blue-400',
  warning: 'text-amber-600 dark:text-amber-400',
  high: 'text-orange-600 dark:text-orange-400',
  critical: 'text-red-600 dark:text-red-400',
};

interface Props {
  alerts: Alert[];
  loading?: boolean;
  maxHeight?: string;
}

export function AlertList({ alerts, loading, maxHeight = 'max-h-96' }: Props) {
  if (loading) {
    return (
      <div className="space-y-2 p-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton h-16 rounded-lg" />
        ))}
      </div>
    );
  }

  if (!alerts.length) {
    return (
      <div className="p-6 text-center text-gray-400 dark:text-gray-500 text-sm">
        No active alerts
      </div>
    );
  }

  return (
    <div className={clsx('overflow-y-auto space-y-2 p-2', maxHeight)}>
      {alerts.map((alert, index) => {
        const Icon = ICONS[alert.severity] ?? Info;
        const text = alert.title ?? alert.description ?? alert.alert_type ?? 'Traffic alert';
        const timeAgo = (() => {
          try { return formatDistanceToNow(new Date(alert.timestamp), { addSuffix: true }); }
          catch { return alert.timestamp; }
        })();
        return (
          <div
            key={alert.alert_id ?? alert.alert_id ?? index}
            className={clsx(
              'flex items-start gap-3 p-3 rounded-lg border transition-all',
              COLORS[alert.severity]
            )}
          >
            <Icon className={clsx('w-4 h-4 shrink-0 mt-0.5', TEXT_COLORS[alert.severity])} />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-800 dark:text-gray-200 leading-snug">{text}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-gray-400 dark:text-gray-500">{timeAgo}</span>
                {alert.segment_id && (
                  <span className="text-xs font-mono text-gray-400 dark:text-gray-500 truncate">
                    {alert.segment_id}
                  </span>
                )}
              </div>
            </div>
            <span className={clsx('text-xs font-semibold uppercase shrink-0', TEXT_COLORS[alert.severity])}>
              {alert.severity}
            </span>
          </div>
        );
      })}
    </div>
  );
}
