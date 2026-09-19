import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { fetchJourneyAnalysis } from '../api/client';
import { useNetwork } from '../hooks/useNetwork';
import { NetworkMap } from '../components/NetworkMap';
import { SegmentDrawer } from '../components/SegmentDrawer';
import { useJourneyStore } from '../stores/journeyStore';
import {
  Navigation, MapPin, Clock, AlertTriangle, Zap, Info, CheckCircle,
  TrendingDown, TrendingUp, Minus, Layers, TrafficCone, Landmark, 
  ArrowRightLeft, PaintBucket, Radio
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
  
  const {
    sourceNode, targetNode, departureTime,
    analysis, activeTab, isAnalyzing,
    setSource, setTarget, setDepartureTime,
    setAnalysis, setActiveTab, setAnalyzing, reset,
    selectedRoute, setSelectedRoute, hasIncidents, hasCongestion
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
  
  // Prepare data for NetworkMap
  const segmentCongestionMap = new Map<string, {congestion_score: number, congestion_state: string}>();
  if (currentRoute) {
    currentRoute.segment_congestion?.forEach(sc => {
      segmentCongestionMap.set(sc.segment_id, {
        congestion_score: sc.congestion_score,
        congestion_state: sc.congestion_state
      });
    });
  }

  const congestionPoints = currentRoute?.congestion_points?.map(cp => ({
    segment_id: cp.segment_id,
    congestion_score: cp.congestion_score
  }));

  const activeIncidents = currentRoute?.incidents_on_route ?? [];
  const congestionAnalysis = (analysis as any)?.congestion_analysis ?? [];

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
          {network ? (
            <NetworkMap
              network={network}
              onSegmentClick={setSelectedSegment}
              selectedSegmentId={selectedSegment}
              height="h-full"
              highlightSegments={currentRoute?.segments}
              segmentCongestionMap={segmentCongestionMap}
              congestionPoints={congestionPoints}
              showIncidentMarker={activeIncidents.length > 0}
              incidentSegment={activeIncidents[0]?.segment_id ?? null}
            />
          ) : (
            <div className="skeleton h-full w-full" />
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
                      {currentRoute?.path?.join(' -> ')}
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
                    <div className="space-y-3 mt-4">
                      <h3 className="text-sm font-bold">Congestion Hotspots</h3>
                      {currentRoute.congestion_points.map((cp, idx) => {
                        const cpAnalysis = congestionAnalysis.find((c: any) => c.segment_id === cp.segment_id);
                        return (
                          <div key={idx} className="rounded-xl border border-orange-200 dark:border-orange-900/50 bg-orange-50 dark:bg-orange-900/20 p-3">
                            <div className="flex justify-between items-start mb-1">
                              <span className="font-mono font-semibold text-sm text-orange-800 dark:text-orange-300">{cp.segment_id}</span>
                              <span className="text-xs font-bold text-orange-700 dark:text-orange-400">{(cp.congestion_score * 100).toFixed(1)}%</span>
                            </div>
                            <p className="text-xs text-orange-700 dark:text-orange-400 mb-1">{cp.reason}</p>
                            {cpAnalysis && (
                              <div className="mt-2 pt-2 border-t border-orange-200 dark:border-orange-800">
                                <p className="text-xs font-semibold text-orange-900 dark:text-orange-200 mb-1">
                                  {cpAnalysis.has_incident ? '!! Incident' : 'Cause'}:
                                </p>
                                <p className="text-xs text-orange-700 dark:text-orange-400">{cpAnalysis.cause}</p>
                                <p className="text-xs text-orange-600 dark:text-orange-500 mt-1 italic">{cpAnalysis.reason}</p>
                                <div className="flex gap-3 mt-2 text-[10px] text-orange-500">
                                  <span>{cpAnalysis.lanes} lanes</span>
                                  <span>{cpAnalysis.road_type}</span>
                                  <span>{cpAnalysis.speed_kmh} km/h</span>
                                  <span>{cpAnalysis.flow_vph}/{cpAnalysis.capacity_vph} vph</span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* Tab 3: Incidents — Per congestion point */}
              {activeTab === 'incidents' && currentRoute && (
                <>
                  <div className="mb-4">
                    <p className="text-sm">
                      Detection Confidence: <span className="font-bold text-indigo-600 dark:text-indigo-400">{(currentRoute.incident_detection_confidence * 100).toFixed(1)}%</span>
                    </p>
                  </div>
                  
                  {/* Per-congestion-point incident analysis */}
                  {congestionAnalysis.length > 0 ? (
                    <div className="space-y-4">
                      <h3 className="text-sm font-bold flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                        Congestion Point Analysis ({congestionAnalysis.length} points)
                      </h3>
                      {congestionAnalysis.map((ca: any, idx: number) => (
                        <div key={idx} className={clsx(
                          'rounded-xl border p-4',
                          ca.has_incident 
                            ? 'border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20'
                            : 'border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20'
                        )}>
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <span className={clsx(
                                'inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide px-2 py-1 rounded',
                                ca.has_incident
                                  ? 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/50'
                                  : 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/50'
                              )}>
                                {ca.has_incident ? <AlertTriangle className="w-3 h-3" /> : <TrafficCone className="w-3 h-3" />}
                                {ca.has_incident ? 'Incident' : 'Congestion'}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="font-mono text-sm font-bold">{ca.segment_id}</span>
                              <p className="text-xs text-gray-500">{(ca.congestion_score * 100).toFixed(1)}% congestion</p>
                            </div>
                          </div>
                          
                          <div className="mt-2 space-y-2">
                            <div>
                              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">What happened:</p>
                              <p className="text-xs text-gray-600 dark:text-gray-400">{ca.cause}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Why:</p>
                              <p className="text-xs text-gray-600 dark:text-gray-400">{ca.reason}</p>
                            </div>
                            <div className="flex gap-3 mt-2 text-[10px] text-gray-500 flex-wrap">
                              <span className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{ca.road_type}</span>
                              <span className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{ca.lanes} lanes</span>
                              <span className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{ca.speed_kmh} km/h</span>
                              <span className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{ca.flow_vph}/{ca.capacity_vph} vph</span>
                            </div>
                          </div>

                          {ca.incident && (
                            <div className="mt-3 pt-3 border-t border-red-200 dark:border-red-800">
                              <div className="text-xs text-red-700 dark:text-red-400 space-y-1">
                                <p>Type: {ca.incident.incident_type?.replace(/_/g, ' ')}</p>
                                <p>Severity: Level {ca.incident.severity} ({ca.incident.lanes_blocked} lanes blocked)</p>
                                <p>Window: {ca.incident.start_time?.slice(11, 16)} - {ca.incident.end_time?.slice(11, 16) || 'Unknown'}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : activeIncidents.length > 0 ? (
                    <div className="space-y-4">
                      {activeIncidents.map(inc => (
                        <div key={inc.incident_id} className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 p-4">
                          <div className="flex justify-between items-start mb-2">
                            <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/50 px-2 py-1 rounded">
                              <AlertTriangle className="w-3 h-3" />
                              {inc.incident_type?.replace(/_/g, ' ')}
                            </span>
                            <span className="font-mono text-sm text-red-800 dark:text-red-300">{inc.segment_id}</span>
                          </div>
                          <div className="text-xs text-red-700 dark:text-red-400 mt-2 space-y-1">
                            <p>Severity: Level {inc.severity} ({inc.lanes_blocked} lanes blocked)</p>
                            <p>Window: {inc.start_time?.slice(11, 16)} - {inc.end_time?.slice(11, 16) || 'Unknown'}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-green-200 dark:border-green-900/50 bg-green-50 dark:bg-green-900/20 p-4 flex items-center gap-3 text-green-700 dark:text-green-400">
                      <CheckCircle className="w-5 h-5" />
                      <span className="text-sm font-medium">No active incidents detected on this route.</span>
                    </div>
                  )}

                  {/* XAI Explanation */}
                  {analysis.xai_summary && (
                    <div className="mt-4 p-4 rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50 dark:bg-indigo-900/20">
                      <p className="text-xs font-bold text-indigo-800 dark:text-indigo-300 mb-2 flex items-center gap-1">
                        <Info className="w-4 h-4" /> AI Explanation
                      </p>
                      <p className="text-xs text-indigo-700 dark:text-indigo-400 mb-2">{analysis.xai_summary.incident_explanation}</p>
                      <p className="text-xs text-indigo-600 dark:text-indigo-500">{analysis.xai_summary.congestion_cause}</p>
                    </div>
                  )}
                </>
              )}

              {/* Tab 4: Forecast — Show for ALL routes with congestion */}
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

              {/* Tab 5: Solutions — Infrastructure Interventions */}
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
                    <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
                      <Landmark className="w-4 h-4 text-indigo-500" />
                      Infrastructure Interventions
                    </h3>
                    <div className="space-y-3">
                      {analysis.solutions?.map((sol: any, i: number) => {
                        const IntIcon = INTERVENTION_ICONS[sol.type] ?? Zap;
                        return (
                          <div key={i} className={clsx(
                            'rounded-xl border bg-white dark:bg-gray-800 p-4 border-l-4',
                            sol.quality === 'high' ? 'border-l-green-500 border-gray-200 dark:border-gray-700' :
                            sol.quality === 'medium' ? 'border-l-amber-500 border-gray-200 dark:border-gray-700' :
                            'border-l-red-500 border-gray-200 dark:border-gray-700'
                          )}>
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex items-start gap-2 flex-1">
                                <div className={clsx(
                                  'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                                  sol.quality === 'high' ? 'bg-green-100 dark:bg-green-900/30 text-green-600' :
                                  sol.quality === 'medium' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600' :
                                  'bg-gray-100 dark:bg-gray-700 text-gray-500'
                                )}>
                                  <IntIcon className="w-4 h-4" />
                                </div>
                                <div className="flex-1">
                                  <span className="font-bold text-sm text-gray-900 dark:text-gray-100">{sol.action}</span>
                                  <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">
                                    {(sol.type || '').replace(/_/g, ' ')}
                                  </span>
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

                  {/* XAI Summary */}
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
