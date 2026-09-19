import type { CongestionState as _CS } from '../api/client';

export type CongestionState = _CS;

export const CONGESTION_COLORS: Record<CongestionState, string> = {
  normal: '#22c55e',
  low_risk: '#84cc16',
  moderate: '#eab308',
  high: '#f97316',
  severe: '#ef4444',
  incident: '#8b5cf6',
};

export const CONGESTION_LABELS: Record<CongestionState, string> = {
  normal: 'Normal',
  low_risk: 'Low Risk',
  moderate: 'Moderate',
  high: 'High',
  severe: 'Severe',
  incident: 'Incident',
};

export const CONGESTION_BG: Record<CongestionState, string> = {
  normal: 'bg-green-500',
  low_risk: 'bg-lime-500',
  moderate: 'bg-yellow-500',
  high: 'bg-orange-500',
  severe: 'bg-red-500',
  incident: 'bg-purple-600',
};

export const CONGESTION_TEXT: Record<CongestionState, string> = {
  normal: 'text-green-600 dark:text-green-400',
  low_risk: 'text-lime-600 dark:text-lime-400',
  moderate: 'text-yellow-600 dark:text-yellow-400',
  high: 'text-orange-600 dark:text-orange-400',
  severe: 'text-red-600 dark:text-red-400',
  incident: 'text-purple-600 dark:text-purple-400',
};

export const CONGESTION_BORDER: Record<CongestionState, string> = {
  normal: 'border-green-500',
  low_risk: 'border-lime-500',
  moderate: 'border-yellow-500',
  high: 'border-orange-500',
  severe: 'border-red-500',
  incident: 'border-purple-600',
};

export function getCongestionColor(state: CongestionState): string {
  return CONGESTION_COLORS[state] ?? '#6b7280';
}

export function getCongestionLabel(state: CongestionState): string {
  return CONGESTION_LABELS[state] ?? state;
}

export function scoreToState(score: number): CongestionState {
  if (score < 0.25) return 'normal';
  if (score < 0.45) return 'low_risk';
  if (score < 0.60) return 'moderate';
  if (score < 0.75) return 'high';
  return 'severe';
}

export function severityColor(severity: string): string {
  switch (severity) {
    case 'info': return 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/30';
    case 'warning': return 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/30';
    case 'high': return 'text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-900/30';
    case 'critical': return 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-900/30';
    case 'low': return 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-900/30';
    case 'medium': return 'text-yellow-600 bg-yellow-50 dark:text-yellow-400 dark:bg-yellow-900/30';
    default: return 'text-gray-600 bg-gray-50 dark:text-gray-400 dark:bg-gray-800';
  }
}

export function getMapLineColor(): unknown[] {
  return [
    'match',
    ['get', 'congestion_state'],
    'normal', '#22c55e',
    'low_risk', '#84cc16',
    'moderate', '#eab308',
    'high', '#f97316',
    'severe', '#ef4444',
    'incident', '#8b5cf6',
    '#6b7280',
  ];
}

export function getMapLineWidth(): unknown[] {
  return [
    'match',
    ['get', 'road_class'],
    'arterial', 4,
    'collector', 3,
    'local', 2,
    2,
  ];
}
