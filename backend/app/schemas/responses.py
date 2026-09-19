"""
FlowGuard AI — Pydantic schemas for all API responses.
"""

from pydantic import BaseModel, Field
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime


# ──────────────────────────────────────────────
# Common
# ──────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    version: str = "1.0.0"
    mode: str = "SIMULATION"
    dataset: str = "NEURAX Smart Cities Dataset v2"
    data_source: str = "organizer_dataset"
    timestamp: str


class SimulationStatus(BaseModel):
    mode: str = "SIMULATION"
    dataset: str = "NEURAX Smart Cities Dataset v2"
    timestamp: str
    data_source: str = "organizer_dataset"
    network_loaded: bool
    models_loaded: bool
    graph_loaded: bool


# ──────────────────────────────────────────────
# Network
# ──────────────────────────────────────────────

class NodeInfo(BaseModel):
    node_id: str
    lat: float
    lon: float
    x: int
    y: int
    has_signal: bool = False
    restrictions: List[Dict] = []


class SegmentInfo(BaseModel):
    segment_id: str
    source_node: str
    target_node: str
    road_class: str
    lanes: int
    free_flow_speed_kmh: float
    capacity_vph: float
    length_km: float
    structural_bottleneck: bool
    importance: float
    # Dynamic (updated at runtime)
    congestion_score: float = 0.0
    congestion_state: str = "normal"
    speed_kmh: float = 0.0
    flow_vph: float = 0.0
    delay_min: float = 0.0
    incident_active: bool = False
    propagation_risk: float = 0.0


class NetworkResponse(BaseModel):
    nodes: List[NodeInfo]
    segments: List[SegmentInfo]
    n_nodes: int
    n_segments: int
    meta: Dict[str, Any] = {}


# ──────────────────────────────────────────────
# Traffic State
# ──────────────────────────────────────────────

class SegmentState(BaseModel):
    segment_id: str
    congestion_score: float
    congestion_state: str
    speed_kmh: float
    flow_vph: float
    occupancy_pct: float = 0.0
    delay_min: float = 0.0
    queue_length_veh: float = 0.0
    incident_active: bool = False
    incident_probability: float = 0.0
    propagation_risk: float = 0.0
    timestamp: Optional[str] = None


class NetworkStateResponse(BaseModel):
    timestamp: str
    simulation_mode: bool = True
    segments: List[SegmentState]
    summary: Dict[str, Any]


# ──────────────────────────────────────────────
# Alerts & Incidents
# ──────────────────────────────────────────────

class Alert(BaseModel):
    alert_id: str
    segment_id: str
    alert_type: str  # incident, congestion, risk, propagation
    severity: str    # low, medium, high, critical
    title: str
    description: str
    timestamp: str
    confidence: float = 0.0
    evidence: List[str] = []
    propagation_risk: Optional[float] = None


class Incident(BaseModel):
    incident_id: str
    segment_id: str
    incident_type: str
    severity: int
    start_time: str
    end_time: Optional[str] = None
    lanes_blocked: int = 0
    probability: float = 1.0
    confidence: float = 0.9
    evidence: List[Dict] = []
    affected_neighbors: List[str] = []


# ──────────────────────────────────────────────
# Forecasting
# ──────────────────────────────────────────────

class HorizonForecast(BaseModel):
    horizon_minutes: int
    predicted_value: float
    lower_bound: float
    upper_bound: float
    congestion_state: str
    confidence: float


class SegmentForecast(BaseModel):
    segment_id: str
    timestamp: str
    target_variable: str
    current_value: float
    current_state: str
    horizons: List[HorizonForecast]
    history: List[Dict] = []
    model_used: str = "xgboost"


class ForecastBatchRequest(BaseModel):
    segment_ids: List[str]
    timestamp: Optional[str] = None


class ForecastBatchResponse(BaseModel):
    timestamp: str
    forecasts: Dict[str, List[HorizonForecast]]


# ──────────────────────────────────────────────
# Propagation
# ──────────────────────────────────────────────

class PropagationNeighbor(BaseModel):
    segment_id: str
    hop: int
    risk: float
    risk_level: str
    horizon_risks: Dict[str, float]
    reason: str
    current_congestion: float
    congestion_state: str


class PropagationResponse(BaseModel):
    source_segment: str
    source_congestion: float
    source_state: str
    neighbors: List[PropagationNeighbor]
    timestamp: str


# ──────────────────────────────────────────────
# Routing
# ──────────────────────────────────────────────

class RouteRequest(BaseModel):
    source_node: str
    target_node: str
    timestamp: Optional[str] = None


class RouteResponse(BaseModel):
    source_node: str
    target_node: str
    routes: List[Dict[str, Any]]
    timestamp: str
    simulation_note: str = "SIMULATION / ADVISORY — not live navigation"


class TripSimulateRequest(BaseModel):
    source_node: str
    target_node: str
    vehicle_type: str = "car"
    timestamp: Optional[str] = None


class TripSimulateResponse(BaseModel):
    trip_id: str
    source_node: str
    target_node: str
    vehicle_type: str
    route: Dict[str, Any]
    waypoints: List[Dict]  # [{lat, lon, segment_id, expected_speed}]
    estimated_duration_minutes: float
    estimated_distance_km: float


# ──────────────────────────────────────────────
# Bottlenecks
# ──────────────────────────────────────────────

class Bottleneck(BaseModel):
    rank: int
    segment_id: str
    bottleneck_score: float
    high_congestion_frequency: float
    severe_congestion_frequency: float
    avg_duration_minutes: float
    n_episodes: int
    centrality: float
    structural_bottleneck: bool
    importance: float
    severity: str
    candidate_interventions: List[Dict] = []


class BottlenecksResponse(BaseModel):
    bottlenecks: List[Bottleneck]
    timestamp: str


# ──────────────────────────────────────────────
# Interventions
# ──────────────────────────────────────────────

class InterventionRequest(BaseModel):
    candidate_id: str
    segment_id: Optional[str] = None


class InterventionResponse(BaseModel):
    candidate_id: str
    target_segment: str
    intervention_type: str
    before: Dict[str, float]
    after: Dict[str, float]
    changes: Dict[str, Dict]
    key_benefits: List[str]
    confidence: float
    disclaimer: str


# ──────────────────────────────────────────────
# Model Metrics
# ──────────────────────────────────────────────

class ForecastMetrics(BaseModel):
    model: str
    horizon_minutes: int
    mae: float
    rmse: float
    smape: float
    mae_peak: Optional[float] = None
    mae_incident: Optional[float] = None


class IncidentMetrics(BaseModel):
    model: str
    precision: float
    recall: float
    f1: float
    pr_auc: float
    false_alarm_rate: float
    threshold: float


class ModelMetricsResponse(BaseModel):
    forecast_metrics: List[ForecastMetrics]
    incident_metrics: List[IncidentMetrics]
    robustness: Dict[str, Any] = {}


# ──────────────────────────────────────────────
# Demo
# ──────────────────────────────────────────────

class DemoScenario(BaseModel):
    scenario_id: str
    name: str
    description: str
    type: str
    total_steps: int
    incident_segment: Optional[str] = None


class DemoStartRequest(BaseModel):
    scenario_id: str


class DemoStateRequest(BaseModel):
    scenario_id: str
    step: Optional[int] = None
    timestamp: Optional[str] = None
