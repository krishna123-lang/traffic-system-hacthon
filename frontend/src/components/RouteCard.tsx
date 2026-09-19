import type { Route } from '../api/client';
import { Clock, TrendingUp, Shield, Star, MapPin } from 'lucide-react';
import clsx from 'clsx';

interface Props {
  route: Route;
  index: number;
  selected?: boolean;
  onSelect?: () => void;
}

const RISK_COLORS: Record<string, string> = {
  minimal: 'text-green-600 dark:text-green-400',
  low: 'text-green-600 dark:text-green-400',
  medium: 'text-amber-600 dark:text-amber-400',
  high: 'text-red-600 dark:text-red-400',
};

export function RouteCard({ route, index, selected, onSelect }: Props) {
  const isRecommended = route.rank === 1;

  return (
    <div
      onClick={onSelect}
      className={clsx(
        'card p-4 cursor-pointer transition-all duration-150',
        selected
          ? 'ring-2 ring-indigo-500 border-indigo-300 dark:border-indigo-600 bg-indigo-50/30 dark:bg-indigo-900/10'
          : 'hover:border-indigo-300 dark:hover:border-indigo-600',
        isRecommended && 'border-green-400 dark:border-green-600'
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {route.label ?? `Route ${index + 1}`}
          </span>
          {isRecommended && (
            <span className="flex items-center gap-1 badge bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
              <Star className="w-3 h-3" />
              Best
            </span>
          )}
        </div>
        {selected && <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">Selected</span>}
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-400" />
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">ETA</p>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {(route.eta_minutes ?? 0).toFixed(1)} min
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-gray-400" />
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Delay</p>
            <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
              +{(route.estimated_delay_minutes ?? 0).toFixed(1)} min
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-gray-400" />
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Risk</p>
            <p className={clsx('text-sm font-semibold capitalize', RISK_COLORS[route.risk_level] ?? 'text-gray-600')}>
              {route.risk_level ?? 'normal'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-gray-400" />
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Distance</p>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {(route.total_length_km ?? 0).toFixed(1)} km
            </p>
          </div>
        </div>
      </div>

      <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        {route.n_hops ?? route.segments?.length ?? 0} segments &middot; Congestion: {((route.avg_congestion ?? 0) * 100).toFixed(0)}%
      </div>

      {/* Why recommended bullets */}
      {route.why_recommended?.length ? (
        <ul className="space-y-0.5">
          {route.why_recommended.slice(0, 3).map((r, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-gray-600 dark:text-gray-300">
              <span className="text-green-500 mt-0.5">✓</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Why not bullets */}
      {route.why_not?.length ? (
        <ul className="space-y-0.5 mt-1">
          {route.why_not.slice(0, 2).map((r, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-gray-400 dark:text-gray-500">
              <span className="mt-0.5">↑</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
