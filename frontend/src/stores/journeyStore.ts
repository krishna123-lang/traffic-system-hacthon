import { create } from 'zustand';
import type { JourneyAnalysis, JourneyRoute, Incident } from '../api/client';

export interface XAIExplanation {
  incidentId: string;
  segmentId: string;
  title: string;
  cause: string;
  why: string;
  impact: string;
  recommendation: string;
  severity: number;
  confidence: number;
  evidence: string[];
  laneCapacityLoss: string;
  estimatedClearance: string;
  alternativeAction: string;
}

const XAI_CAUSE_MAP: Record<string, {
  cause: string; why: string; recommendation: string;
  clearance: string; alternativeAction: string;
}> = {
  stalled_vehicle: {
    cause: 'Vehicle Breakdown',
    why: 'A vehicle has stalled (mechanical failure, flat tyre, or fuel exhaustion), blocking one or more lanes and causing a bottleneck effect upstream.',
    recommendation: 'Emergency response dispatched. Expect 15–30 min clearance. Use diversion if delay exceeds 10 min.',
    clearance: '15–30 minutes',
    alternativeAction: 'Wait at nearest safe pullout for 20 min, then re-check route. Signal assistance if no clearance.',
  },
  accident_like: {
    cause: 'Traffic Collision',
    why: 'Collision or near-collision pattern detected from sudden speed drop combined with flow anomaly in sensor data. High probability of secondary incidents due to rubbernecking.',
    recommendation: 'Emergency services may be en route. Take alternate route immediately to avoid secondary incidents.',
    clearance: '30–60 minutes',
    alternativeAction: 'Do NOT attempt to pass through. U-turn to nearest junction and take alternate. Report to traffic control.',
  },
  road_closure: {
    cause: 'Full Road Closure',
    why: 'Segment is completely closed — due to planned maintenance, emergency response operation, or structural hazard. Zero vehicles can pass.',
    recommendation: 'Mandatory diversion. Follow authority signs. No expected reopening within your journey window.',
    clearance: 'Unknown — check authority',
    alternativeAction: 'Mandatory diversion only. Contact city traffic control for estimated reopening time.',
  },
  demand_surge: {
    cause: 'Traffic Demand Surge',
    why: 'Sudden demand spike beyond segment capacity — triggered by peak hour convergence, nearby event, or upstream signal failure causing vehicles to queue.',
    recommendation: 'Delay departure by 30+ min OR take longer alternate route with lower congestion score.',
    clearance: '30–90 minutes (demand-dependent)',
    alternativeAction: 'Park at nearest safe location. Delay journey by 30 min and retry. Alternatively, take transit.',
  },
  lane_blockage: {
    cause: 'Lane Blockage',
    why: 'One or more lanes are blocked by a disabled vehicle, debris, or enforcement activity, reducing effective road width and causing merging delays.',
    recommendation: 'Reduced capacity. Expect 10–25 min delay. Consider diversion if time-sensitive.',
    clearance: '10–25 minutes',
    alternativeAction: 'Use adjacent parallel road if available. Otherwise proceed at reduced speed; lane should clear.',
  },
  weather_hazard: {
    cause: 'Weather Hazard',
    why: 'Adverse weather (rain, fog, or reduced visibility) causing drivers to slow below free-flow speed, compressing headways and reducing throughput.',
    recommendation: 'Reduce speed to safe level. Allow 10–15 min extra. Avoid sudden braking.',
    clearance: 'Weather-dependent',
    alternativeAction: 'Seek shelter and wait for conditions to improve, or take sheltered alternative route.',
  },
  debris: {
    cause: 'Road Debris / Spillage',
    why: 'Fallen objects or cargo spillage from a vehicle occupying usable road width, causing evasive manoeuvring by other vehicles.',
    recommendation: 'Single usable lane. Expect 10–20 min clearance. Diversion if time-critical.',
    clearance: '10–20 minutes',
    alternativeAction: 'Proceed with caution in available lane. Do not stop on road. Report to highway authority.',
  },
};

const DEFAULT_XAI = {
  cause: 'Traffic Anomaly',
  why: 'Sensor data detected abnormal traffic patterns inconsistent with historical baseline for this time period. Possible causes: signal failure, spontaneous congestion, or upstream incident not yet classified.',
  recommendation: 'Monitor situation. Consider alternate route if delay exceeds 10 min.',
  clearance: '10–20 minutes',
  alternativeAction: 'Proceed cautiously. Monitor real-time traffic updates.',
};

export function buildXAIExplanation(incident: Incident): XAIExplanation {
  const typeInfo = XAI_CAUSE_MAP[incident.incident_type ?? ''] ?? DEFAULT_XAI;
  const severityLabels = ['', 'Minor', 'Moderate', 'Severe'];
  const severityNum = incident.severity ?? 1;
  const lanes = incident.lanes_blocked ?? 1;
  const capacityLoss = Math.round((lanes / 3) * 100);

  return {
    incidentId: incident.incident_id,
    segmentId: incident.segment_id,
    title: `${typeInfo.cause} — ${incident.segment_id}`,
    cause: typeInfo.cause,
    why: typeInfo.why,
    impact: `${severityLabels[severityNum] ?? 'Unknown'} severity (${severityNum}/3). ${lanes} lane(s) blocked. Estimated capacity reduction: ~${capacityLoss}%. Confidence: ${((incident.confidence ?? 0.85) * 100).toFixed(0)}%.`,
    recommendation: typeInfo.recommendation,
    severity: severityNum,
    confidence: incident.confidence ?? 0.85,
    evidence: incident.evidence ?? [],
    laneCapacityLoss: `${lanes} of ~3 lanes blocked (~${capacityLoss}% capacity loss)`,
    estimatedClearance: typeInfo.clearance,
    alternativeAction: typeInfo.alternativeAction,
  };
}

export interface AINoRouteAction {
  title: string;
  steps: string[];
  eta: string;
}

interface JourneyState {
  sourceNode: string;
  targetNode: string;
  departureTime: string;
  analysis: JourneyAnalysis | null;
  selectedRouteIdx: number;
  selectedSolutionIdx: number | null;
  activeTab: 'route' | 'congestion' | 'incidents' | 'forecast' | 'solutions';
  isAnalyzing: boolean;
  
  setSource: (n: string) => void;
  setTarget: (n: string) => void;
  setDepartureTime: (t: string) => void;
  setAnalysis: (a: JourneyAnalysis | null) => void;
  setSelectedRoute: (idx: number) => void;
  setSelectedSolution: (idx: number | null) => void;
  setActiveTab: (tab: JourneyState['activeTab']) => void;
  setAnalyzing: (v: boolean) => void;
  reset: () => void;
  
  selectedRoute: () => JourneyRoute | null;
  primaryRoute: () => JourneyRoute | null;
  hasIncidents: () => boolean;
  hasCongestion: () => boolean;
}

export const useJourneyStore = create<JourneyState>((set, get) => ({
  sourceNode: '',
  targetNode: '',
  departureTime: '2026-01-11 13:30:00',
  analysis: null,
  selectedRouteIdx: 0,
  selectedSolutionIdx: null,
  activeTab: 'route',
  isAnalyzing: false,
  
  setSource: (n) => set({ sourceNode: n }),
  setTarget: (n) => set({ targetNode: n }),
  setDepartureTime: (t) => set({ departureTime: t }),
  setAnalysis: (a) => set({ analysis: a, selectedRouteIdx: 0, selectedSolutionIdx: null, activeTab: 'route' }),
  setSelectedRoute: (idx) => set({ selectedRouteIdx: idx }),
  setSelectedSolution: (idx) => set(state => ({ selectedSolutionIdx: state.selectedSolutionIdx === idx ? null : idx })),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setAnalyzing: (v) => set({ isAnalyzing: v }),
  reset: () => set({ analysis: null, selectedRouteIdx: 0, selectedSolutionIdx: null, activeTab: 'route', isAnalyzing: false }),
  
  selectedRoute: () => {
    const { analysis, selectedRouteIdx } = get();
    return analysis?.routes?.[selectedRouteIdx] ?? null;
  },
  primaryRoute: () => get().analysis?.routes?.[0] ?? null,
  hasIncidents: () => {
    const route = get().selectedRoute();
    return (route?.incidents_on_route?.length ?? 0) > 0;
  },
  hasCongestion: () => {
    const route = get().selectedRoute();
    return (route?.congestion_points?.length ?? 0) > 0;
  },
}));
