import type { XAIExplanation, AINoRouteAction } from '../stores/journeyStore';
import {
  AlertTriangle, Brain, Lightbulb, Shield, X, ChevronRight,
  Clock, Layers, Zap, AlertOctagon, CheckCircle2
} from 'lucide-react';
import clsx from 'clsx';

interface Props {
  xai?: XAIExplanation | null;
  noRouteAction?: AINoRouteAction | null;
  onDismiss?: () => void;
  onDivert?: () => void;
  compact?: boolean;
}

const SEVERITY_CONFIG = [
  {},
  { label: 'Minor', bg: 'bg-amber-500', light: 'bg-amber-50 dark:bg-amber-900/15', border: 'border-amber-300 dark:border-amber-700', text: 'text-amber-700 dark:text-amber-300' },
  { label: 'Moderate', bg: 'bg-orange-500', light: 'bg-orange-50 dark:bg-orange-900/15', border: 'border-orange-300 dark:border-orange-700', text: 'text-orange-700 dark:text-orange-300' },
  { label: 'Severe', bg: 'bg-red-500', light: 'bg-red-50 dark:bg-red-900/15', border: 'border-red-300 dark:border-red-700', text: 'text-red-700 dark:text-red-300' },
];

export function XAIPanel({ xai, noRouteAction, onDismiss, onDivert, compact = false }: Props) {
  // No-route action panel
  if (noRouteAction && !xai) {
    return (
      <div className="rounded-xl border border-red-400 dark:border-red-600 overflow-hidden">
        <div className="bg-red-600 px-4 py-3 flex items-center gap-3">
          <AlertOctagon className="w-5 h-5 text-white shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-bold text-white">AI Emergency Guidance — No Safe Route</p>
            <p className="text-xs text-white/80">{noRouteAction.title}</p>
          </div>
          {onDismiss && <button onClick={onDismiss} className="text-white/70 hover:text-white"><X className="w-4 h-4" /></button>}
        </div>
        <div className="bg-red-50 dark:bg-red-900/15 p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs text-red-700 dark:text-red-300 font-semibold">
            <Clock className="w-3.5 h-3.5" />
            Estimated impact: {noRouteAction.eta}
          </div>
          <div className="space-y-2">
            {noRouteAction.steps.map((step, i) => (
              <div key={i} className="flex items-start gap-2.5 text-sm text-gray-800 dark:text-gray-200">
                <span className="w-5 h-5 rounded-full bg-red-600 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <span>{step}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!xai) return null;

  const sev = Math.min(Math.max(xai.severity, 1), 3);
  const cfg = SEVERITY_CONFIG[sev];

  if (compact) {
    return (
      <div className={clsx('rounded-xl border p-3 flex items-start gap-3', cfg.light, cfg.border)}>
        <AlertTriangle className={clsx('w-4 h-4 shrink-0 mt-0.5', sev === 3 ? 'text-red-500' : sev === 2 ? 'text-orange-500' : 'text-amber-500')} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-gray-900 dark:text-gray-100">{xai.title}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{xai.cause} · {xai.laneCapacityLoss}</p>
        </div>
        {onDismiss && <button onClick={onDismiss} className="text-gray-400 hover:text-gray-600 shrink-0"><X className="w-3.5 h-3.5" /></button>}
      </div>
    );
  }

  return (
    <div className={clsx('rounded-xl border overflow-hidden shadow-lg', cfg.border)}>
      {/* Header */}
      <div className={clsx('px-4 py-3 flex items-center gap-3', cfg.bg)}>
        <Brain className="w-5 h-5 text-white shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white leading-tight">{xai.title}</p>
          <p className="text-xs text-white/80 mt-0.5 font-mono">{xai.segmentId} · Severity {xai.severity}/3 · {((xai.confidence) * 100).toFixed(0)}% confidence</p>
        </div>
        <span className="badge bg-white/20 text-white text-xs px-2 py-0.5 shrink-0">{cfg.label}</span>
        {onDismiss && <button onClick={onDismiss} className="text-white/70 hover:text-white ml-1"><X className="w-4 h-4" /></button>}
      </div>

      <div className={clsx('p-4 space-y-3', cfg.light)}>
        {/* What + Why */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white dark:bg-gray-800/90 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-1.5 mb-2">
              <AlertTriangle className={clsx('w-3.5 h-3.5', sev === 3 ? 'text-red-500' : sev === 2 ? 'text-orange-500' : 'text-amber-500')} />
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">What Happened</span>
            </div>
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{xai.cause}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{xai.segmentId}</p>
          </div>
          <div className="bg-white dark:bg-gray-800/90 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-1.5 mb-2">
              <Brain className="w-3.5 h-3.5 text-indigo-500" />
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Root Cause (XAI)</span>
            </div>
            <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{xai.why}</p>
          </div>
        </div>

        {/* Impact metrics */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white dark:bg-gray-800/90 rounded-lg p-2.5 border border-gray-200 dark:border-gray-700 text-center">
            <Layers className="w-4 h-4 text-purple-500 mx-auto mb-1" />
            <p className="text-xs text-gray-400 dark:text-gray-500">Lanes Blocked</p>
            <p className="text-xs font-bold text-gray-800 dark:text-gray-200 mt-0.5">{xai.laneCapacityLoss}</p>
          </div>
          <div className="bg-white dark:bg-gray-800/90 rounded-lg p-2.5 border border-gray-200 dark:border-gray-700 text-center">
            <Clock className="w-4 h-4 text-blue-500 mx-auto mb-1" />
            <p className="text-xs text-gray-400 dark:text-gray-500">Est. Clearance</p>
            <p className="text-xs font-bold text-gray-800 dark:text-gray-200 mt-0.5">{xai.estimatedClearance}</p>
          </div>
          <div className="bg-white dark:bg-gray-800/90 rounded-lg p-2.5 border border-gray-200 dark:border-gray-700 text-center">
            <Shield className="w-4 h-4 text-indigo-500 mx-auto mb-1" />
            <p className="text-xs text-gray-400 dark:text-gray-500">AI Confidence</p>
            <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 mt-0.5">{((xai.confidence) * 100).toFixed(0)}%</p>
          </div>
        </div>

        {/* Traffic impact description */}
        <div className="bg-white dark:bg-gray-800/90 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Shield className="w-3.5 h-3.5 text-purple-500" />
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Traffic Impact</span>
          </div>
          <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{xai.impact}</p>
        </div>

        {/* Evidence */}
        {xai.evidence?.length > 0 && (
          <div className="bg-white dark:bg-gray-800/90 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              AI Evidence ({xai.evidence.length} indicators)
            </p>
            <div className="space-y-1">
              {xai.evidence.map((e, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300">
                  <ChevronRight className="w-3 h-3 shrink-0 mt-0.5 text-indigo-400" />
                  <span>{e}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recommendation */}
        <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-3 border border-indigo-200 dark:border-indigo-700">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Lightbulb className="w-3.5 h-3.5 text-indigo-500" />
            <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 uppercase tracking-wide">AI Recommendation</span>
          </div>
          <p className="text-xs text-indigo-800 dark:text-indigo-200 leading-relaxed">{xai.recommendation}</p>
        </div>

        {/* If no diversion available — alternative action */}
        {xai.alternativeAction && (
          <div className="bg-gray-50 dark:bg-gray-800/60 rounded-lg p-3 border border-gray-200 dark:border-gray-600">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">If No Diversion Available</span>
            </div>
            <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{xai.alternativeAction}</p>
          </div>
        )}
      </div>
    </div>
  );
}
