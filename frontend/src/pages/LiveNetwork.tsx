import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { fetchState, fetchRoutes, fetchIncidents } from '../api/client';
import { useNetwork } from '../hooks/useNetwork';
import { NetworkMap } from '../components/NetworkMap';
import { SegmentDrawer } from '../components/SegmentDrawer';
import { XAIPanel } from '../components/XAIPanel';
import {
  useJourneyStore, formatSimDateTime, formatSimTime,
  type AINoRouteAction,
} from '../stores/journeyStore';
import type { Route } from '../api/client';
import {
  Navigation, Play, Pause, RotateCcw, MapPin, Clock,
  AlertTriangle, Zap, CheckCircle, ChevronRight, Info, AlertOctagon
} from 'lucide-react';
import clsx from 'clsx';

// Speed interval (ms per tick) — 2 min real time per tick
const SPEED_INTERVALS: Record<number, number> = { 1: 2000, 2: 1000, 5: 400 };

// Preset journey scenarios known to hit incident segments
const PRESETS = [
  { label: 'N001 → N060 — Jan 11 13:30 (accident at R0075)', src: 'N001', dst: 'N060', time: '2026-01-11 13:30:00' },
  { label: 'N001 → N060 — Jan 15 06:00 (lane blockage)', src: 'N001', dst: 'N060', time: '2026-01-15 06:00:00' },
  { label: 'N001 → N060 — Jan 07 13:00 (lane blockage R0161)', src: 'N001', dst: 'N060', time: '2026-01-07 13:00:00' },
  { label: 'N001 → N060 — Jan 15 17:30 (severe blockage)', src: 'N001', dst: 'N060', time: '2026-01-15 17:30:00' },
  { label: 'Custom departure...', src: '', dst: '', time: '' },
];

export default function LiveNetwork() {
  const [selectedSegment, setSelectedSegment] = useState<string | null>(null);
  const [presetIdx, setPresetIdx] = useState(0);
  const [customSrc, setCustomSrc] = useState('');
  const [customDst, setCustomDst] = useState('');
  const [customTime, setCustomTime] = useState('2026-01-11 13:00:00');
  const [showXAIFull, setShowXAIFull] = useState(false);

  const {
    sourceNode, targetNode, departureTime,
    journeyActive, allRoutes, selectedRoute, selectedRouteIdx, routeSegments, routeNodes,
    simTimestamp, simStep, totalSteps, isPlaying, speed,
    activeIncidents, routeIncidents, nearbyIncidents, currentXAI,
    noRouteAvailable, noRouteAction,
    diversionRoute, diversionTriggeredBy,
    setSource, setTarget, setDepartureTime,
    startJourney, selectRoute, tick, setPlaying, setSpeed, setStep, resetJourney,
    acknowledgeIncident,
  } = useJourneyStore();

  const { data: network } = useNetwork();
  const { data: stateData } = useQuery({
    queryKey: ['state'],
    queryFn: () => fetchState(),
    refetchInterval: 30000,
  });
  const { data: incidentsData } = useQuery({
    queryKey: ['incidents'],
    queryFn: fetchIncidents,
    staleTime: 300000,
  });

  // Determine effective source/dest/time
  const preset = PRESETS[presetIdx];
  const isCustom = preset.src === '';
  const effectiveSrc = isCustom ? customSrc : preset.src;
  const effectiveDst = isCustom ? customDst : preset.dst;
  const effectiveTime = isCustom ? customTime : preset.time;

  // Sync to journey store on preset change
  useEffect(() => {
    if (!journeyActive) {
      setSource(effectiveSrc);
      setTarget(effectiveDst);
      setDepartureTime(effectiveTime);
    }
  }, [presetIdx, effectiveSrc, effectiveDst, effectiveTime, journeyActive]);

  // Plan journey mutation
  const { mutate: planJourney, isPending: planning, isError: planError } = useMutation({
    mutationFn: () => fetchRoutes(effectiveSrc, effectiveDst),
    onSuccess: (data) => {
      const routes: Route[] = data.routes ?? [];
      const incidents = incidentsData?.incidents ?? [];
      startJourney(routes, incidents);
      setShowXAIFull(false);
    },
  });

  // Auto-show full XAI when incident detected
  useEffect(() => {
    if (activeIncidents.length > 0) setShowXAIFull(true);
  }, [activeIncidents.length]);

  // Play timer
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setInterval(() => tick(), SPEED_INTERVALS[speed] ?? 2000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isPlaying, speed, tick]);

  const nodes = network?.nodes ?? [];
  const segmentStates = stateData?.segments ?? [];
  const routes: Route[] = allRoutes;
  const progress = totalSteps > 0 ? simStep / totalSteps : 0;
  const arrived = journeyActive && simStep >= totalSteps;

  // Current vehicle node (for map animation)
  const vehicleNodeIdx = Math.min(simStep, routeNodes.length - 1);
  const vehicleNodeId = routeNodes[vehicleNodeIdx] ?? null;

  // Active diversion segments to highlight differently
  const diversionSegs = diversionRoute?.segments ?? [];

  return (
    <div className="flex h-full overflow-hidden">
      {/* Map — full height */}
      <div className="flex-1 relative">
        {network ? (
          <NetworkMap
            network={network}
            segmentStates={segmentStates}
            incidentSegment={activeIncidents[0]?.segment_id ?? null}
            propagationSegments={nearbyIncidents.map(i => i.segment_id)}
            onSegmentClick={setSelectedSegment}
            selectedSegmentId={selectedSegment}
            height="h-full"
            showIncidentMarker={activeIncidents.length > 0}
            highlightSegments={routeSegments}
            diversionSegments={diversionSegs}
            vehicleNodeId={vehicleNodeId}
          />
        ) : (
          <div className="skeleton h-full w-full" />
        )}

        {/* Map overlay: incident alert */}
        {activeIncidents.length > 0 && (
          <div className="absolute top-3 left-3 right-20 z-10 space-y-1.5 pointer-events-none">
            {activeIncidents.map(inc => (
              <div
                key={inc.incident_id}
                className="rounded-xl bg-red-600 text-white px-3 py-2 shadow-xl flex items-center gap-2"
              >
                <AlertTriangle className="w-4 h-4 shrink-0 animate-pulse" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-bold">{inc.incident_type?.replace(/_/g, ' ').toUpperCase()}</span>
                  <span className="text-xs text-white/80 ml-2 font-mono">{inc.segment_id}</span>
                </div>
                <span className="text-xs text-white/70 font-mono shrink-0">{inc.start_time?.slice(11, 16)}</span>
              </div>
            ))}
          </div>
        )}

        {/* No-route overlay */}
        {noRouteAvailable && (
          <div className="absolute top-3 left-3 right-3 z-10 pointer-events-none">
            <div className="rounded-xl bg-red-800 text-white px-4 py-3 shadow-xl flex items-center gap-3">
              <AlertOctagon className="w-5 h-5 shrink-0" />
              <div>
                <p className="text-sm font-bold">ALL ROUTES BLOCKED</p>
                <p className="text-xs text-white/80">AI guidance provided — see panel →</p>
              </div>
            </div>
          </div>
        )}

        {/* Diversion route notification on map */}
        {diversionRoute && !noRouteAvailable && (
          <div className="absolute top-3 left-3 right-3 z-10 pointer-events-none">
            <div className="rounded-xl bg-green-600 text-white px-4 py-2.5 shadow-xl flex items-center gap-2">
              <Zap className="w-4 h-4 shrink-0" />
              <span className="text-sm font-bold">Auto-Diversion Active:</span>
              <span className="text-xs text-white/90 font-mono ml-1">{diversionRoute.label}</span>
              <span className="text-xs text-white/70 ml-auto">{(diversionRoute.eta_minutes ?? 0).toFixed(0)} min · {(diversionRoute.total_length_km ?? 0).toFixed(1)} km</span>
            </div>
          </div>
        )}

        {/* Arrived overlay */}
        {arrived && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10">
            <div className="rounded-xl bg-green-600 text-white px-6 py-3 shadow-xl flex items-center gap-3">
              <CheckCircle className="w-6 h-6" />
              <div>
                <p className="text-sm font-bold">Arrived at destination!</p>
                <p className="text-xs text-white/80">Journey simulated: {Math.round(totalSteps * 2)} min</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right panel */}
      <div className="w-96 flex flex-col border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        <div className="flex-1 overflow-y-auto">

          {/* Journey setup */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
              <Navigation className="w-4 h-4 text-indigo-500" />
              Journey Simulation
              {journeyActive && (
                <span className="ml-auto badge bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 text-xs">Active</span>
              )}
            </h2>

            {!journeyActive ? (
              <div className="space-y-3">
                {/* Scenario picker */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
                    <Zap className="w-3 h-3 inline mr-1 text-amber-500" />Select Scenario
                  </label>
                  <select
                    className="select w-full text-sm"
                    value={presetIdx}
                    onChange={e => setPresetIdx(Number(e.target.value))}
                  >
                    {PRESETS.map((p, i) => (
                      <option key={i} value={i}>{p.label}</option>
                    ))}
                  </select>
                  <p className="text-xs text-indigo-500 dark:text-indigo-400 mt-1 flex items-center gap-1">
                    <Info className="w-3 h-3" />
                    Pre-selected scenarios are guaranteed to hit incidents from the dataset
                  </p>
                </div>

                {/* Custom inputs */}
                {isCustom && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">
                          <MapPin className="w-3 h-3 inline mr-1 text-green-500" />Origin
                        </label>
                        <select className="select w-full text-xs" value={customSrc} onChange={e => setCustomSrc(e.target.value)}>
                          <option value="">Origin...</option>
                          {nodes.map(n => <option key={n.node_id} value={n.node_id}>{n.node_id}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">
                          <MapPin className="w-3 h-3 inline mr-1 text-red-500" />Destination
                        </label>
                        <select className="select w-full text-xs" value={customDst} onChange={e => setCustomDst(e.target.value)}>
                          <option value="">Destination...</option>
                          {nodes.map(n => <option key={n.node_id} value={n.node_id}>{n.node_id}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        <Clock className="w-3 h-3 inline mr-1 text-indigo-500" />Departure (dataset: Jan 1–15 2026)
                      </label>
                      <input
                        type="text"
                        className="select w-full text-xs"
                        value={customTime}
                        onChange={e => setCustomTime(e.target.value)}
                        placeholder="2026-01-01 08:00:00"
                      />
                    </div>
                  </>
                )}

                <button
                  className="btn-primary w-full text-sm flex items-center justify-center gap-2"
                  disabled={!effectiveSrc || !effectiveDst || planning}
                  onClick={() => planJourney()}
                >
                  <Navigation className="w-4 h-4" />
                  {planning ? 'Planning...' : 'Plan & Simulate Journey'}
                </button>
                {planError && <p className="text-xs text-red-500">Failed to fetch routes. Try again.</p>}
              </div>
            ) : (
              <button
                className="w-full px-4 py-2 rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 text-sm hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                onClick={() => { resetJourney(); setShowXAIFull(false); }}
              >
                ✕ Clear Journey
              </button>
            )}
          </div>

          {/* Journey stats */}
          {journeyActive && selectedRoute && (
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="grid grid-cols-2 gap-2 mb-2">
                {[
                  { label: 'From', value: sourceNode },
                  { label: 'To', value: targetNode },
                  { label: 'Depart', value: formatSimTime(departureTime) },
                  { label: 'ETA', value: `${Math.round(selectedRoute.eta_minutes ?? 0)} min` },
                  { label: 'Distance', value: `${(selectedRoute.total_length_km ?? 0).toFixed(1)} km` },
                  { label: 'Sim Time', value: formatSimDateTime(simTimestamp) },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center gap-2 text-xs">
                    <span className="text-gray-400 w-14 shrink-0">{label}</span>
                    <span className="font-semibold text-gray-800 dark:text-gray-200 font-mono">{value}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs font-mono text-gray-400 truncate">
                {routeNodes.slice(0, 8).join(' → ')}{routeNodes.length > 8 ? ` +${routeNodes.length - 8}` : ''}
              </p>
            </div>
          )}

          {/* Route options */}
          {journeyActive && routes.length > 0 && (
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Route Options
              </h3>
              <div className="space-y-1.5">
                {routes.map((r, i) => {
                  const hasIncident = routeIncidents.some(inc => r.segments?.includes(inc.segment_id));
                  const isActive = selectedRouteIdx === i;
                  const isDiversion = diversionRoute?.label === r.label;
                  return (
                    <button
                      key={`${r.label}-${i}`}
                      onClick={() => selectRoute(i)}
                      className={clsx(
                        'w-full text-left px-3 py-2 rounded-lg border transition-all text-xs',
                        isDiversion ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                        : isActive ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                        : hasIncident ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/10 opacity-75'
                        : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300'
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-gray-800 dark:text-gray-200">
                          {r.label}
                          {isDiversion && <span className="ml-1 text-green-600">⚡ Diversion</span>}
                          {r.rank === 1 && !isDiversion && <span className="ml-1 text-gray-400">★</span>}
                        </span>
                        {hasIncident && (
                          <span className="badge bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 text-xs flex items-center gap-0.5">
                            <AlertTriangle className="w-2.5 h-2.5" /> blocked
                          </span>
                        )}
                      </div>
                      <div className="flex gap-3 text-gray-500 dark:text-gray-400">
                        <span>{(r.eta_minutes ?? 0).toFixed(0)} min</span>
                        <span>{(r.total_length_km ?? 0).toFixed(1)} km</span>
                        <span className="capitalize">{r.risk_level}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Incident alerts + XAI */}
          {journeyActive && (activeIncidents.length > 0 || noRouteAvailable) && (
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className={clsx(
                  'text-xs font-bold uppercase tracking-wide flex items-center gap-1',
                  noRouteAvailable ? 'text-red-700 dark:text-red-400' : 'text-red-600 dark:text-red-400'
                )}>
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {noRouteAvailable ? 'All Routes Blocked' : `${activeIncidents.length} Active Incident${activeIncidents.length > 1 ? 's' : ''}`}
                </h3>
                <button
                  onClick={() => setShowXAIFull(v => !v)}
                  className="text-xs text-indigo-500 underline"
                >
                  {showXAIFull ? 'Hide detail' : 'Full explanation'}
                </button>
              </div>

              {showXAIFull && (
                <XAIPanel
                  xai={currentXAI}
                  noRouteAction={noRouteAction}
                  onDismiss={currentXAI ? () => {
                    acknowledgeIncident(currentXAI.incidentId);
                    setShowXAIFull(false);
                  } : undefined}
                />
              )}

              {!showXAIFull && currentXAI && (
                <div
                  className={clsx(
                    'rounded-lg border p-3 cursor-pointer',
                    'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700'
                  )}
                  onClick={() => setShowXAIFull(true)}
                >
                  <p className="text-xs font-bold text-red-800 dark:text-red-300">{currentXAI.title}</p>
                  <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{currentXAI.cause} · {currentXAI.laneCapacityLoss}</p>
                  <p className="text-xs text-indigo-500 mt-1">Tap for full XAI explanation →</p>
                </div>
              )}

              {!showXAIFull && noRouteAvailable && noRouteAction && (
                <div
                  className="rounded-lg border p-3 cursor-pointer bg-red-50 dark:bg-red-900/20 border-red-400 dark:border-red-600"
                  onClick={() => setShowXAIFull(true)}
                >
                  <p className="text-xs font-bold text-red-800 dark:text-red-200">{noRouteAction.title}</p>
                  <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">AI guidance: {noRouteAction.steps[0]}</p>
                  <p className="text-xs text-indigo-500 mt-1">Tap for full guidance →</p>
                </div>
              )}
            </div>
          )}

          {/* Diversion info */}
          {journeyActive && diversionRoute && !noRouteAvailable && (
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-green-600" />
                  <span className="text-xs font-bold text-green-800 dark:text-green-300">Auto-Diversion Route</span>
                </div>
                <div className="text-xs text-green-700 dark:text-green-400 grid grid-cols-3 gap-1">
                  <span>Label: {diversionRoute.label}</span>
                  <span>ETA: {(diversionRoute.eta_minutes ?? 0).toFixed(0)} min</span>
                  <span>Risk: {diversionRoute.risk_level}</span>
                </div>
                <p className="text-xs font-mono text-green-600 dark:text-green-500 truncate">
                  {(diversionRoute.path ?? []).slice(0, 6).join(' → ')}...
                </p>
              </div>
            </div>
          )}

          {/* Route incidents list */}
          {journeyActive && routeIncidents.length > 0 && (
            <div className="p-4">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                All Route Incidents ({routeIncidents.length})
              </h3>
              <div className="space-y-1.5">
                {routeIncidents.map(inc => {
                  const isActive = activeIncidents.some(a => a.incident_id === inc.incident_id);
                  return (
                    <div
                      key={inc.incident_id}
                      className={clsx(
                        'px-2.5 py-2 rounded-lg text-xs flex items-center gap-2',
                        isActive
                          ? 'bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700'
                          : 'bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-700'
                      )}
                    >
                      <AlertTriangle className={clsx('w-3 h-3 shrink-0', isActive ? 'text-red-500' : 'text-amber-500')} />
                      <span className="font-mono text-gray-600 dark:text-gray-300">{inc.segment_id}</span>
                      <span className="text-gray-500 capitalize flex-1 truncate">{inc.incident_type?.replace(/_/g, ' ')}</span>
                      <span className="text-gray-400 font-mono">{inc.start_time?.slice(11, 16)}</span>
                      {isActive && <span className="badge bg-red-500 text-white animate-pulse">NOW</span>}
                    </div>
                  );
                })}
              </div>
              {nearbyIncidents.length > 0 && (
                <p className="text-xs text-gray-400 mt-2">
                  +{nearbyIncidents.length} nearby incidents may cause spillback
                </p>
              )}
            </div>
          )}
        </div>

        {/* Play bar — always visible when journey active */}
        {journeyActive && (
          <div className="border-t border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-800/80 shrink-0">
            {/* Time labels */}
            <div className="flex justify-between text-xs text-gray-400 mb-1.5">
              <span className="font-mono">{formatSimTime(departureTime)}</span>
              <span className={clsx(
                'font-mono font-bold',
                activeIncidents.length > 0 ? 'text-red-600 dark:text-red-400'
                : arrived ? 'text-green-600 dark:text-green-400'
                : 'text-indigo-600 dark:text-indigo-400'
              )}>
                ▶ {formatSimDateTime(simTimestamp)}
              </span>
              <span className="font-mono">Step {simStep}/{totalSteps}</span>
            </div>

            {/* Progress bar with scrubber */}
            <div
              className="relative h-3 rounded-full bg-gray-200 dark:bg-gray-700 overflow-visible cursor-pointer mb-3"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = (e.clientX - rect.left) / rect.width;
                setStep(Math.round(pct * totalSteps));
              }}
            >
              {/* Fill */}
              <div
                className={clsx(
                  'h-full rounded-full transition-all duration-300',
                  activeIncidents.length > 0 ? 'bg-red-500' : arrived ? 'bg-green-500' : 'bg-indigo-500'
                )}
                style={{ width: `${Math.min(progress * 100, 100)}%` }}
              />

              {/* Incident tick marks */}
              {routeIncidents.map(inc => {
                const dep = new Date(departureTime.replace(' ', 'T'));
                const incT = new Date((inc.start_time ?? '').replace(' ', 'T'));
                const diffMin = (incT.getTime() - dep.getTime()) / 60000;
                const pct = totalSteps > 0 ? (diffMin / (totalSteps * 2)) * 100 : 0;
                if (pct < 0 || pct > 100) return null;
                const isActiveInc = activeIncidents.some(a => a.incident_id === inc.incident_id);
                return (
                  <div
                    key={inc.incident_id}
                    className={clsx(
                      'absolute top-1/2 -translate-y-1/2 w-1.5 h-4 rounded-sm z-10',
                      isActiveInc ? 'bg-red-600 animate-pulse' : 'bg-amber-500'
                    )}
                    style={{ left: `${pct}%`, marginLeft: -3 }}
                    title={`${inc.incident_type} at ${inc.start_time}`}
                  />
                );
              })}

              {/* Scrubber */}
              <div
                className="absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white dark:bg-gray-200 border-2 border-indigo-600 shadow-lg z-20 transition-all duration-300"
                style={{ left: `${Math.min(progress * 100, 100)}%`, marginLeft: -10 }}
              />
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPlaying(!isPlaying)}
                disabled={arrived}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                  arrived
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : activeIncidents.length > 0
                    ? 'bg-red-500 hover:bg-red-600 text-white'
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                )}
              >
                {arrived ? <CheckCircle className="w-3.5 h-3.5" />
                  : isPlaying ? <Pause className="w-3.5 h-3.5" />
                  : <Play className="w-3.5 h-3.5" />}
                {arrived ? 'Arrived' : isPlaying ? 'Pause' : simStep === 0 ? 'Simulate' : 'Resume'}
              </button>

              <button
                onClick={() => setStep(0)}
                className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
                title="Restart"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>

              {/* Speed buttons */}
              <div className="flex gap-1">
                {([1, 2, 5] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setSpeed(s)}
                    className={clsx(
                      'px-2 py-1 rounded text-xs font-medium transition-colors',
                      speed === s
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300'
                    )}
                  >
                    {s}x
                  </button>
                ))}
              </div>

              <span className="ml-auto text-xs font-mono text-gray-400">{formatSimTime(simTimestamp)}</span>
            </div>
          </div>
        )}
      </div>

      <SegmentDrawer segmentId={selectedSegment} onClose={() => setSelectedSegment(null)} />
    </div>
  );
}
