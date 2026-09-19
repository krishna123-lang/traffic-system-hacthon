# FlowGuard AI - Schema Adapter
"""
Schema adapter layer — makes the codebase resilient to minor column-name changes.
All column references go through this module.
"""

from typing import Optional, Dict, Any
import pandas as pd

# ──────────────────────────────────────────────
# TRAFFIC OBSERVATIONS
# ──────────────────────────────────────────────
TRAFFIC_COLS = {
    "timestamp": "timestamp",
    "segment_id": "segment_id",
    "source_node": "source_node",
    "target_node": "target_node",
    "speed_kmh": "speed_kmh",
    "flow_vph": "flow_vph",
    "occupancy_pct": "occupancy_pct",
    "travel_time_min": "travel_time_min",
    "free_flow_time_min": "free_flow_time_min",
    "delay_min": "delay_min",
    "queue_length_veh": "queue_length_veh",
    "congestion_index": "congestion_index",
    "sensor_quality": "sensor_quality",
}

# ──────────────────────────────────────────────
# NETWORK STATIC
# ──────────────────────────────────────────────
NETWORK_COLS = {
    "segment_id": "segment_id",
    "source_node": "source_node",
    "target_node": "target_node",
    "road_class": "road_class",
    "lanes": "lanes",
    "free_flow_speed_kmh": "free_flow_speed_kmh",
    "capacity_vph": "capacity_vph",
    "length_km": "length_km",
    "grade_pct": "grade_pct",
    "signal_id": "signal_id",
    "structural_bottleneck": "structural_bottleneck",
    "importance": "importance",
    "peak_capacity_factor": "peak_capacity_factor",
}

NODE_COLS = {
    "node_id": "node_id",
    "x": "x",
    "y": "y",
    "lat": "lat",
    "lon": "lon",
}

# ──────────────────────────────────────────────
# INCIDENTS
# ──────────────────────────────────────────────
INCIDENT_COLS = {
    "incident_id": "incident_id",
    "start_time": "start_time",
    "end_time": "end_time",
    "segment_id": "segment_id",
    "incident_type": "incident_type",
    "severity": "severity",
    "lanes_blocked": "lanes_blocked",
}

# ──────────────────────────────────────────────
# CONTEXT
# ──────────────────────────────────────────────
CONTEXT_COLS = {
    "timestamp": "timestamp",
    "temperature_c": "temperature_c",
    "rain_intensity": "rain_intensity",
    "event_level": "event_level",
    "event_id": "event_id",
    "holiday_flag": "holiday_flag",
    "day_of_week": "day_of_week",
    "hour": "hour",
}

# ──────────────────────────────────────────────
# ROADWORKS
# ──────────────────────────────────────────────
ROADWORK_COLS = {
    "work_id": "work_id",
    "segment_id": "segment_id",
    "start_time": "start_time",
    "end_time": "end_time",
    "closure_fraction": "closure_fraction",
    "work_type": "work_type",
}

# ──────────────────────────────────────────────
# PLANNING CANDIDATES
# ──────────────────────────────────────────────
PLANNING_COLS = {
    "candidate_id": "candidate_id",
    "target_segment": "target_segment",
    "intervention_type": "intervention_type",
    "capacity_delta_vph": "capacity_delta_vph",
    "cost_index": "cost_index",
    "feasibility_band": "feasibility_band",
}

# Congestion state thresholds
CONGESTION_STATES = {
    "normal": (0.0, 0.2),
    "low_risk": (0.2, 0.4),
    "moderate": (0.4, 0.6),
    "high": (0.6, 0.75),
    "severe": (0.75, 0.9),
    "incident": (0.9, 1.01),
}

CONGESTION_COLORS = {
    "normal": "#22c55e",
    "low_risk": "#84cc16",
    "moderate": "#eab308",
    "high": "#f97316",
    "severe": "#ef4444",
    "incident": "#8b5cf6",
}

def get_congestion_state(score: float) -> str:
    for state, (lo, hi) in CONGESTION_STATES.items():
        if lo <= score < hi:
            return state
    return "severe"


def adapt_columns(df: pd.DataFrame, col_map: Dict[str, str]) -> pd.DataFrame:
    """Rename columns using the schema adapter map (reverse-lookup if needed)."""
    rename = {}
    existing = set(df.columns)
    for standard, actual in col_map.items():
        if actual in existing and actual != standard:
            rename[actual] = standard
        # Try lowercase fallback
        elif actual.lower() in existing:
            rename[actual.lower()] = standard
    if rename:
        df = df.rename(columns=rename)
    return df


def verify_interval(timestamps: pd.Series) -> int:
    """Verify actual time interval in minutes from timestamp series."""
    ts = pd.to_datetime(timestamps).sort_values().drop_duplicates()
    if len(ts) < 2:
        return 5  # default
    diffs = ts.diff().dropna().dt.total_seconds() / 60
    mode_interval = int(diffs.mode().iloc[0])
    return mode_interval
