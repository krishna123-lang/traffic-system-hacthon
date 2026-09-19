import { useJourneyStore, formatSimTime, formatSimDateTime } from '../stores/journeyStore';
import { Navigation, AlertTriangle, CheckCircle, Route, Clock, X, AlertOctagon } from 'lucide-react';
import { XAIPanel } from './XAIPanel';
import { useState } from 'react';
import clsx from 'clsx';


interface Props {
  className?: string;
}

export function JourneyBanner({ className }: Props) {
  const {
    journeyActive, sourceNode, targetNode, departureTime,
    selectedRoute, simTimestamp, simStep, totalSteps,
    activeIncidents, routeIncidents, currentXAI,
    acknowledgeIncident, resetJourney,
    diversionRoute, noRouteAvailable, noRouteAction,
  } = useJourneyStore();

  const [showXAI, setShowXAI] = useState(false);

  if (!journeyActive) return null;

  const progress = totalSteps > 0 ? (simStep / totalSteps) * 100 : 0;
  const eta = selectedRoute?.eta_minutes ?? 0;
  const elapsedMin = simStep * 5;
  const remainMin = Math.max(0, eta - elapsedMin);
  const hasActiveIncidents = activeIncidents.length > 0;
  const arrived = simStep >= totalSteps;

  return (
    <div className={clsx('space-y-2', className)}>
      {/* Main status bar */}
      <div className={clsx(
        'rounded-xl border px-4 py-3',
        hasActiveIncidents
          ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700'
          : arrived
          ? 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700'
          : 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-300 dark:border-indigo-700'
      )}>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Route */}
          <div className="flex items-center gap-2">
            {arrived
              ? <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
              : hasActiveIncidents
              ? <AlertTriangle className="w-4 h-4 text-red-500 animate-pulse" />
              : <Navigation className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            }
            <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
              {arrived ? 'Arrived!' : hasActiveIncidents ? 'INCIDENT ALERT' : 'Journey Active'}
            </span>
          </div>

          <div className="flex items-center gap-1 text-sm font-mono text-gray-700 dark:text-gray-300">
            <span className="font-semibold text-indigo-700 dark:text-indigo-300">{sourceNode}</span>
            <Route className="w-3.5 h-3.5 text-gray-400" />
            <span className="font-semibold text-indigo-700 dark:text-indigo-300">{targetNode}</span>
          </div>

          <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
            <Clock className="w-3 h-3" />
            Dep: {formatSimTime(departureTime)}
          </div>

          {/* Sim clock */}
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-mono font-bold">
            {formatSimDateTime(simTimestamp)}
          </div>

          {/* Journey stats */}
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {arrived ? 'Journey complete!' : `${elapsedMin}/${Math.round(eta)} min · ${remainMin} min remaining`}
          </div>

          {/* Incidents summary */}
          {routeIncidents.length > 0 && (
            <button
              onClick={() => setShowXAI(!showXAI)}
              className={clsx(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors',
                hasActiveIncidents
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 animate-pulse'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
              )}
            >
              <AlertTriangle className="w-3 h-3" />
              {activeIncidents.length > 0 ? `${activeIncidents.length} ACTIVE` : `${routeIncidents.length} on route`}
            </button>
          )}

          {diversionRoute && (
            <span className="badge bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs">
              Diversion active
            </span>
          )}

          {/* Reset */}
          <button
            onClick={resetJourney}
            className="ml-auto text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            title="Clear journey"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="mt-2.5 h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div
            className={clsx(
              'h-full rounded-full transition-all duration-500',
              hasActiveIncidents ? 'bg-red-500' : arrived ? 'bg-green-500' : 'bg-indigo-500'
            )}
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>

        {/* Timeline ticks for route incidents */}
        {routeIncidents.length > 0 && totalSteps > 0 && (
          <div className="mt-1 relative h-3">
            {routeIncidents.map(inc => {
              // Estimate which step this incident hits
              const incStart = new Date(inc.start_time?.replace(' ', 'T') ?? '');
              const dep = new Date(departureTime.replace(' ', 'T'));
              const diffMin = (incStart.getTime() - dep.getTime()) / 60000;
              const incStep = Math.round(diffMin / 5);
              const pct = totalSteps > 0 ? (incStep / totalSteps) * 100 : 0;
              if (pct < 0 || pct > 100) return null;
              const isActive = activeIncidents.some(a => a.incident_id === inc.incident_id);
              return (
                <div
                  key={inc.incident_id}
                  className={clsx(
                    'absolute top-0 w-2 h-2 rounded-full border-2 border-white dark:border-gray-800 transform -translate-x-1/2',
                    isActive ? 'bg-red-500 animate-pulse' : 'bg-amber-500'
                  )}
                  style={{ left: `${pct}%` }}
                  title={`${inc.incident_type} on ${inc.segment_id} at ${inc.start_time}`}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* XAI panel — shown when incidents exist + toggled or auto-shown when active */}
      {(showXAI || (hasActiveIncidents && currentXAI)) && (currentXAI || noRouteAction) && (
        <XAIPanel
          xai={currentXAI}
          noRouteAction={noRouteAction}
          onDismiss={currentXAI ? () => {
            acknowledgeIncident(currentXAI.incidentId);
            setShowXAI(false);
          } : undefined}
        />
      )}

      {/* Active incident mini alerts */}
      {activeIncidents.length > 0 && !showXAI && (
        <div className="space-y-1">
          {activeIncidents.map(inc => (
            <div
              key={inc.incident_id}
              className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 px-3 py-2 flex items-center gap-2"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0 animate-pulse" />
              <span className="text-xs font-semibold text-red-700 dark:text-red-400">
                {inc.incident_type?.replace(/_/g, ' ')} on {inc.segment_id}
              </span>
              <span className="text-xs text-red-500 dark:text-red-400 ml-auto">{inc.start_time?.slice(11, 16)}</span>
              <button
                onClick={() => setShowXAI(true)}
                className="text-xs text-indigo-600 dark:text-indigo-400 underline"
              >
                Why?
              </button>
              <button onClick={() => acknowledgeIncident(inc.incident_id)} className="text-gray-400 hover:text-gray-600">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
