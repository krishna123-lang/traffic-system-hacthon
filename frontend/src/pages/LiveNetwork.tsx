import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { fetchJourneyAnalysis, fetchRouteGeometry } from '../api/client';
import { useNetwork } from '../hooks/useNetwork';
import { NetworkMap } from '../components/NetworkMap';
import { SegmentDrawer } from '../components/SegmentDrawer';
import { useJourneyStore } from '../stores/journeyStore';
import {
  Navigation, MapPin, Clock, AlertTriangle, Zap, Info, CheckCircle,
  TrendingDown, TrendingUp, Minus, Layers, TrafficCone, Landmark, 
  ArrowRightLeft, PaintBucket, Radio, Eye, EyeOff
} from 'lucide-react';
import clsx from 'clsx';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const INTERVENTION_ICONS: Record<string, typeof Zap> = {
  flyover: Landmark,
  lane_addition: Layers,
  signal_optimization: Radio,
  connector: ArrowRightLeft,
  capacity_upgrade: PaintBucket,
  monitoring: TrafficCone,
};

export default function LiveNetwork() {
  const [selectedSegment, setSelectedSegment] = useState<string | null>(null);
  const [routeCoords, setRouteCoords] = useState<[number, number][] | undefined>();
  const [isAnimating, setIsAnimating] = useState(true);
  
  const {
    sourceNode, targetNode, departureTime,
    analysis, activeTab, isAnalyzing,
    setSource, setTarget, setDepartureTime,
    setAnalysis, setActiveTab, setAnalyzing, reset,
    selectedRoute, setSelectedRoute, hasIncidents, hasCongestion,
    selectedSolutionIdx, setSelectedSolution,
  } = useJourneyStore();

  const { data: network } = useNetwork();
  
  const { mutate: analyzeJourney } = useMutation({
    mutationFn: () => fetchJourneyAnalysis(sourceNode, targetNode, departureTime),
    onMutate: () => setAnalyzing(true),
    onSuccess: (data) => {
      setAnalysis(data);
      setAnalyzing(false);
    },
    onError: () => {
      setAnalyzing(false);
    }
  });

  const nodes = network?.nodes ?? [];
  const currentRoute = selectedRoute();
  const congestionAnalysis = analysis?.congestion_analysis ?? [];

  // Fetch real road geometry when route changes
  useEffect(() => {
    if (!currentRoute?.path || currentRoute.path.length < 2) {
      setRouteCoords(undefined);
      return;
    }

    let cancelled = false;
    fetchRouteGeometry(currentRoute.path)
      .then(geo => {
        if (!cancelled && geo.coordinates?.length >= 2) {
          setRouteCoords(geo.coordinates as [number, number][]);
        }
      })
      .catch(() => {
        // Fallback: use node coordinates directly
        if (cancelled) return;
        const nodeMap = new Map(nodes.map(n => [n.node_id, n]));
        const fallbackCoords = currentRoute.path
          .map(nid => nodeMap.get(nid))
          .filter(Boolean)
          .map(n => [n!.lon, n!.lat] as [number, number]);
        if (fallbackCoords.length >= 2) setRouteCoords(fallbackCoords);
      });

    return () => { cancelled = true; };
  }, [currentRoute?.path?.join(','), nodes.length]);

  // Clear route coords on reset
  useEffect(() => {
    if (!analysis) {
      setRouteCoords(undefined);
      setIsAnimating(true);
    }
  }, [analysis]);

  // Build congestion markers positioned ON the route
  const congestionMarkers = (() => {
    if (!currentRoute?.congestion_points?.length || !routeCoords?.length || !currentRoute?.segments?.length) return [];
    
    const segments = currentRoute.segments;
    const incidentSegs = new Set(currentRoute.incidents_on_route?.map(i => i.segment_id) ?? []);
    
    // Helper: get position along OSRM route at a given fraction (0..1)
    const getPositionAtFraction = (frac: number): [number, number] => {
      if (!routeCoords || routeCoords.length < 2) return [0, 0];
      const idx = frac * (routeCoords.length - 1);
      const i = Math.floor(idx);
      const t = idx - i;
      if (i >= routeCoords.length - 1) return routeCoords[routeCoords.length - 1];
      return [
        routeCoords[i][0] + t * (routeCoords[i + 1][0] - routeCoords[i][0]),
        routeCoords[i][1] + t * (routeCoords[i + 1][1] - routeCoords[i][1]),
      ];
    };

    return currentRoute.congestion_points.map(cp => {
      const segIdx = segments.indexOf(cp.segment_id);
      const frac = segIdx >= 0 ? (segIdx + 0.5) / segments.length : 0.5;
      const [lon, lat] = getPositionAtFraction(frac);
      
      return {
        segment_id: cp.segment_id,
        congestion_score: cp.congestion_score,
        lon,
        lat,
        isIncident: incidentSegs.has(cp.segment_id),
      };
    });
  })();

  // Build congestion segment overlays — colored sections ON the route line
  const congestionSegments = (() => {
    if (!currentRoute?.segment_congestion?.length || !routeCoords?.length || !currentRoute?.segments?.length) return [];
    
    const segments = currentRoute.segments;
    const totalSegs = segments.length;
    
    // Show ALL segments that have above-threshold congestion as colored overlays
    return currentRoute.segment_congestion
      .filter(sc => sc.congestion_score > 0.1)  // show any with >10% congestion
      .map(sc => {
        const segIdx = segments.indexOf(sc.segment_id);
        if (segIdx < 0) return null;
        return {
          segment_id: sc.segment_id,
          congestion_score: sc.congestion_score,
          startFrac: segIdx / totalSegs,
          endFrac: (segIdx + 1) / totalSegs,
        };
      })
      .filter(Boolean) as { segment_id: string; congestion_score: number; startFrac: number; endFrac: number }[];
  })();

  // Build intervention overlay from selected solution
  const interventionOverlay = (() => {
    if (selectedSolutionIdx === null || !analysis?.solutions) return null;
    const sol = analysis.solutions[selectedSolutionIdx] as any;
    if (!sol) return null;
    return {
      type: sol.type || 'capacity_upgrade',
      segments: sol.affected_segments || [],
      label: sol.action || 'Intervention',
    };
  })();

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      {/* Top Input Bar */}
      <div className="absolute top-0 left-0 right-0 z-20 p-4">
        <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 flex items-end gap-4">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">
              <MapPin className="w-3 h-3 inline mr-1 text-green-500" />Origin
            </label>
            <select className="select w-full text-sm" value={sourceNode} onChange={e => setSource(e.target.value)}>
              <option value="">Select Origin...</option>
              {nodes.map(n => <option key={n.node_id} value={n.node_id}>{n.node_id}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">
              <MapPin className="w-3 h-3 inline mr-1 text-red-500" />Destination
            </label>
            <select className="select w-full text-sm" value={targetNode} onChange={e => setTarget(e.target.value)}>
              <option value="">Select Destination...</option>
              {nodes.map(n => <option key={n.node_id} value={n.node_id}>{n.node_id}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">
              <Clock className="w-3 h-3 inline mr-1 text-indigo-500" />Departure Time
            </label>
            <input
              type="text"
              className="select w-full text-sm"
              value={departureTime}
              onChange={e => setDepartureTime(e.target.value)}
              placeholder="2026-01-11 13:30:00"
            />
          </div>
          <button
            className="btn-primary shrink-0 flex items-center justify-center gap-2 h-10 px-6"
            disabled={!sourceNode || !targetNode || !departureTime || isAnalyzing}
            onClick={() => analyzeJourney()}
          >
            {isAnalyzing ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Navigation className="w-4 h-4" />
            )}
            {isAnalyzing ? 'Analyzing...' : 'Analyze Journey'}
          </button>
          {analysis && (
            <button
              className="h-10 px-4 rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 text-sm hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              onClick={reset}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 pt-24 h-full">
        {/* Left column - Map */}
        <div className={clsx('relative transition-all duration-300', analysis ? 'w-[60%]' : 'w-full')}>
          <NetworkMap
            network={network}
            onSegmentClick={setSelectedSegment}
            selectedSegmentId={selectedSegment}
            height="h-full"
            routeCoordinates={routeCoords}
            congestionMarkers={congestionMarkers}
            congestionSegments={congestionSegments}
            sourceNodeId={analysis ? sourceNode : undefined}
            targetNodeId={analysis ? targetNode : undefined}
            isAnimating={isAnimating && !!routeCoords}
            interventionOverlay={interventionOverlay}
          />
          {/* Animation toggle */}
          {routeCoords && (
            <div className="absolute bottom-4 left-4 z-10">
              <button
                onClick={() => setIsAnimating(a => !a)}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium shadow-lg transition-all',
                  isAnimating
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600'
                )}
              >
                {isAnimating ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                {isAnimating ? 'Vehicle Moving' : 'Vehicle Paused'}
              </button>
            </div>
          )}
        </div>

        {/* Right column - Analysis Panels */}
        {analysis && (
          <div className="w-[40%] flex flex-col border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 overflow-hidden shadow-xl z-10 transition-all duration-300">
            {/* Tab navigation */}
            <div className="px-4 pt-4 pb-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex gap-2 overflow-x-auto hide-scrollbar">
              {[
                { id: 'route', label: 'Route', dot: true, color: 'bg-indigo-500' },
                { id: 'congestion', label: 'Congestion', dot: hasCongestion(), color: 'bg-orange-500' },
                { id: 'incidents', label: 'Incidents', dot: hasIncidents(), color: 'bg-red-500' },
                { id: 'forecast', label: 'Forecast', dot: true, color: 'bg-blue-500' },
                { id: 'solutions', label: 'Solutions', dot: true, color: 'bg-green-500' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={clsx(
                    'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap flex items-center gap-1.5',
                    activeTab === tab.id
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                  )}
                >
                  {tab.label}
                  {tab.dot && (
                    <span className={clsx('w-1.5 h-1.5 rounded-full', activeTab === tab.id ? 'bg-white' : tab.color)} />
                  )}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Tab 1: Route Overview */}
              {activeTab === 'route' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
                      <p className="text-xs text-gray-500 mb-1">ETA</p>
                      <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{(currentRoute?.eta_minutes ?? 0).toFixed(1)} min</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
                      <p className="text-xs text-gray-500 mb-1">Distance</p>
                      <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{(currentRoute?.total_length_km ?? 0).toFixed(1)} km</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
                      <p className="text-xs text-gray-500 mb-1">Avg Congestion</p>
                      <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{((currentRoute?.route_avg_congestion ?? 0) * 100).toFixed(1)}%</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
                      <p className="text-xs text-gray-500 mb-1">Max Congestion</p>
                      <p className="text-lg font-bold text-red-600 dark:text-red-400">{((currentRoute?.route_max_congestion ?? 0) * 100).toFixed(1)}%</p>
                    </div>
                  </div>

                  <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mt-4 mb-2">Available Routes</h3>
                  <div className="space-y-2">
                    {analysis.routes.map((r, i) => (
                      <button
                        key={i}
                        onClick={() => setSelectedRoute(i)}
                        className={clsx(
                          'w-full text-left p-3 rounded-xl border transition-all',
                          useJourneyStore.getState().selectedRouteIdx === i
                            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-indigo-300'
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-sm">{r.label}</span>
                          <span className="text-xs text-gray-500 capitalize">{r.risk_level} Risk</span>
                        </div>
                        <div className="flex gap-4 text-xs text-gray-500">
                          <span>{r.eta_minutes.toFixed(1)} min</span>
                          <span>Avg {(r.route_avg_congestion * 100).toFixed(1)}%</span>
                          <span>{r.congestion_points?.length ?? 0} hotspots</span>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                    <p className="text-xs text-gray-500 mb-2">Path</p>
                    <p className="text-xs font-mono text-gray-600 dark:text-gray-400 leading-relaxed">
                      {currentRoute?.path?.join(' \u2192 ')}
                    </p>
                  </div>
                </>
              )}

              {/* Tab 2: Congestion */}
              {activeTab === 'congestion' && currentRoute && (
                <>
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                    <h3 className="text-sm font-bold mb-4">Segment Congestion</h3>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={currentRoute.segment_congestion} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                          <XAxis type="number" domain={[0, 1]} hide />
                          <YAxis dataKey="segment_id" type="category" width={60} tick={{ fontSize: 10 }} />
                          <Tooltip
                            formatter={(val: number) => [`${(val * 100).toFixed(1)}%`, 'Congestion']}
                            labelStyle={{ color: 'black' }}
                          />
                          <Bar dataKey="congestion_score" radius={[0, 4, 4, 0]}>
                            {currentRoute.segment_congestion.map((entry, index) => {
                              let color = '#22c55e';
                              if (entry.congestion_score > 0.8) color = '#ef4444';
                              else if (entry.congestion_score > 0.5) color = '#f97316';
                              else if (entry.congestion_score > 0.2) color = '#eab308';
                              return <Cell key={`cell-${index}`} fill={color} />;
                            })}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {currentRoute.congestion_points.length > 0 && (
                    <div className="space-y-4 mt-4">
                      <h3 className="text-sm font-bold flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-orange-500" />
                        Congestion Hotspots - Detailed Explanation ({currentRoute.congestion_points.length})
                      </h3>
                      {currentRoute.congestion_points.map((cp, idx) => {
                        const ca = congestionAnalysis.find((c: any) => c.segment_id === cp.segment_id);
                        const severity = cp.congestion_score > 0.5 ? 'Severe' : cp.congestion_score > 0.3 ? 'High' : cp.congestion_score > 0.15 ? 'Moderate' : 'Mild';
                        const severityColor = cp.congestion_score > 0.5 ? 'red' : cp.congestion_score > 0.3 ? 'orange' : cp.congestion_score > 0.15 ? 'amber' : 'yellow';
                        
                        return (
                          <div key={idx} className={clsx(
                            'rounded-xl border-2 p-4 space-y-3',
                            severityColor === 'red' ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20' :
                            severityColor === 'orange' ? 'border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20' :
                            'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20'
                          )}>
                            {/* Header */}
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                <span className={clsx(
                                  'px-2 py-1 rounded-md text-xs font-bold uppercase tracking-wide',
                                  severityColor === 'red' ? 'bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200' :
                                  severityColor === 'orange' ? 'bg-orange-200 dark:bg-orange-800 text-orange-800 dark:text-orange-200' :
                                  'bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200'
                                )}>
                                  {severity}
                                </span>
                                <span className="font-mono font-bold text-base">{cp.segment_id}</span>
                              </div>
                              <span className="text-lg font-bold text-gray-900 dark:text-gray-100">
                                {(cp.congestion_score * 100).toFixed(1)}%
                              </span>
                            </div>

                            {/* What happened */}
                            <div className="bg-white/60 dark:bg-gray-800/60 rounded-lg p-3">
                              <p className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" /> What happened:
                              </p>
                              <p className="text-sm text-gray-800 dark:text-gray-200">
                                {ca?.cause || `Moderate congestion detected at ${cp.segment_id}`}
                              </p>
                            </div>

                            {/* Why it happened */}
                            <div className="bg-white/60 dark:bg-gray-800/60 rounded-lg p-3">
                              <p className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1">
                                <Info className="w-3 h-3" /> Why this congestion occurs:
                              </p>
                              <p className="text-sm text-gray-800 dark:text-gray-200">
                                {ca?.reason || cp.reason || 'Traffic flow exceeds segment capacity during peak hours'}
                              </p>
                            </div>

                            {/* Road characteristics */}
                            <div className="grid grid-cols-2 gap-2">
                              <div className="bg-white/60 dark:bg-gray-800/60 rounded-lg p-2 text-center">
                                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Road Type</p>
                                <p className="text-sm font-bold capitalize">{ca?.road_type || 'arterial'}</p>
                              </div>
                              <div className="bg-white/60 dark:bg-gray-800/60 rounded-lg p-2 text-center">
                                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Lanes</p>
                                <p className="text-sm font-bold">{ca?.lanes || 2}</p>
                              </div>
                              <div className="bg-white/60 dark:bg-gray-800/60 rounded-lg p-2 text-center">
                                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Current Speed</p>
                                <p className="text-sm font-bold">{ca?.speed_kmh?.toFixed(1) || '?'} km/h</p>
                              </div>
                              <div className="bg-white/60 dark:bg-gray-800/60 rounded-lg p-2 text-center">
                                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Flow / Capacity</p>
                                <p className="text-sm font-bold">{ca?.flow_vph || '?'} / {ca?.capacity_vph || '?'} vph</p>
                              </div>
                            </div>

                            {/* Incident info if present */}
                            {ca?.has_incident && ca?.incident && (
                              <div className="bg-red-100 dark:bg-red-900/40 rounded-lg p-3 border border-red-200 dark:border-red-800">
                                <p className="text-xs font-bold text-red-700 dark:text-red-300 mb-1">
                                  !! Active Incident Detected
                                </p>
                                <p className="text-xs text-red-600 dark:text-red-400">
                                  Type: {ca.incident.incident_type?.replace(/_/g, ' ')} |
                                  Severity: Level {ca.incident.severity} |
                                  {ca.incident.lanes_blocked} lane(s) blocked
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* Tab 3: Incidents */}
              {activeTab === 'incidents' && currentRoute && (
                <>
                  {/* Summary KPIs */}
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 text-center">
                      <p className="text-[10px] text-gray-500 uppercase">Detection Confidence</p>
                      <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{(currentRoute.incident_detection_confidence * 100).toFixed(1)}%</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 text-center">
                      <p className="text-[10px] text-gray-500 uppercase">Total Incidents</p>
                      <p className="text-lg font-bold text-red-600 dark:text-red-400">{currentRoute.incidents_on_route?.length ?? 0}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 text-center">
                      <p className="text-[10px] text-gray-500 uppercase">Congestion Points</p>
                      <p className="text-lg font-bold text-orange-600 dark:text-orange-400">{currentRoute.congestion_points?.length ?? 0}</p>
                    </div>
                  </div>

                  {/* Incidents from dataset + predicted */}
                  {(currentRoute.incidents_on_route?.length ?? 0) > 0 ? (
                    <div className="space-y-4">
                      <h3 className="text-sm font-bold flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-500" />
                        Detected Incidents ({currentRoute.incidents_on_route.length})
                      </h3>
                      {currentRoute.incidents_on_route.map((inc: any, idx: number) => {
                        const typeLabels: Record<string, string> = {
                          accident_like: 'Accident / Collision',
                          lane_blockage: 'Lane Blockage',
                          stalled_vehicle: 'Stalled Vehicle',
                          demand_surge: 'Demand Surge',
                          road_closure: 'Road Closure',
                          weather_hazard: 'Weather / Visibility Hazard',
                        };
                        const typeEmojis: Record<string, string> = {
                          accident_like: '\uD83D\uDEA8',
                          lane_blockage: '\uD83D\uDEA7',
                          stalled_vehicle: '\uD83D\uDE97',
                          demand_surge: '\uD83D\uDCC8',
                          road_closure: '\u26D4',
                          weather_hazard: '\uD83C\uDF27\uFE0F',
                        };
                        const typeColors: Record<string, string> = {
                          accident_like: 'red',
                          lane_blockage: 'orange',
                          stalled_vehicle: 'amber',
                          demand_surge: 'blue',
                          road_closure: 'red',
                          weather_hazard: 'sky',
                        };
                        
                        const label = typeLabels[inc.incident_type] || inc.incident_type?.replace(/_/g, ' ');
                        const emoji = typeEmojis[inc.incident_type] || '\u26A0\uFE0F';
                        const color = typeColors[inc.incident_type] || 'gray';
                        const isReal = inc.status === 'active' || inc.status === 'recent';
                        const isPredicted = inc.status === 'predicted';
                        const confidence = inc.confidence || 0.85;

                        return (
                          <div key={idx} className={clsx(
                            'rounded-xl border-2 p-4 space-y-3',
                            color === 'red' ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/15' :
                            color === 'orange' ? 'border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/15' :
                            color === 'amber' ? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/15' :
                            color === 'blue' ? 'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/15' :
                            color === 'sky' ? 'border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-900/15' :
                            'border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800'
                          )}>
                            {/* Header */}
                            <div className="flex justify-between items-start">
                              <div className="flex items-center gap-2">
                                <span className="text-xl">{emoji}</span>
                                <div>
                                  <p className="font-bold text-sm text-gray-900 dark:text-gray-100">{label}</p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className={clsx(
                                      'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded',
                                      isReal && inc.status === 'active' ? 'bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200' :
                                      isReal && inc.status === 'recent' ? 'bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200' :
                                      'bg-indigo-200 dark:bg-indigo-800 text-indigo-800 dark:text-indigo-200'
                                    )}>
                                      {inc.status === 'active' ? '\u25CF ACTIVE' : inc.status === 'recent' ? '\u25CB RECENT' : '\u25B3 PREDICTED'}
                                    </span>
                                    <span className="text-[10px] text-gray-500">Sev. Level {inc.severity}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <span className="font-mono font-bold text-sm">{inc.segment_id}</span>
                                <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{(confidence * 100).toFixed(1)}% conf.</p>
                              </div>
                            </div>

                            {/* Prediction reason / explanation */}
                            {isPredicted && inc.prediction_reason && (
                              <div className="bg-white/70 dark:bg-gray-800/70 rounded-lg p-3">
                                <p className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1">
                                  <Info className="w-3 h-3" /> AI Explanation (Explainable AI):
                                </p>
                                <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">{inc.prediction_reason}</p>
                              </div>
                            )}

                            {/* Real incident details */}
                            {isReal && (
                              <div className="bg-white/70 dark:bg-gray-800/70 rounded-lg p-3 space-y-2">
                                <p className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1">
                                  <Info className="w-3 h-3" /> Incident Details (from dataset):
                                </p>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                  <div>
                                    <span className="text-gray-500">Incident ID:</span>
                                    <span className="ml-1 font-mono font-bold">{inc.incident_id}</span>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">Lanes Blocked:</span>
                                    <span className="ml-1 font-bold">{inc.lanes_blocked}</span>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">Start:</span>
                                    <span className="ml-1 font-mono">{inc.start_time?.slice(11, 16) || '?'}</span>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">End:</span>
                                    <span className="ml-1 font-mono">{inc.end_time?.slice(11, 16) || 'Ongoing'}</span>
                                  </div>
                                </div>
                                {inc.status === 'active' && (
                                  <p className="text-xs text-red-600 dark:text-red-400 font-medium mt-1">
                                    This incident is currently active and directly impacts your journey timing.
                                  </p>
                                )}
                                {inc.status === 'recent' && (
                                  <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-1">
                                    This incident occurred recently. Residual effects (slow clearance, rubber-necking) may still affect traffic flow.
                                  </p>
                                )}
                              </div>
                            )}

                            {/* Impact metrics */}
                            <div className="grid grid-cols-3 gap-2">
                              <div className="bg-white/60 dark:bg-gray-800/60 rounded-lg p-2 text-center">
                                <p className="text-[10px] text-gray-500 uppercase">Severity</p>
                                <div className="flex justify-center gap-0.5 mt-1">
                                  {[1, 2, 3].map(s => (
                                    <span key={s} className={clsx(
                                      'w-3 h-3 rounded-full',
                                      s <= inc.severity ? 'bg-red-500' : 'bg-gray-200 dark:bg-gray-600'
                                    )} />
                                  ))}
                                </div>
                              </div>
                              <div className="bg-white/60 dark:bg-gray-800/60 rounded-lg p-2 text-center">
                                <p className="text-[10px] text-gray-500 uppercase">Lanes Blocked</p>
                                <p className="text-sm font-bold">{inc.lanes_blocked || 0}</p>
                              </div>
                              <div className="bg-white/60 dark:bg-gray-800/60 rounded-lg p-2 text-center">
                                <p className="text-[10px] text-gray-500 uppercase">Accuracy</p>
                                <p className={clsx(
                                  'text-sm font-bold',
                                  confidence > 0.85 ? 'text-green-600' : confidence > 0.7 ? 'text-amber-600' : 'text-red-600'
                                )}>{(confidence * 100).toFixed(0)}%</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-green-200 dark:border-green-900/50 bg-green-50 dark:bg-green-900/20 p-4 flex items-center gap-3 text-green-700 dark:text-green-400">
                      <CheckCircle className="w-5 h-5" />
                      <span className="text-sm font-medium">No incidents detected on this route for the selected time window.</span>
                    </div>
                  )}

                  {analysis.xai_summary && (
                    <div className="mt-4 p-4 rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50 dark:bg-indigo-900/20">
                      <p className="text-xs font-bold text-indigo-800 dark:text-indigo-300 mb-2 flex items-center gap-1">
                        <Info className="w-4 h-4" /> AI Summary
                      </p>
                      <p className="text-xs text-indigo-700 dark:text-indigo-400 mb-2">{analysis.xai_summary.incident_explanation}</p>
                      <p className="text-xs text-indigo-600 dark:text-indigo-500">{analysis.xai_summary.congestion_cause}</p>
                    </div>
                  )}
                </>
              )}

              {/* Tab 4: Forecast */}
              {activeTab === 'forecast' && (
                <>
                  {analysis.routes.map((route, ri) => {
                    if (!route.forecast) return null;
                    const isSelected = useJourneyStore.getState().selectedRouteIdx === ri;
                    const hasCongPts = (route.congestion_points?.length ?? 0) > 0;
                    
                    return (
                      <div key={ri} className={clsx(
                        'rounded-xl border p-4',
                        isSelected 
                          ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50/50 dark:bg-indigo-900/10' 
                          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                      )}>
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-bold flex items-center gap-2">
                            {route.label}
                            {isSelected && <span className="text-[10px] bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded">Selected</span>}
                          </h4>
                          <span className="text-xs text-gray-500">
                            Avg: {(route.route_avg_congestion * 100).toFixed(1)}%
                            {hasCongPts && <span className="text-orange-500 ml-1">({route.congestion_points.length} hotspots)</span>}
                          </span>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          {['15', '30', '45', '60'].map(horizon => {
                            const f = route.forecast[horizon];
                            if (!f) return null;
                            return (
                              <div key={horizon} className="rounded-lg bg-gray-50 dark:bg-gray-900 p-2 text-center">
                                <p className="text-[10px] text-gray-400 mb-1">+{horizon}m</p>
                                <div className="flex items-center justify-center gap-0.5 mb-1">
                                  {f.trend === 'worsening' && <TrendingUp className="w-3 h-3 text-red-500" />}
                                  {f.trend === 'improving' && <TrendingDown className="w-3 h-3 text-green-500" />}
                                  {f.trend === 'stable' && <Minus className="w-3 h-3 text-amber-500" />}
                                </div>
                                <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{(f.avg_congestion * 100).toFixed(0)}%</p>
                                <p className="text-[9px] text-gray-400">Acc: {(route.forecast_accuracy[horizon] * 100).toFixed(1)}%</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  
                  <div className="mt-4 p-4 rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-900/20">
                    <p className="text-xs font-bold text-blue-800 dark:text-blue-300 mb-1 flex items-center gap-1">
                      <Info className="w-4 h-4" /> Forecast Insight
                    </p>
                    <p className="text-sm text-blue-700 dark:text-blue-400">
                      {analysis.xai_summary.forecast_insight}
                    </p>
                  </div>
                </>
              )}

              {/* Tab 5: Solutions */}
              {activeTab === 'solutions' && (
                <>
                  {/* Diversion Options */}
                  {analysis.diversions?.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
                        <Zap className="w-4 h-4 text-amber-500" />
                        Route Diversions
                      </h3>
                      <div className="space-y-3">
                        {analysis.diversions.map((div, i) => (
                          <div key={i} className="rounded-xl border border-green-200 dark:border-green-900/50 bg-green-50 dark:bg-green-900/10 p-3">
                            <div className="flex justify-between items-center mb-2">
                              <span className="font-bold text-sm text-green-800 dark:text-green-300">{div.route_label}</span>
                              <span className={clsx(
                                'text-xs font-bold px-2 py-0.5 rounded',
                                div.congestion_reduction_pct > 0
                                  ? 'bg-green-200 text-green-800 dark:bg-green-800 dark:text-green-200'
                                  : 'bg-red-200 text-red-800 dark:bg-red-800 dark:text-red-200'
                              )}>
                                {div.congestion_reduction_pct > 0 ? '-' : '+'}{Math.abs(div.congestion_reduction_pct).toFixed(1)}% Congestion
                              </span>
                            </div>
                            <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">{div.reason}</p>
                            {div.avoids_segments.length > 0 && (
                              <p className="text-[10px] text-gray-500 font-mono">Avoids: {div.avoids_segments.join(', ')}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Infrastructure Interventions */}
                  <div>
                    <h3 className="text-sm font-bold mb-1 flex items-center gap-2">
                      <Landmark className="w-4 h-4 text-indigo-500" />
                      Infrastructure Interventions
                    </h3>
                    <p className="text-[10px] text-gray-400 mb-3">Click to visualize on map</p>
                    <div className="space-y-3">
                      {analysis.solutions?.map((sol: any, i: number) => {
                        const IntIcon = INTERVENTION_ICONS[sol.type] ?? Zap;
                        const isActive = selectedSolutionIdx === i;
                        return (
                          <div
                            key={i}
                            onClick={() => setSelectedSolution(i)}
                            className={clsx(
                              'rounded-xl border bg-white dark:bg-gray-800 p-4 border-l-4 cursor-pointer transition-all',
                              isActive ? 'ring-2 ring-indigo-400 shadow-lg scale-[1.02]' : 'hover:shadow-md',
                              sol.quality === 'high' ? 'border-l-green-500 border-gray-200 dark:border-gray-700' :
                              sol.quality === 'medium' ? 'border-l-amber-500 border-gray-200 dark:border-gray-700' :
                              'border-l-red-500 border-gray-200 dark:border-gray-700'
                            )}
                          >
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex items-start gap-2 flex-1">
                                <div className={clsx(
                                  'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors',
                                  isActive ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600' :
                                  sol.quality === 'high' ? 'bg-green-100 dark:bg-green-900/30 text-green-600' :
                                  sol.quality === 'medium' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600' :
                                  'bg-gray-100 dark:bg-gray-700 text-gray-500'
                                )}>
                                  <IntIcon className="w-4 h-4" />
                                </div>
                                <div className="flex-1">
                                  <span className="font-bold text-sm text-gray-900 dark:text-gray-100">{sol.action}</span>
                                  <div className="flex gap-2 mt-0.5">
                                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">
                                      {(sol.type || '').replace(/_/g, ' ')}
                                    </span>
                                    {isActive && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 font-semibold animate-pulse">
                                        Showing on map
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <span className="text-xs font-mono text-gray-500 shrink-0">Conf: {(sol.confidence * 100).toFixed(0)}%</span>
                            </div>
                            <p className="text-xs text-gray-500 mb-2 ml-10">{sol.reason}</p>
                            <div className="flex justify-between items-center mt-2 ml-10">
                              <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                                Congestion Reduction: {sol.congestion_reduction_pct.toFixed(1)}%
                              </span>
                              <span className={clsx(
                                'text-[10px] uppercase font-semibold px-2 py-0.5 rounded',
                                sol.quality === 'high' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                                sol.quality === 'medium' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' :
                                'bg-gray-100 dark:bg-gray-700 text-gray-600'
                              )}>
                                {sol.quality} priority
                              </span>
                            </div>
                            {sol.affected_segments?.length > 0 && (
                              <p className="text-[10px] text-gray-400 mt-1 ml-10 font-mono">
                                Affects: {sol.affected_segments.join(', ')}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {analysis.xai_summary && (
                    <div className="mt-4 p-4 rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50 dark:bg-indigo-900/20">
                      <p className="text-xs font-bold text-indigo-800 dark:text-indigo-300 mb-2 flex items-center gap-1">
                        <Info className="w-4 h-4" /> AI Analysis Summary
                      </p>
                      <div className="space-y-2 text-xs text-indigo-700 dark:text-indigo-400">
                        <p>{analysis.xai_summary.congestion_cause}</p>
                        <p>{analysis.xai_summary.forecast_insight}</p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <SegmentDrawer segmentId={selectedSegment} onClose={() => setSelectedSegment(null)} />
    </div>
  );
}
