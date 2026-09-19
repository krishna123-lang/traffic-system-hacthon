import clsx from 'clsx';
import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: string | number;
  sub?: string;
  icon?: ReactNode;
  color?: 'default' | 'green' | 'red' | 'amber' | 'indigo' | 'purple';
  loading?: boolean;
}

const colorMap = {
  default: 'text-gray-900 dark:text-gray-100',
  green: 'text-green-600 dark:text-green-400',
  red: 'text-red-600 dark:text-red-400',
  amber: 'text-amber-600 dark:text-amber-400',
  indigo: 'text-indigo-600 dark:text-indigo-400',
  purple: 'text-purple-600 dark:text-purple-400',
};

export function KPICard({ label, value, sub, icon, color = 'default', loading }: Props) {
  return (
    <div className="card p-4 flex items-start gap-3">
      {icon && (
        <div className={clsx('p-2 rounded-lg', {
          'bg-gray-100 dark:bg-gray-700': color === 'default',
          'bg-green-50 dark:bg-green-900/30': color === 'green',
          'bg-red-50 dark:bg-red-900/30': color === 'red',
          'bg-amber-50 dark:bg-amber-900/30': color === 'amber',
          'bg-indigo-50 dark:bg-indigo-900/30': color === 'indigo',
          'bg-purple-50 dark:bg-purple-900/30': color === 'purple',
        })}>
          <span className={colorMap[color]}>{icon}</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-500 dark:text-gray-400 font-medium truncate">{label}</p>
        {loading ? (
          <div className="skeleton h-7 w-16 mt-1" />
        ) : (
          <p className={clsx('text-2xl font-bold leading-tight', colorMap[color])}>
            {value ?? '—'}
          </p>
        )}
        {sub && !loading && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">{sub}</p>
        )}
      </div>
    </div>
  );
}
