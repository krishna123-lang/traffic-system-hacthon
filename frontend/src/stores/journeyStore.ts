import { create } from 'zustand';
import type { Route, Incident } from '../api/client';

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
  const capacityLoss = Math.round((lanes / 3) * 100); // assume 3 lanes total

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

export function parseSimTime(ts: string): Date {
  return new Date(ts.replace(' ', 'T'));
}

export function addMinutes(ts: string, mins: number): string {
  const d = parseSimTime(ts);
  d.setMinutes(d.getMinutes() + mins);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

export function formatSimTime(ts: string): string {
  if (!ts) return '--:--';
  return ts.slice(11, 16);
}

export function formatSimDateTime(ts: string): string {
  if (!ts) return '---';
  try {
    const d = parseSimTime(ts);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + ts.slice(11, 16);
  } catch { return ts.slice(0, 16); }
}

export interface AINoRouteAction {
  title: string;
  steps: string[];
  eta: string;
}

function buildNoRouteAction(incidents: Incident[]): AINoRouteAction {
  const types = incidents.map(i => i.incident_type ?? '');
  const hasRoadClosure = types.includes('road_closure');
  const hasAccident = types.includes('accident_like');

  if (hasRoadClosure) {
    return {
      title: 'All routes blocked by road closure',
      steps: [
        'Stop at the nearest safe pullout or parking area immediately.',
        'Contact city traffic control for diversion instructions.',
        'Do not attempt to use unverified shortcuts — they may be similarly affected.',
        'Estimated wait: 30–120 min depending on closure reason.',
        'If urgent, consider public transport or alternate mode.',
      ],
      eta: '30–120 min delay',
    };
  } else if (hasAccident) {
    return {
      title: 'All alternate routes affected by incidents',
      steps: [
        'Pull over safely and stop your vehicle.',
        'Allow emergency vehicles to pass; keep all lanes clear.',
        'Wait 20 min for primary incident clearance.',
        'Re-check route options after clearance — congestion should ease.',
        'Contact authorities if you need emergency assistance.',
      ],
      eta: '20–45 min delay',
    };
  }
  return {
    title: 'Multiple blockages detected — no clear diversion',
    steps: [
      'Stop safely and assess your options.',
      'Use local knowledge or GPS to find a parallel road not in the route network.',
      'Delay your journey by 30 minutes and retry routing.',
      'Consider contacting destination to advise of delay.',
    ],
    eta: '30 min delay recommended',
  };
}

interface JourneyState {
  sourceNode: string;
  targetNode: string;
  departureTime: string;

  journeyActive: boolean;
  allRoutes: Route[];
  selectedRoute: Route | null;
  selectedRouteIdx: number;
  routeSegments: string[];
  routeNodes: string[];

  simTimestamp: string;
  simStep: number;
  totalSteps: number;
  isPlaying: boolean;
  speed: 1 | 2 | 5;

  allIncidents: Incident[];
  routeIncidents: Incident[];
  nearbyIncidents: Incident[];    // incidents on neighboring segments
  activeIncidents: Incident[];
  acknowledgedIncidents: string[];

  currentXAI: XAIExplanation | null;
  diversionRoute: Route | null;
  diversionTriggeredBy: string | null;
  noRouteAvailable: boolean;
  noRouteAction: AINoRouteAction | null;

  setSource: (n: string) => void;
  setTarget: (n: string) => void;
  setDepartureTime: (t: string) => void;
  startJourney: (routes: Route[], incidents: Incident[]) => void;
  selectRoute: (idx: number) => void;
  tick: () => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: 1 | 2 | 5) => void;
  setDiversionRoute: (r: Route | null, triggeredBy?: string | null) => void;
  acknowledgeIncident: (id: string) => void;
  resetJourney: () => void;
  setStep: (step: number) => void;
  triggerAutodiversion: () => void;
}

// --- Helpers ---
function computeRouteIncidents(
  route: Route,
  allIncidents: Incident[],
  departureTime: string
): { routeIncidents: Incident[]; nearbyIncidents: Incident[] } {
  const segments: string[] = route.segments ?? [];
  const segSet = new Set(segments);
  const etaMin = Math.ceil(route.eta_minutes ?? 30);
  const dep = parseSimTime(departureTime);
  const arr = new Date(dep.getTime() + etaMin * 60000);

  // Build set of all segments mentioned in affected_neighbors across all incidents
  const neighborOfRoute = new Set<string>();
  allIncidents.forEach(inc => {
    (inc.affected_neighbors ?? []).forEach(n => {
      if (segSet.has(n)) neighborOfRoute.add(inc.segment_id);
    });
    // Also: if incident segment's affected_neighbors includes route segments
    if (segSet.has(inc.segment_id)) {
      (inc.affected_neighbors ?? []).forEach(n => neighborOfRoute.add(n));
    }
  });

  const routeIncidents: Incident[] = [];
  const nearbyIncidents: Incident[] = [];

  allIncidents.forEach(inc => {
    const incStart = parseSimTime(inc.start_time ?? '2000-01-01 00:00:00');
    const incEnd = parseSimTime(inc.end_time ?? inc.start_time ?? '2000-01-01 00:00:00');
    if (incStart > arr || incEnd < dep) return; // outside journey window

    if (segSet.has(inc.segment_id)) {
      routeIncidents.push(inc);
    } else if (neighborOfRoute.has(inc.segment_id)) {
      nearbyIncidents.push(inc);
    }
  });

  return { routeIncidents, nearbyIncidents };
}

function getActiveIncidents(
  routeIncidents: Incident[],
  acknowledgedIncidents: string[],
  simTimestamp: string
): Incident[] {
  const now = parseSimTime(simTimestamp);
  return routeIncidents.filter(inc => {
    if (acknowledgedIncidents.includes(inc.incident_id)) return false;
    const incStart = parseSimTime(inc.start_time ?? '');
    // incident window: from start to end (or start + 30min if no end)
    const incEndRaw = inc.end_time ?? inc.start_time ?? '';
    const incEnd = parseSimTime(incEndRaw);
    return now >= incStart && now <= incEnd;
  });
}

function findDiversionRoute(
  allRoutes: Route[],
  activeIncidentSegs: Set<string>
): Route | null {
  return allRoutes.find(r =>
    !(r.segments ?? []).some(s => activeIncidentSegs.has(s))
  ) ?? null;
}

export const useJourneyStore = create<JourneyState>((set, get) => ({
  sourceNode: '',
  targetNode: '',
  departureTime: '2026-01-11 13:00:00',

  journeyActive: false,
  allRoutes: [],
  selectedRoute: null,
  selectedRouteIdx: 0,
  routeSegments: [],
  routeNodes: [],

  simTimestamp: '',
  simStep: 0,
  totalSteps: 0,
  isPlaying: false,
  speed: 1,

  allIncidents: [],
  routeIncidents: [],
  nearbyIncidents: [],
  activeIncidents: [],
  acknowledgedIncidents: [],

  currentXAI: null,
  diversionRoute: null,
  diversionTriggeredBy: null,
  noRouteAvailable: false,
  noRouteAction: null,

  setSource: (n) => set({ sourceNode: n }),
  setTarget: (n) => set({ targetNode: n }),
  setDepartureTime: (t) => set({ departureTime: t }),

  startJourney: (routes, incidents) => {
    const { departureTime } = get();
    if (!routes.length) return;

    const primary = routes[0];
    const segments: string[] = primary.segments ?? [];
    const nodes: string[] = primary.path ?? [];
    const etaMin = Math.ceil(primary.eta_minutes ?? 30);
    const totalSteps = Math.max(Math.ceil(etaMin / 2), 6); // 2-min ticks for smoother animation

    const { routeIncidents, nearbyIncidents } = computeRouteIncidents(primary, incidents, departureTime);

    set({
      journeyActive: true,
      allRoutes: routes,
      selectedRoute: primary,
      selectedRouteIdx: 0,
      routeSegments: segments,
      routeNodes: nodes,
      simTimestamp: departureTime,
      simStep: 0,
      totalSteps,
      isPlaying: false,
      allIncidents: incidents,
      routeIncidents,
      nearbyIncidents,
      activeIncidents: [],
      acknowledgedIncidents: [],
      currentXAI: null,
      diversionRoute: null,
      diversionTriggeredBy: null,
      noRouteAvailable: false,
      noRouteAction: null,
    });
  },

  selectRoute: (idx) => {
    const { allRoutes, allIncidents, departureTime } = get();
    const route = allRoutes[idx];
    if (!route) return;

    const segments: string[] = route.segments ?? [];
    const nodes: string[] = route.path ?? [];
    const etaMin = Math.ceil(route.eta_minutes ?? 30);
    const totalSteps = Math.max(Math.ceil(etaMin / 2), 6);
    const { routeIncidents, nearbyIncidents } = computeRouteIncidents(route, allIncidents, departureTime);

    set({
      selectedRoute: route,
      selectedRouteIdx: idx,
      routeSegments: segments,
      routeNodes: nodes,
      totalSteps,
      routeIncidents,
      nearbyIncidents,
      activeIncidents: [],
      diversionRoute: null,
      diversionTriggeredBy: null,
      noRouteAvailable: false,
      noRouteAction: null,
    });
  },

  tick: () => {
    const state = get();
    const { simStep, totalSteps, simTimestamp, routeIncidents, acknowledgedIncidents, allRoutes } = state;

    if (simStep >= totalSteps) {
      set({ isPlaying: false });
      return;
    }

    const newStep = simStep + 1;
    const newTime = addMinutes(simTimestamp, 2); // 2-min ticks

    const newActive = getActiveIncidents(routeIncidents, acknowledgedIncidents, newTime);
    const newXAI = newActive.length > 0 ? buildXAIExplanation(newActive[0]) : state.currentXAI;

    let diversionRoute = state.diversionRoute;
    let noRouteAvailable = state.noRouteAvailable;
    let noRouteAction = state.noRouteAction;

    // Auto-diversion: when new active incident appears and no diversion yet
    if (newActive.length > 0 && !state.diversionRoute && !noRouteAvailable) {
      const incidentSegs = new Set(newActive.map(i => i.segment_id));
      const safe = findDiversionRoute(allRoutes, incidentSegs);

      if (safe) {
        diversionRoute = safe;
      } else {
        // ALL routes blocked — give AI recommendation
        noRouteAvailable = true;
        noRouteAction = buildNoRouteAction(newActive);
        diversionRoute = null;
      }
    }

    // Auto-pause when first incident is detected
    const shouldPause = newActive.length > 0 && state.activeIncidents.length === 0;

    set({
      simStep: newStep,
      simTimestamp: newTime,
      activeIncidents: newActive,
      currentXAI: newXAI,
      diversionRoute,
      diversionTriggeredBy: diversionRoute ? (newActive[0]?.incident_id ?? null) : null,
      noRouteAvailable,
      noRouteAction,
      isPlaying: shouldPause ? false : state.isPlaying,
    });
  },

  setStep: (step) => {
    const { departureTime, totalSteps, routeIncidents, acknowledgedIncidents, allRoutes } = get();
    const clampedStep = Math.max(0, Math.min(step, totalSteps));
    const newTime = addMinutes(departureTime, clampedStep * 2);

    const newActive = getActiveIncidents(routeIncidents, acknowledgedIncidents, newTime);
    const newXAI = newActive.length > 0 ? buildXAIExplanation(newActive[0]) : null;

    let diversionRoute: Route | null = null;
    let noRouteAvailable = false;
    let noRouteAction: AINoRouteAction | null = null;

    if (newActive.length > 0) {
      const incidentSegs = new Set(newActive.map(i => i.segment_id));
      const safe = findDiversionRoute(allRoutes, incidentSegs);
      if (safe) {
        diversionRoute = safe;
      } else {
        noRouteAvailable = true;
        noRouteAction = buildNoRouteAction(newActive);
      }
    }

    set({
      simStep: clampedStep,
      simTimestamp: newTime,
      activeIncidents: newActive,
      currentXAI: newXAI,
      diversionRoute,
      noRouteAvailable,
      noRouteAction,
      diversionTriggeredBy: diversionRoute ? (newActive[0]?.incident_id ?? null) : null,
    });
  },

  triggerAutodiversion: () => {
    const { activeIncidents, allRoutes } = get();
    if (!activeIncidents.length) return;
    const incidentSegs = new Set(activeIncidents.map(i => i.segment_id));
    const safe = findDiversionRoute(allRoutes, incidentSegs);

    if (safe) {
      set({ diversionRoute: safe, noRouteAvailable: false, noRouteAction: null });
    } else {
      set({
        diversionRoute: null,
        noRouteAvailable: true,
        noRouteAction: buildNoRouteAction(activeIncidents),
      });
    }
  },

  setPlaying: (p) => set({ isPlaying: p }),
  setSpeed: (s) => set({ speed: s }),
  setDiversionRoute: (r, triggeredBy = null) => set({ diversionRoute: r, diversionTriggeredBy: triggeredBy ?? null }),

  acknowledgeIncident: (id) => set(state => ({
    acknowledgedIncidents: [...state.acknowledgedIncidents, id],
    activeIncidents: state.activeIncidents.filter(i => i.incident_id !== id),
  })),

  resetJourney: () => set({
    journeyActive: false,
    allRoutes: [],
    selectedRoute: null,
    selectedRouteIdx: 0,
    routeSegments: [],
    routeNodes: [],
    simTimestamp: '',
    simStep: 0,
    totalSteps: 0,
    isPlaying: false,
    activeIncidents: [],
    routeIncidents: [],
    nearbyIncidents: [],
    currentXAI: null,
    diversionRoute: null,
    diversionTriggeredBy: null,
    noRouteAvailable: false,
    noRouteAction: null,
    acknowledgedIncidents: [],
  }),
}));
