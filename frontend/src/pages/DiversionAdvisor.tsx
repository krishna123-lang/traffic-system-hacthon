import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { fetchRoutes } from '../api/client';
import { useNetwork } from '../hooks/useNetwork';
import { RouteCard } from '../components/RouteCard';
import { JourneyBanner } from '../components/JourneyBanner';
import { useJourneyStore } from '../stores/journeyStore';
import { Navigation, AlertCircle, Zap, Info } from 'lucide-react';
import type { Route } from '../api/client';
import clsx from 'clsx';

export default function DiversionAdvisor() {
  const { data: network } = useNetwork();
  const store = useJourneyStore();
  const jSource = store.sourceNode;
  const jTarget = store.targetNode;
  const analysis = store.analysis;
  const journeyActive = !!analysis;
  const diversionRoute = analysis?.diversions?.[0]?.route ?? null;
  const activeIncidents = analysis?.routes?.[0]?.incidents_on_route ?? [];
  const currentXAI = null;
  const noRouteAvailable = false;
  const noRouteAction = null;
  const triggerAutodiversion = () => {};

  // Local overrides — pre-fill from journey if active
  const [sourceNode, setSourceNode] = useState(jSource || '');
  const [targetNode, setTargetNode] = useState(jTarget || '');
  const [selectedRoute, setSelectedRoute] = useState<number>(0);

  // Sync from journey store when it changes
  useEffect(() => {
    if (journeyActive) {
      setSourceNode(jSource);
      setTargetNode(jTarget);
    }
  }, [journeyActive, jSource, jTarget]);

  const { data, mutate, isPending, isError } = useMutation({
    mutationFn: () => fetchRoutes(sourceNode, targetNode),
    onSuccess: () => {
      setSelectedRoute(0);
      const { analysis } = useJourneyStore();
      const journeyActive = !!analysis;
      const diversionRoute = analysis?.diversions?.[0]?.route ?? null;
      const activeIncidents = analysis?.routes?.[0]?.incidents_on_route ?? [];
      
      // Fake the trigger condition
      const triggerIncident = activeIncidents.length > 0 ? activeIncidents[0] : null;

      // If journey active, let the journey store handle diversion logic
      if (journeyActive && activeIncidents.length > 0) {
        triggerAutodiversion();
      }
    },
  });


  const nodes = network?.nodes ?? [];
  const routes: Route[] = data?.routes ?? [];

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        {journeyActive && <JourneyBanner />}

        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Diversion Advisor</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Intelligent route alternatives based on real-time network state
          </p>
        </div>

        {/* Auto-diversion notice */}
        {journeyActive && activeIncidents.length > 0 && (
          <div className="card p-4 flex items-start gap-3 bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700">
            <Zap className="w-4 h-4 text-red-500 shrink-0 mt-0.5 animate-pulse" />
            <div>
              <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                Auto-Diversion Triggered — {activeIncidents.length} active incident(s) on your route
              </p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                {activeIncidents.map(i => `${i.incident_type?.replace(/_/g, ' ')} on ${i.segment_id}`).join(' · ')}
              </p>
              <button
                className="mt-2 text-xs text-indigo-600 dark:text-indigo-400 underline"
                onClick={() => triggerAutodiversion()}
              >
                Apply auto-diversion from journey
              </button>
            </div>
          </div>
        )}

        {journeyActive && activeIncidents.length === 0 && (
          <div className="card p-3 flex items-start gap-3 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700">
            <Info className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
            <p className="text-xs text-green-700 dark:text-green-300">
              Route pre-filled from your active journey ({jSource} → {jTarget}). No active incidents — your primary route is clear.
            </p>
          </div>
        )}

        {/* Origin / Destination */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
            <Navigation className="w-4 h-4 text-indigo-500" />
            Route Configuration
            {journeyActive && (
              <span className="ml-2 badge bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 text-xs">
                Auto-filled from journey
              </span>
            )}
          </h2>
          <div className="grid grid-cols-3 gap-4 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">Source Node</label>
              <select className="select w-full" value={sourceNode} onChange={e => setSourceNode(e.target.value)}>
                <option value="">Select source...</option>
                {nodes.map(n => <option key={n.node_id} value={n.node_id}>{n.node_id}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">Destination Node</label>
              <select className="select w-full" value={targetNode} onChange={e => setTargetNode(e.target.value)}>
                <option value="">Select destination...</option>
                {nodes.map(n => <option key={n.node_id} value={n.node_id}>{n.node_id}</option>)}
              </select>
            </div>
            <button
              className={clsx('btn-primary', journeyActive && activeIncidents.length > 0 && 'bg-red-600 hover:bg-red-700')}
              disabled={!sourceNode || !targetNode || isPending}
              onClick={() => mutate()}
            >
              {isPending ? 'Calculating...' : journeyActive && activeIncidents.length > 0 ? 'Find Diversion' : 'Find Alternatives'}
            </button>
          </div>
        </div>

        {isError && (
          <div className="flex items-center gap-2 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Failed to fetch routes. Please check your selection or try again.
          </div>
        )}

        {isPending && (
          <div className="grid grid-cols-3 gap-4">
            {[0, 1, 2].map(i => <div key={i} className="skeleton h-56 rounded-xl" />)}
          </div>
        )}

        {/* Active diversion from journey store */}
        {diversionRoute && journeyActive && (
          <div className="card p-4 bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-green-600" />
              <h2 className="text-sm font-semibold text-green-800 dark:text-green-300">
                Active Diversion Route — {diversionRoute.label}
              </h2>
            </div>
            <RouteCard route={diversionRoute} index={0} selected />
          </div>
        )}

        {/* Route comparison */}
        {routes.length > 0 && (
          <>
            {/* Mark which routes contain incident segments */}
            <div className="grid grid-cols-3 gap-4">
              {routes.slice(0, 3).map((r, i) => {
                const hasIncident = journeyActive && activeIncidents.some(inc => r.segments?.includes(inc.segment_id));
                return (
                  <div key={`${r.label}-${i}`} className={clsx('relative', hasIncident && 'opacity-75')}>
                    {hasIncident && (
                      <div className="absolute -top-2 -right-2 z-10">
                        <span className="badge bg-red-500 text-white text-xs flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> Blocked
                        </span>
                      </div>
                    )}
                    <RouteCard
                      route={r}
                      index={i}
                      selected={selectedRoute === i}
                      onSelect={() => setSelectedRoute(i)}
                    />
                  </div>
                );
              })}
            </div>

            {/* Selected route details */}
            {routes[selectedRoute] && (() => {
              const r = routes[selectedRoute];
              const hasIncident = journeyActive && activeIncidents.some(inc => r.segments?.includes(inc.segment_id));
              return (
                <div className={clsx('card p-5', hasIncident && 'border-red-300 dark:border-red-700')}>
                  <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4">
                    Selected Route Details — {r.label}
                    {hasIncident && (
                      <span className="ml-2 badge bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                        Contains incident segment
                      </span>
                    )}
                  </h2>
                  <div className="grid grid-cols-4 gap-4 mb-4">
                    {[
                      { label: 'Distance', value: `${(r.total_length_km ?? 0).toFixed(1)} km` },
                      { label: 'ETA', value: `${(r.eta_minutes ?? 0).toFixed(1)} min` },
                      { label: 'Delay', value: `+${(r.estimated_delay_minutes ?? 0).toFixed(1)} min` },
                      { label: 'Risk Level', value: r.risk_level ?? 'minimal' },
                    ].map(({ label, value }) => (
                      <div key={label} className="text-center p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</p>
                        <p className="text-sm font-bold text-gray-900 dark:text-gray-100 capitalize">{value}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs font-mono text-gray-400 break-words">
                    {(r.path ?? []).join(' → ')}
                  </p>
                  {r.why_recommended?.length ? (
                    <div className="mt-3 grid grid-cols-2 gap-1">
                      {r.why_recommended.map((txt, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                          <span className="text-green-500">✓</span><span>{txt}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}
