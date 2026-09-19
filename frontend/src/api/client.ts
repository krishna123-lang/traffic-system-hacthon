import axios from 'axios';

export const api = axios.create({
  baseURL: 'http://localhost:8000',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Node {
  node_id: string;
  id?: string;
  lat: number;
  lon: number;
  x?: number;
  y?: number;
  has_signal?: boolean;
}

export interface Segment {
  segment_id: string;
  id?: string;
  source_node: string;
  target_node: string;
  road_class: string;
  lanes?: number;
  free_flow_speed_kmh?: number;
  capacity_vph?: number;
  length_km?: number;
  // runtime state (present in /api/state segments)
  congestion_state?: CongestionState;
  congestion_score?: number;
  speed_kmh?: number;
  flow_vph?: number;
  delay_min?: number;
  incident_active?: boolean;
  incident_probability?: number;
}

export type CongestionState = 'normal' | 'low_risk' | 'moderate' | 'high' | 'severe' | 'incident';

export interface NetworkData {
  nodes: Node[];
  segments: Segment[];
}

export interface SegmentState {
  segment_id: string;
  id?: string;
  congestion_score: number;
  congestion_state: CongestionState;
  speed_kmh: number;
  flow_vph: number;
  occupancy_pct: number;
  delay_min: number;
  queue_length_veh: number;
  incident_active: boolean;
  incident_probability: number;
  timestamp: string;
}

export interface NetworkStateSummary {
  avg_congestion: number;
  severe_segments: number;
  high_segments: number;
  normal_segments: number;
  network_health: number;
  total_segments: number;
}

export interface NetworkState {
  timestamp: string;
  simulation_mode: boolean;
  segments: SegmentState[];
  summary: NetworkStateSummary;
}

export interface Alert {
  alert_id?: string;
  segment_id?: string;
  severity: 'info' | 'warning' | 'high' | 'critical';
  alert_type?: string;
  title?: string;
  description?: string;
  timestamp: string;
  confidence?: number;
}

export interface Incident {
  incident_id: string;
  segment_id: string;
  incident_type: string;
  severity: number; // 1=low, 2=medium, 3=high
  start_time: string;
  end_time?: string;
  lanes_blocked?: number;
  probability: number;
  confidence: number;
  evidence: string[];
  affected_neighbors: string[];
  shap_evidence?: { feature: string; value: number; impact: string }[];
}

export interface ForecastHorizon {
  horizon_minutes: number;
  predicted_value: number;
  lower_bound?: number;
  upper_bound?: number;
  congestion_state: CongestionState;
  confidence?: number;
}

export interface ForecastData {
  segment_id: string;
  timestamp: string;
  target_variable: string;
  current_value: number;
  current_state: CongestionState;
  horizons: ForecastHorizon[];
  // historical is NOT returned by the API — it's undefined
  historical?: { timestamp: string; score: number }[];
}

export interface PropagationNeighbor {
  segment_id: string;
  hop: number;
  risk: number; // field name is 'risk', NOT 'risk_score'
  risk_level: string;
  reason?: string;
  current_congestion?: number;
  congestion_state?: CongestionState;
}

export interface PropagationData {
  source_segment: string;
  source_congestion: number;
  source_state: CongestionState;
  neighbors: PropagationNeighbor[];
}

export interface DemoScenario {
  id: string;
  name: string;
  description: string;
  total_steps: number;
}

export interface DemoState {
  step: number;
  timestamp: string;
  simulation_time: string;
  incident_active: boolean;
  incident_segment?: string;
  segment_states: SegmentState[];
  propagation_segments?: string[];
  summary: NetworkState['summary'];
}

export interface Route {
  // Real API field names from /api/routes
  path: string[];            // node IDs — NOT 'nodes'
  segments: string[];
  edges: { from: string; to: string; segment_id: string }[];
  total_cost: number;
  base_travel_time: number;
  eta_minutes: number;               // NOT 'estimated_time_min'
  estimated_delay_minutes: number;   // NOT 'delay_min'
  total_length_km: number;           // NOT 'total_distance_km'
  n_hops: number;
  avg_congestion: number;
  max_congestion: number;
  passes_incident: boolean;
  passes_propagation_risk: boolean;
  secondary_congestion_risk: number;
  risk_level: string;                // 'minimal' | 'low' | 'medium' | 'high'
  rank: number;
  cost_vs_best: number;
  why_recommended: string[];
  why_not: string[];
  label: string;                     // 'Primary' | 'Alternative A' | etc.
  confidence: number;

  // Derived helpers — NOT in API, use for display
  is_recommended?: boolean;          // derived: rank === 1
  route_id?: string;                 // derived: label or 'route-' + rank
}

export interface Bottleneck {
  segment_id: string;
  rank?: number;
  score?: number;
  frequency?: number;
  avg_duration_min?: number;
  severity?: string;
  peak_hours?: string[];
}

export interface PlanningCandidate {
  candidate_id: string;      // NOT 'id'
  target_segment: string;    // NOT 'segment_id'
  intervention_type: string;
  capacity_delta_vph: number; // NOT 'capacity_delta'
  cost_index: number;         // NOT 'cost_estimate'
  feasibility_band: string;
}

export interface InterventionResult {
  candidate_id: string;
  target_segment: string;
  intervention_type: string;
  capacity_delta_vph: number;
  feasibility_band: string;
  before: {
    avg_congestion_score: number;
    max_congestion_score: number;
    severe_segments: number;
    high_segments: number;
    avg_delay_min: number;
    max_delay_min: number;
    avg_speed_kmh: number;
    network_health_score: number;
    congestion_variance?: number;
  };
  after: {
    avg_congestion_score: number;
    max_congestion_score: number;
    severe_segments: number;
    high_segments: number;
    avg_delay_min: number;
    max_delay_min: number;
    avg_speed_kmh: number;
    network_health_score: number;
    congestion_variance?: number;
  };
  changes: Record<string, { before: number; after: number; change_pct: number; direction: string }>;
  confidence: number;
  disclaimer: string;
  key_benefits: string[];
}

// Each entry in forecast_metrics is ONE row: one model × one horizon
export interface ForecastMetric {
  model: string;
  horizon_minutes: number; // 15, 30, 45, or 60
  mae: number;
  rmse: number;
  smape: number;
  mae_peak?: number;
  mae_incident?: number;
}

export interface IncidentMetric {
  model: string;
  threshold: number;
  precision: number;
  recall: number;
  f1: number;
  pr_auc: number;
  false_alarm_rate: number;
  confusion_matrix?: any; // may be stringified
  n_train: number;
  n_val: number;
  n_positive_train: number;
  n_positive_val: number;
}

export interface Metrics {
  forecast_metrics: ForecastMetric[];
  incident_metrics: IncidentMetric[];
  robustness: Record<string, any>;
  timestamp: string;
}

export interface DataHealthDataset {
  rows?: number;
  segments?: number;
  missing_pct?: Record<string, number>;
  time_range?: { start: string; end: string };
  status: string;
}

// /api/data-health returns a plain object { traffic_train: {...}, traffic_validation: {...}, ... }
export type DataHealth = Record<string, DataHealthDataset>;

export interface SegmentDetail {
  segment_id: string;
  timestamp: string;
  network: {
    segment_id: string;
    source_node: string;
    target_node: string;
    road_class: string;
    lanes: number;
    free_flow_speed_kmh: number;
    capacity_vph: number;
    length_km: number;
    grade_pct?: number;
    signal_id?: string;
    structural_bottleneck?: number;
    importance?: number;
  };
  current_state: {
    speed_kmh: number;
    flow_vph: number;
    occupancy_pct: number;
    travel_time_min: number;
    delay_min: number;
    queue_length_veh: number;
    congestion_index: number;
    congestion_score: number;
    congestion_state: CongestionState;
    flow_utilization: number;
  };
  incident_probability: number;
  forecast: { horizon_minutes: number; predicted_value: number; congestion_state: CongestionState }[];
  is_structural_bottleneck: boolean;
}

export interface Waypoint {
  lat: number;
  lon: number;
  segment_id?: string;
  speed_factor?: number;
}

// ─── API Functions ────────────────────────────────────────────────────────────

export const healthCheck = () => api.get<{ status: string }>('/api/health').then(r => r.data);

export const fetchAlerts = () => api.get<{ alerts: Alert[] }>('/api/alerts').then(r => r.data);

export const fetchDemoScenarios = () => api.get<{ scenarios: DemoScenario[] }>('/api/demo/scenarios').then(r => r.data);

export const fetchDemoState = (scenarioId: string, step: number) =>
  api.get<DemoState>(`/api/demo/scenarios/${scenarioId}/state`, { params: { step } }).then(r => r.data);

export const fetchNetwork = () => api.get<NetworkData>('/api/network').then(r => r.data);

export const simulateTrip = (waypoints: { lat: number; lon: number }[]) =>
  api.post<{ waypoints: Waypoint[] }>('/api/trips/simulate', { waypoints }).then(r => r.data);

export const fetchState = (timestamp?: string) =>
  api.get<NetworkState>('/api/state', { params: timestamp ? { timestamp } : {} }).then(r => r.data);

export const fetchIncidents = () =>
  api.get<{ incidents: Incident[] }>('/api/incidents').then(r => r.data);

export const fetchForecast = (segmentId: string) =>
  api.get<ForecastData>(`/api/forecast/${segmentId}`).then(r => r.data);

// forecasts is a DICT keyed by segment_id, NOT an array
export const fetchForecastBatch = (segmentIds: string[]) =>
  api.post<{ forecasts: Record<string, ForecastData>; count: number }>(
    '/api/forecast/batch',
    { segment_ids: segmentIds }
  ).then(r => r.data);

export const fetchPropagation = (segmentId: string) =>
  api.get<PropagationData>(`/api/propagation/${segmentId}`).then(r => r.data);

export const fetchRoutes = (sourceNode: string, targetNode: string) =>
  api.post<{ routes: Route[] }>('/api/routes', { source_node: sourceNode, target_node: targetNode }).then(r => r.data);

export const fetchBottlenecks = () =>
  api.get<{ bottlenecks: Bottleneck[]; timestamp: string }>('/api/bottlenecks').then(r => r.data);

export const simulateIntervention = (candidateId: string) =>
  api.post<InterventionResult>('/api/interventions/simulate', { candidate_id: candidateId }).then(r => r.data);

export const fetchMetrics = () =>
  api.get<Metrics>('/api/metrics').then(r => r.data);

export const fetchDataHealth = () =>
  api.get<DataHealth>('/api/data-health').then(r => r.data);

export const fetchPlanningCandidates = () =>
  api.get<{ candidates: PlanningCandidate[] }>('/api/planning/candidates').then(r => r.data);

export const fetchSegmentDetail = (segmentId: string) =>
  api.get<SegmentDetail>(`/api/segments/${segmentId}`).then(r => r.data);

export const fetchDemoScenarioState = (scenarioId: string, step: number) =>
  api.get(`/api/demo/scenarios/${scenarioId}/state`, { params: { step } }).then(r => r.data);

export const snapToNode = (lat: number, lon: number) =>
  api.get<{ node_id: string; lat: number; lon: number }>('/api/snap-to-node', { params: { lat, lon } }).then(r => r.data);

export interface SegmentCongestion {
  segment_id: string;
  congestion_score: number;
  congestion_state: string;
  speed_kmh: number;
  flow_vph: number;
  delay_min: number;
}

export interface CongestionPoint {
  segment_id: string;
  congestion_score: number;
  reason: string;
  position_pct: number;
}

export interface ForecastHorizonSummary {
  avg_congestion: number;
  max_congestion: number;
  trend: 'worsening' | 'improving' | 'stable';
}

export interface DiversionOption {
  route_label: string;
  route: Route;
  avoids_segments: string[];
  congestion_reduction_pct: number;
  quality: 'high' | 'medium' | 'low';
  reason: string;
  confidence: number;
}

export interface Solution {
  quality: 'high' | 'medium' | 'low';
  action: string;
  congestion_reduction_pct: number;
  confidence: number;
  reason: string;
  feasibility: string;
}

export interface JourneyRoute extends Route {
  segment_congestion: SegmentCongestion[];
  route_avg_congestion: number;
  route_max_congestion: number;
  congestion_points: CongestionPoint[];
  incidents_on_route: Incident[];
  incident_detection_confidence: number;
  forecast: Record<string, ForecastHorizonSummary>;
  forecast_accuracy: Record<string, number>;
}

export interface JourneyAnalysis {
  source_node: string;
  target_node: string;
  departure_time: string;
  routes: JourneyRoute[];
  diversions: DiversionOption[];
  solutions: Solution[];
  xai_summary: {
    congestion_cause: string;
    incident_explanation: string;
    forecast_insight: string;
  };
}

export const fetchJourneyAnalysis = (source: string, target: string, time: string) =>
  api.post<JourneyAnalysis>('/api/journey/analyze', {
    source_node: source,
    target_node: target,
    departure_time: time,
  }).then(r => r.data);
