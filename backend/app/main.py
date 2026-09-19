"""
FlowGuard AI — FastAPI Main Application
"""

from __future__ import annotations
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Ensure project root is on path
ROOT = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(ROOT))

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from datetime import datetime, timezone
import numpy as np
import pandas as pd
from typing import Optional, List, Dict, Any

from backend.app.config import settings
from backend.app.services.state import app_state
from backend.app.schemas.responses import (
    HealthResponse, SimulationStatus, NetworkResponse, NetworkStateResponse,
    SegmentState, SegmentForecast, HorizonForecast, PropagationResponse,
    PropagationNeighbor, RouteRequest, RouteResponse, TripSimulateRequest,
    TripSimulateResponse, BottlenecksResponse, Bottleneck,
    InterventionRequest, InterventionResponse, ModelMetricsResponse,
    ForecastBatchRequest, ForecastBatchResponse, Alert, Incident,
    DemoScenario, DemoStartRequest, NodeInfo, SegmentInfo
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load all models and data on startup."""
    logger.info("FlowGuard AI starting up...")
    try:
        app_state.load()
        logger.info("FlowGuard AI ready.")
    except Exception as e:
        logger.error(f"Startup error: {e}")
    yield
    logger.info("FlowGuard AI shutting down.")


app = FastAPI(
    title="FlowGuard AI",
    description="Urban Traffic Flow & Incident Intelligence Platform — SIMULATION MODE",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list + ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _now_str() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sim_ts(ts: Optional[str] = None) -> str:
    return ts or app_state.current_snapshot_ts or _now_str()


# ──────────────────────────────────────────────
# HEALTH
# ──────────────────────────────────────────────

@app.get("/api/health", response_model=HealthResponse, tags=["System"])
async def health():
    return HealthResponse(status="ok", timestamp=_now_str())


@app.get("/api/simulation/status", response_model=SimulationStatus, tags=["System"])
async def simulation_status():
    return SimulationStatus(
        timestamp=_sim_ts(),
        network_loaded=app_state.network_df is not None,
        models_loaded=bool(app_state.forecast_models or app_state.incident_model_payload),
        graph_loaded=app_state.physical_graph is not None,
    )


# ──────────────────────────────────────────────
# NETWORK
# ──────────────────────────────────────────────

@app.get("/api/network", tags=["Network"])
async def get_network():
    """Return nodes and segments for map rendering."""
    if app_state.nodes_df is None:
        raise HTTPException(status_code=503, detail="Network not loaded")

    nodes = []
    for _, row in app_state.nodes_df.iterrows():
        has_signal = False
        if app_state.signal_plans_df is not None:
            has_signal = row["node_id"] in app_state.signal_plans_df["node_id"].values
        restrictions = []
        if app_state.turn_restrictions_df is not None:
            r = app_state.turn_restrictions_df[app_state.turn_restrictions_df["node_id"] == row["node_id"]]
            restrictions = r.to_dict("records")
        nodes.append({
            "node_id": row["node_id"],
            "lat": float(row["lat"]),
            "lon": float(row["lon"]),
            "x": int(row["x"]),
            "y": int(row["y"]),
            "has_signal": has_signal,
            "restrictions": restrictions,
        })

    segments = []
    if app_state.network_df is not None:
        for _, row in app_state.network_df.iterrows():
            seg_id = row["segment_id"]
            state = app_state.current_state.get(seg_id, {})
            segments.append({
                "segment_id": seg_id,
                "source_node": row["source_node"],
                "target_node": row["target_node"],
                "road_class": row["road_class"],
                "lanes": int(row["lanes"]),
                "free_flow_speed_kmh": float(row["free_flow_speed_kmh"]),
                "capacity_vph": float(row["capacity_vph"]),
                "length_km": float(row["length_km"]),
                "structural_bottleneck": bool(row["structural_bottleneck"]),
                "importance": float(row["importance"]),
                "congestion_score": round(state.get("congestion_score", 0.0), 3),
                "congestion_state": state.get("congestion_state", "normal"),
                "speed_kmh": round(state.get("speed_kmh", float(row["free_flow_speed_kmh"])), 1),
                "flow_vph": round(state.get("flow_vph", 0.0), 1),
                "delay_min": round(state.get("delay_min", 0.0), 2),
                "incident_active": state.get("incident_active", False),
            })

    return {
        "nodes": nodes,
        "segments": segments,
        "n_nodes": len(nodes),
        "n_segments": len(segments),
        "meta": {
            "lat_center": 17.38,
            "lon_center": 78.45,
            "coordinate_system": "WGS84 (real Hyderabad-area coordinates)",
            "note": "Synthetic network with real geographic coordinates",
        }
    }


# ──────────────────────────────────────────────
# TRAFFIC STATE
# ──────────────────────────────────────────────

@app.get("/api/state", tags=["Traffic"])
async def get_state(timestamp: Optional[str] = Query(None)):
    """Current traffic state for all segments."""
    if timestamp:
        state = app_state.get_state_at_timestamp(timestamp)
    else:
        state = app_state.current_state

    segments = []
    for seg_id, s in state.items():
        cong = s.get("congestion_score", 0.0)
        segments.append({
            "segment_id": seg_id,
            "congestion_score": round(cong, 3),
            "congestion_state": s.get("congestion_state", "normal"),
            "speed_kmh": round(s.get("speed_kmh", 0), 1),
            "flow_vph": round(s.get("flow_vph", 0), 1),
            "occupancy_pct": round(s.get("occupancy_pct", 0), 1),
            "delay_min": round(s.get("delay_min", 0), 2),
            "queue_length_veh": round(s.get("queue_length_veh", 0), 1),
            "incident_active": bool(s.get("incident_active", False)),
            "incident_probability": round(float(s.get("incident_probability", 0.0)), 3),
            "timestamp": timestamp or app_state.current_snapshot_ts,
        })

    scores = [s["congestion_score"] for s in segments]
    return {
        "timestamp": timestamp or app_state.current_snapshot_ts or _now_str(),
        "simulation_mode": True,
        "segments": segments,
        "summary": {
            "avg_congestion": round(np.mean(scores) if scores else 0.0, 3),
            "severe_segments": sum(1 for s in scores if s >= 0.75),
            "high_segments": sum(1 for s in scores if s >= 0.6),
            "normal_segments": sum(1 for s in scores if s < 0.2),
            "network_health": round(1 - np.mean(scores) if scores else 1.0, 3),
            "total_segments": len(segments),
        }
    }


# ──────────────────────────────────────────────
# ALERTS
# ──────────────────────────────────────────────

@app.get("/api/alerts", tags=["Alerts"])
async def get_alerts(timestamp: Optional[str] = Query(None), limit: int = Query(20)):
    """Active alerts for current network state."""
    state = app_state.current_state
    alerts = []
    alert_id = 0

    for seg_id, s in state.items():
        cong = s.get("congestion_score", 0.0)
        inc = s.get("incident_active", False)

        if cong >= 0.9 or inc:
            alert_id += 1
            alerts.append({
                "alert_id": f"ALT_{alert_id:04d}",
                "segment_id": seg_id,
                "alert_type": "incident" if inc else "congestion",
                "severity": "critical" if cong >= 0.9 else "high",
                "title": f"{'Incident' if inc else 'Severe Congestion'} — {seg_id}",
                "description": f"Congestion score: {cong:.2f}. Speed: {s.get('speed_kmh', 0):.0f} km/h",
                "timestamp": timestamp or app_state.current_snapshot_ts or _now_str(),
                "confidence": 0.87,
                "evidence": [f"Speed dropped to {s.get('speed_kmh', 0):.0f} km/h",
                             f"Flow utilization: {s.get('flow_utilization', 0):.1%}"],
            })
        elif cong >= 0.6:
            alert_id += 1
            alerts.append({
                "alert_id": f"ALT_{alert_id:04d}",
                "segment_id": seg_id,
                "alert_type": "congestion",
                "severity": "high",
                "title": f"High Congestion — {seg_id}",
                "description": f"Congestion score: {cong:.2f}",
                "timestamp": timestamp or _now_str(),
                "confidence": 0.75,
                "evidence": [f"Congestion score: {cong:.2f}"],
            })

    # Sort by severity
    severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    alerts.sort(key=lambda a: severity_order.get(a["severity"], 99))

    return {"alerts": alerts[:limit], "total": len(alerts), "timestamp": timestamp or _now_str()}


# ──────────────────────────────────────────────
# INCIDENTS
# ──────────────────────────────────────────────

@app.get("/api/incidents", tags=["Incidents"])
async def get_incidents(timestamp: Optional[str] = Query(None)):
    """Active and historical incidents."""
    incidents = []
    if app_state.incidents_df is not None:
        for _, row in app_state.incidents_df.iterrows():
            incidents.append({
                "incident_id": row["incident_id"],
                "segment_id": row["segment_id"],
                "incident_type": row["incident_type"],
                "severity": int(row["severity"]),
                "start_time": str(row["start_time"]),
                "end_time": str(row.get("end_time", "")),
                "lanes_blocked": int(row.get("lanes_blocked", 0)),
                "probability": 1.0,
                "confidence": 0.95,
                "evidence": [
                    f"Type: {row['incident_type']}",
                    f"Severity: {row['severity']}/3",
                    f"Lanes blocked: {row.get('lanes_blocked', 0)}",
                ],
                "affected_neighbors": [],
            })

    return {"incidents": incidents, "total": len(incidents), "timestamp": timestamp or _now_str()}


# ──────────────────────────────────────────────
# FORECASTING
# ──────────────────────────────────────────────

@app.get("/api/forecast/{segment_id}", tags=["Forecasting"])
async def get_forecast(segment_id: str, timestamp: Optional[str] = Query(None)):
    """Multi-horizon forecast for a specific segment."""
    if segment_id not in app_state.current_state:
        raise HTTPException(status_code=404, detail=f"Segment {segment_id} not found")

    state = app_state.current_state.get(segment_id, {})
    current_cong = state.get("congestion_score", 0.0)

    horizons = []
    for h in [15, 30, 45, 60]:
        if h in app_state.forecast_models:
            try:
                model = app_state.forecast_models[h]
                # Build feature row for this segment
                feat_row = pd.DataFrame([{
                    **state,
                    "segment_id": segment_id,
                    "timestamp": pd.Timestamp(timestamp or app_state.current_snapshot_ts),
                    "hour": pd.Timestamp(timestamp or app_state.current_snapshot_ts).hour if timestamp or app_state.current_snapshot_ts else 12,
                    "is_peak": False,
                    "is_weekend": False,
                    "day_of_week": 0,
                }])
                pred = float(model.predict(feat_row)[0])
            except Exception as e:
                logger.debug(f"Forecast inference failed: {e}, using trend")
                pred = current_cong * (1 + 0.05 * (h / 15))
        else:
            # Simple trend estimate
            pred = current_cong * (1 + 0.03 * (h / 15))

        pred = max(0.0, min(pred, 1.0))
        uncertainty = 0.05 + 0.01 * (h / 15)
        horizons.append({
            "horizon_minutes": h,
            "predicted_value": round(pred, 3),
            "lower_bound": round(max(0, pred - uncertainty * 2), 3),
            "upper_bound": round(min(1, pred + uncertainty * 2), 3),
            "congestion_state": _cong_label(pred),
            "confidence": round(max(0.5, 0.92 - 0.04 * (h / 15)), 2),
        })

    return {
        "segment_id": segment_id,
        "timestamp": timestamp or app_state.current_snapshot_ts or _now_str(),
        "target_variable": "congestion_score",
        "current_value": round(current_cong, 3),
        "current_state": state.get("congestion_state", "normal"),
        "horizons": horizons,
        "model_used": app_state.best_forecast_model_names.get(15, "trend_estimate"),
    }


@app.post("/api/forecast/batch", tags=["Forecasting"])
async def forecast_batch(request: ForecastBatchRequest):
    """Batch forecast for multiple segments."""
    result = {}
    for seg_id in request.segment_ids:
        if seg_id not in app_state.current_state:
            continue
        state = app_state.current_state.get(seg_id, {})
        current = state.get("congestion_score", 0.0)
        horizons = []
        for h in [15, 30, 45, 60]:
            pred = current * (1 + 0.03 * h / 15)
            pred = max(0, min(pred, 1))
            horizons.append({
                "horizon_minutes": h,
                "predicted_value": round(pred, 3),
                "congestion_state": _cong_label(pred),
                "confidence": round(max(0.5, 0.92 - 0.04 * h / 15), 2),
            })
        result[seg_id] = horizons

    return {
        "timestamp": request.timestamp or app_state.current_snapshot_ts or _now_str(),
        "forecasts": result,
    }


# ──────────────────────────────────────────────
# PROPAGATION
# ──────────────────────────────────────────────

@app.get("/api/propagation/{segment_id}", tags=["Propagation"])
async def get_propagation(segment_id: str, timestamp: Optional[str] = Query(None)):
    """Spillback propagation risk for neighbors of segment."""
    if app_state.seg_graph is None:
        raise HTTPException(status_code=503, detail="Segment graph not loaded")
    if not app_state.seg_graph.has_node(segment_id):
        raise HTTPException(status_code=404, detail=f"Segment {segment_id} not in segment graph")

    from ml.propagation.engine import compute_propagation_risk

    state = app_state.current_state.get(segment_id, {})
    incident_segs = {seg_id} if state.get("incident_active", False) else set()

    prop = compute_propagation_risk(
        segment_id,
        app_state.seg_graph,
        app_state.current_state,
        incident_segments=incident_segs,
        max_hops=settings.max_propagation_hops,
    )

    neighbors = [
        {
            "segment_id": nbr,
            "hop": info["hop"],
            "risk": info["risk"],
            "risk_level": info["risk_level"],
            "horizon_risks": {str(k): v for k, v in info["horizon_risks"].items()},
            "reason": info["reason"],
            "current_congestion": info["current_congestion"],
            "congestion_state": info["congestion_state"],
        }
        for nbr, info in sorted(prop.items(), key=lambda x: x[1]["risk"], reverse=True)
    ]

    return {
        "source_segment": segment_id,
        "source_congestion": round(state.get("congestion_score", 0.0), 3),
        "source_state": state.get("congestion_state", "normal"),
        "neighbors": neighbors,
        "timestamp": timestamp or app_state.current_snapshot_ts or _now_str(),
    }


# ──────────────────────────────────────────────
# ROUTING
# ──────────────────────────────────────────────

@app.post("/api/routes", tags=["Routing"])
async def find_routes(request: RouteRequest):
    """Future-aware route finding between nodes."""
    if app_state.physical_graph is None:
        raise HTTPException(status_code=503, detail="Physical graph not loaded")

    from ml.interventions.routing import find_routes as _find_routes

    incident_segs = set()
    for seg_id, s in app_state.current_state.items():
        if s.get("incident_active", False) or s.get("congestion_score", 0) >= 0.9:
            incident_segs.add(seg_id)

    try:
        routes = _find_routes(
            app_state.physical_graph,
            request.source_node,
            request.target_node,
            app_state.current_state,
            incident_segments=incident_segs,
            k=settings.k_shortest_paths,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Routing error: {str(e)}")

    return {
        "source_node": request.source_node,
        "target_node": request.target_node,
        "routes": routes,
        "timestamp": request.timestamp or _now_str(),
        "simulation_note": "SIMULATION / ADVISORY — not live navigation",
    }


@app.post("/api/trips/simulate", tags=["Routing"])
async def simulate_trip(request: TripSimulateRequest):
    """Simulate a vehicle trip from source to destination."""
    if app_state.physical_graph is None:
        raise HTTPException(status_code=503, detail="Physical graph not loaded")

    from ml.interventions.routing import find_routes as _find_routes
    import uuid

    try:
        routes = _find_routes(
            app_state.physical_graph,
            request.source_node,
            request.target_node,
            app_state.current_state,
            k=1,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not routes:
        raise HTTPException(status_code=404, detail="No route found")

    best_route = routes[0]

    # Build waypoints from path nodes
    waypoints = []
    for node_id in best_route["path"]:
        node_row = app_state.nodes_df[app_state.nodes_df["node_id"] == node_id] if app_state.nodes_df is not None else None
        if node_row is not None and not node_row.empty:
            waypoints.append({
                "node_id": node_id,
                "lat": float(node_row["lat"].iloc[0]),
                "lon": float(node_row["lon"].iloc[0]),
            })

    return {
        "trip_id": str(uuid.uuid4())[:8],
        "source_node": request.source_node,
        "target_node": request.target_node,
        "vehicle_type": request.vehicle_type,
        "route": best_route,
        "waypoints": waypoints,
        "estimated_duration_minutes": best_route.get("eta_minutes", 0),
        "estimated_distance_km": best_route.get("total_length_km", 0),
    }


# ──────────────────────────────────────────────
# BOTTLENECKS
# ──────────────────────────────────────────────

@app.get("/api/bottlenecks", tags=["Analytics"])
async def get_bottlenecks():
    """Recurring bottleneck analysis."""
    from ml.interventions.simulator import identify_recurring_bottlenecks

    bottlenecks = []
    if app_state.current_state and app_state.network_df is not None:
        # Use current state as proxy (real training data used at train time)
        state_df = pd.DataFrame([
            {"segment_id": k, **v}
            for k, v in app_state.current_state.items()
        ])
        if "congestion_score" in state_df.columns:
            state_df["timestamp"] = app_state.current_snapshot_ts or _now_str()
            bn = identify_recurring_bottlenecks(
                state_df, app_state.network_df,
                seg_centrality=app_state.seg_centrality,
            )
            for rank, b in enumerate(bn, 1):
                seg_id = b["segment_id"]
                # Find matching planning candidates
                candidates = []
                if app_state.planning_df is not None:
                    c = app_state.planning_df[app_state.planning_df["target_segment"] == seg_id]
                    candidates = c.to_dict("records")

                bottlenecks.append({
                    "rank": rank,
                    **b,
                    "candidate_interventions": candidates,
                })

    return {"bottlenecks": bottlenecks, "timestamp": _now_str()}


# ──────────────────────────────────────────────
# INTERVENTIONS
# ──────────────────────────────────────────────

@app.post("/api/interventions/simulate", tags=["Planning"])
async def simulate_intervention(request: InterventionRequest):
    """Simulate a planning intervention and show before/after impact."""
    if app_state.planning_df is None:
        raise HTTPException(status_code=503, detail="Planning candidates not loaded")

    candidate_row = app_state.planning_df[
        app_state.planning_df["candidate_id"] == request.candidate_id
    ]
    if candidate_row.empty:
        raise HTTPException(status_code=404, detail=f"Candidate {request.candidate_id} not found")

    candidate = candidate_row.iloc[0].to_dict()
    if request.segment_id:
        candidate["target_segment"] = request.segment_id

    from ml.interventions.simulator import simulate_intervention as _simulate

    result = _simulate(
        candidate,
        app_state.physical_graph,
        app_state.seg_graph,
        app_state.current_state,
        app_state.network_df,
    )
    return result


# ──────────────────────────────────────────────
# METRICS
# ──────────────────────────────────────────────

@app.get("/api/metrics", tags=["Evaluation"])
async def get_metrics():
    """Model performance metrics."""
    return {
        "forecast_metrics": app_state.forecast_metrics,
        "incident_metrics": app_state.incident_metrics,
        "robustness": {},  # populated by evaluate_models.py
        "timestamp": _now_str(),
    }


# ──────────────────────────────────────────────
# DATA HEALTH
# ──────────────────────────────────────────────

@app.get("/api/data-health", tags=["System"])
async def get_data_health():
    """Dataset quality report."""
    if not app_state.data_health:
        return {
            "status": "no_report",
            "message": "Run scripts/validate_data.py to generate health report",
            "timestamp": _now_str(),
        }
    return {**app_state.data_health, "timestamp": _now_str()}


# ──────────────────────────────────────────────
# DEMO
# ──────────────────────────────────────────────

@app.get("/api/demo/scenarios", tags=["Demo"])
async def get_demo_scenarios():
    """List available demo scenarios."""
    import json
    from pathlib import Path
    idx_path = Path(ROOT) / "artifacts" / "scenario_index.json"
    if idx_path.exists():
        return json.loads(idx_path.read_text())

    # Fallback
    return {
        "scenarios": [
            {
                "scenario_id": "DEMO_MORNING_PEAK_INCIDENT",
                "name": "Morning Peak + Incident",
                "description": "Stalled vehicle on R0067 → congestion → spillback",
                "type": "incident",
                "total_steps": 30,
                "incident_segment": "R0067",
            }
        ]
    }


@app.get("/api/demo/scenarios/{scenario_id}/state", tags=["Demo"])
async def get_demo_state(
    scenario_id: str,
    step: Optional[int] = Query(None),
    timestamp: Optional[str] = Query(None),
):
    """Get deterministic demo scenario state at a given step or timestamp."""
    if app_state.demo_scenario is None:
        # Return current state as fallback
        return {
            "scenario_id": scenario_id,
            "step": 0,
            "timestamp": _now_str(),
            "incident_active": False,
            "summary": {"avg_congestion": 0.3, "severe_segments": 0},
            "segment_states": {
                seg: {"congestion_score": s.get("congestion_score", 0),
                      "congestion_state": s.get("congestion_state", "normal"),
                      "speed_kmh": s.get("speed_kmh", 40)}
                for seg, s in list(app_state.current_state.items())[:100]
            },
        }

    steps = app_state.demo_scenario.get("steps", [])
    if not steps:
        raise HTTPException(status_code=404, detail="No steps in scenario")

    if step is not None:
        step_data = steps[min(step, len(steps) - 1)]
    elif timestamp:
        # Find closest step by timestamp
        step_data = min(steps, key=lambda s: abs(
            pd.Timestamp(s["timestamp"]) - pd.Timestamp(timestamp)
        ))
    else:
        step_data = steps[0]

    return {
        "scenario_id": scenario_id,
        **step_data,
    }


# ──────────────────────────────────────────────
# PLANNING CANDIDATES
# ──────────────────────────────────────────────

@app.get("/api/planning/candidates", tags=["Planning"])
async def get_planning_candidates():
    """Return all planning intervention candidates."""
    if app_state.planning_df is None:
        return {"candidates": [], "total": 0}
    candidates = app_state.planning_df.to_dict("records")
    return {"candidates": candidates, "total": len(candidates)}


# ──────────────────────────────────────────────
# SEGMENT DETAIL
# ──────────────────────────────────────────────

@app.get("/api/segments/{segment_id}", tags=["Traffic"])
async def get_segment_detail(segment_id: str, timestamp: Optional[str] = Query(None)):
    """Full detail for a single segment: state + forecast + propagation."""
    if segment_id not in app_state.current_state and (
        app_state.network_df is None or
        segment_id not in app_state.network_df["segment_id"].values
    ):
        raise HTTPException(status_code=404, detail=f"Segment {segment_id} not found")

    state = app_state.current_state.get(segment_id, {})

    # Network attributes
    net_info = {}
    if app_state.network_df is not None:
        row = app_state.network_df[app_state.network_df["segment_id"] == segment_id]
        if not row.empty:
            net_info = row.iloc[0].to_dict()

    # Incident probability from model
    inc_prob = 0.0
    if app_state.incident_model_payload:
        from ml.incidents.detector import predict_incident
        res = predict_incident(state, app_state.incident_model_payload)
        inc_prob = res.get("incident_probability", 0.0)

    # Forecast
    horizons = []
    for h in [15, 30, 45, 60]:
        current = state.get("congestion_score", 0.0)
        pred = current * (1 + 0.03 * h / 15) if h not in app_state.forecast_models else current
        if h in app_state.forecast_models:
            try:
                model = app_state.forecast_models[h]
                feat = pd.DataFrame([{**state, "segment_id": segment_id, "timestamp": pd.Timestamp.now(), "hour": 9, "is_peak": True}])
                pred = float(model.predict(feat)[0])
            except Exception:
                pass
        pred = max(0, min(pred, 1))
        horizons.append({"horizon_minutes": h, "predicted_value": round(pred, 3), "congestion_state": _cong_label(pred)})

    return {
        "segment_id": segment_id,
        "timestamp": timestamp or app_state.current_snapshot_ts or _now_str(),
        "network": {k: (float(v) if hasattr(v, "item") else v) for k, v in net_info.items()},
        "current_state": state,
        "incident_probability": round(inc_prob, 3),
        "forecast": horizons,
        "is_structural_bottleneck": bool(net_info.get("structural_bottleneck", False)),
    }


# ──────────────────────────────────────────────
# SNAP TO NODE
# ──────────────────────────────────────────────

@app.get("/api/snap-to-node", tags=["Routing"])
async def snap_to_node(lat: float, lon: float):
    """Snap geographic coordinates to nearest network node."""
    if app_state.nodes_df is None:
        raise HTTPException(status_code=503, detail="Nodes not loaded")
    from ml.interventions.routing import snap_to_nearest_node
    node_id = snap_to_nearest_node(lat, lon, app_state.nodes_df)
    node_row = app_state.nodes_df[app_state.nodes_df["node_id"] == node_id].iloc[0]
    return {
        "node_id": node_id,
        "lat": float(node_row["lat"]),
        "lon": float(node_row["lon"]),
    }


# ──────────────────────────────────────────────
# HELPERS
# ──────────────────────────────────────────────

def _cong_label(score: float) -> str:
    if score >= 0.9: return "incident"
    elif score >= 0.75: return "severe"
    elif score >= 0.6: return "high"
    elif score >= 0.4: return "moderate"
    elif score >= 0.2: return "low_risk"
    return "normal"


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=settings.host, port=settings.port)
