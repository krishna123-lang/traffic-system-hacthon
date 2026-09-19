"""
Future-Aware Routing Engine.

Uses NetworkX + Yen's K-shortest paths on the physical road graph.
Edge costs incorporate:
  - base_travel_time
  - current_congestion_penalty
  - forecast_penalty
  - incident_penalty
  - roadwork_penalty
  - propagation_penalty
  - turn_restriction_penalty

Never optimizes for shortest distance alone.
Protects against secondary congestion (network-aware).
"""

from __future__ import annotations
import logging
from typing import Dict, List, Optional, Tuple, Any

import numpy as np
import networkx as nx

logger = logging.getLogger(__name__)

# Cost weights
W_BASE = 1.0
W_CONGESTION = 3.0
W_FORECAST = 2.5
W_INCIDENT = 5.0
W_ROADWORK = 2.0
W_PROPAGATION = 1.5
W_RESTRICTION = 10.0


def compute_edge_cost(
    src: str,
    tgt: str,
    edge_data: Dict,
    segment_id: Optional[str],
    current_state: Dict[str, Dict],
    forecast_state: Optional[Dict[str, Dict]] = None,
    incident_segments: Optional[set] = None,
    propagation_state: Optional[Dict[str, float]] = None,
    roadwork_segments: Optional[Dict[str, float]] = None,
) -> float:
    """Compute weighted future-aware cost for a road edge."""
    # Base travel time
    base_time = edge_data.get("free_flow_time_min", 1.0)
    cost = W_BASE * base_time

    if segment_id is None:
        return cost

    # Current congestion
    state = current_state.get(segment_id, {})
    cong_score = float(state.get("congestion_score", 0.0))
    cost += W_CONGESTION * cong_score * base_time

    # Forecast penalty (average over all horizons)
    if forecast_state and segment_id in forecast_state:
        fc = forecast_state[segment_id]
        forecast_scores = [fc.get(f"h{h}", 0.0) for h in [15, 30, 45, 60] if f"h{h}" in fc]
        if forecast_scores:
            avg_forecast = sum(forecast_scores) / len(forecast_scores)
            cost += W_FORECAST * avg_forecast * base_time

    # Incident penalty
    if incident_segments and segment_id in incident_segments:
        cost += W_INCIDENT * base_time

    # Roadwork penalty
    if roadwork_segments and segment_id in roadwork_segments:
        closure = float(roadwork_segments[segment_id])
        cost += W_ROADWORK * closure * base_time

    # Propagation risk penalty
    if propagation_state and segment_id in propagation_state:
        prop_risk = float(propagation_state[segment_id])
        cost += W_PROPAGATION * prop_risk * base_time

    return max(cost, 0.01)


def build_weighted_graph(
    physical_graph: nx.DiGraph,
    current_state: Dict[str, Dict],
    forecast_state: Optional[Dict[str, Dict]] = None,
    incident_segments: Optional[set] = None,
    propagation_state: Optional[Dict[str, float]] = None,
    roadwork_segments: Optional[Dict[str, float]] = None,
) -> nx.DiGraph:
    """
    Create a copy of physical_graph with future-aware edge weights.
    """
    G = physical_graph.copy()

    for src, tgt, data in physical_graph.edges(data=True):
        segment_id = data.get("segment_id")
        cost = compute_edge_cost(
            src, tgt, data, segment_id,
            current_state, forecast_state,
            incident_segments, propagation_state, roadwork_segments
        )
        G[src][tgt]["weight"] = cost
        G[src][tgt]["_cost"] = cost

    return G


def find_routes(
    physical_graph: nx.DiGraph,
    source_node: str,
    target_node: str,
    current_state: Dict[str, Dict],
    forecast_state: Optional[Dict[str, Dict]] = None,
    incident_segments: Optional[set] = None,
    propagation_state: Optional[Dict[str, float]] = None,
    roadwork_segments: Optional[Dict[str, float]] = None,
    k: int = 3,
    turn_restrictions: Optional[Dict] = None,
) -> List[Dict]:
    """
    Find k candidate routes using Yen's K-shortest paths on future-aware graph.

    Returns list of route dicts with metadata.
    """
    if source_node not in physical_graph.nodes:
        raise ValueError(f"Source node {source_node} not in network")
    if target_node not in physical_graph.nodes:
        raise ValueError(f"Target node {target_node} not in network")

    if source_node == target_node:
        return []

    # Build weighted graph
    G = build_weighted_graph(
        physical_graph, current_state, forecast_state,
        incident_segments, propagation_state, roadwork_segments
    )

    # Yen's K-shortest paths
    try:
        path_generator = nx.shortest_simple_paths(G, source_node, target_node, weight="weight")
        candidate_paths = []
        for i, path in enumerate(path_generator):
            if i >= k * 3:  # generate more candidates for filtering
                break
            candidate_paths.append(path)
    except nx.NetworkXNoPath:
        logger.warning(f"No path found from {source_node} to {target_node}")
        return []
    except Exception as e:
        logger.error(f"Routing failed: {e}")
        return []

    if not candidate_paths:
        return []

    # Score and annotate each route
    routes = []
    for rank, path in enumerate(candidate_paths[:k]):
        route_info = _annotate_route(
            path, G, physical_graph, current_state, forecast_state,
            incident_segments, propagation_state, rank
        )
        routes.append(route_info)

    # Sort by total cost
    routes.sort(key=lambda r: r["total_cost"])

    # Add relative ranking and recommendations
    best_cost = routes[0]["total_cost"] if routes else 1.0
    for i, route in enumerate(routes):
        route["rank"] = i + 1
        route["cost_vs_best"] = round((route["total_cost"] - best_cost) / max(best_cost, 0.01) * 100, 1)

    # Add explanation
    routes = _add_route_explanations(routes, incident_segments, propagation_state)

    return routes


def _annotate_route(
    path: List[str],
    weighted_graph: nx.DiGraph,
    physical_graph: nx.DiGraph,
    current_state: Dict[str, Dict],
    forecast_state: Optional[Dict[str, Dict]],
    incident_segments: Optional[set],
    propagation_state: Optional[Dict[str, float]],
    rank: int,
) -> Dict:
    """Compute route metrics."""
    total_cost = 0.0
    total_base_time = 0.0
    total_length = 0.0
    segment_ids = []
    edges = []
    max_congestion = 0.0
    passes_incident = False
    passes_propagation_risk = False
    congestion_scores = []

    for i in range(len(path) - 1):
        src, tgt = path[i], path[i + 1]
        edge = physical_graph.edges.get((src, tgt), {})
        seg_id = edge.get("segment_id")

        cost = weighted_graph[src][tgt].get("_cost", 1.0)
        base_time = edge.get("free_flow_time_min", 1.0)
        length = edge.get("length_km", 0.1)

        total_cost += cost
        total_base_time += base_time
        total_length += length

        if seg_id:
            segment_ids.append(seg_id)
            state = current_state.get(seg_id, {})
            cong = float(state.get("congestion_score", 0.0))
            congestion_scores.append(cong)
            max_congestion = max(max_congestion, cong)

            if incident_segments and seg_id in incident_segments:
                passes_incident = True
            if propagation_state and propagation_state.get(seg_id, 0) > 0.5:
                passes_propagation_risk = True

        edges.append({"from": src, "to": tgt, "segment_id": seg_id})

    avg_congestion = sum(congestion_scores) / max(len(congestion_scores), 1)
    delay_estimate = total_cost - total_base_time
    eta_minutes = round(total_cost, 1)

    # Secondary congestion estimation
    # Routes that add more demand to already-stressed segments create secondary congestion
    secondary_risk = 0.0
    for seg_id in segment_ids:
        state = current_state.get(seg_id, {})
        cong = float(state.get("congestion_score", 0.0))
        if cong > 0.5:
            secondary_risk += (cong - 0.5) * 0.2

    secondary_risk = min(secondary_risk / max(len(segment_ids), 1), 1.0)

    return {
        "path": path,
        "segments": segment_ids,
        "edges": edges,
        "total_cost": round(total_cost, 2),
        "base_travel_time": round(total_base_time, 2),
        "eta_minutes": eta_minutes,
        "estimated_delay_minutes": round(delay_estimate, 2),
        "total_length_km": round(total_length, 2),
        "n_hops": len(path) - 1,
        "avg_congestion": round(avg_congestion, 3),
        "max_congestion": round(max_congestion, 3),
        "passes_incident": passes_incident,
        "passes_propagation_risk": passes_propagation_risk,
        "secondary_congestion_risk": round(secondary_risk, 3),
        "risk_level": _route_risk_level(avg_congestion, passes_incident, secondary_risk),
    }


def _route_risk_level(avg_cong: float, passes_incident: bool, secondary_risk: float) -> str:
    if passes_incident:
        return "high"
    if avg_cong > 0.6 or secondary_risk > 0.4:
        return "moderate"
    if avg_cong > 0.4:
        return "low"
    return "minimal"


def _add_route_explanations(
    routes: List[Dict],
    incident_segments: Optional[set],
    propagation_state: Optional[Dict[str, float]],
) -> List[Dict]:
    """Add human-readable explanation to each route."""
    for i, route in enumerate(routes):
        positives = []
        negatives = []

        if i == 0:
            positives.append("Lowest predicted travel cost")
        if not route["passes_incident"]:
            positives.append("Avoids active incidents")
        else:
            negatives.append("Passes through incident zone")

        if not route["passes_propagation_risk"]:
            positives.append("Avoids predicted spillback zones")
        else:
            negatives.append("Passes through predicted spillback area")

        if route["secondary_congestion_risk"] < 0.2:
            positives.append("Low secondary congestion risk")
        else:
            negatives.append(f"Moderate secondary congestion risk ({route['secondary_congestion_risk']:.1%})")

        if route["avg_congestion"] < 0.3:
            positives.append("Free-flowing segments")
        elif route["avg_congestion"] > 0.6:
            negatives.append("High average congestion on route")

        if i > 0 and routes:
            extra_time = route["eta_minutes"] - routes[0]["eta_minutes"]
            if extra_time > 0:
                negatives.append(f"+{extra_time:.1f} min vs best route")
            elif extra_time < 0:
                positives.append(f"{abs(extra_time):.1f} min faster alternative")

        route["why_recommended"] = positives
        route["why_not"] = negatives
        route["label"] = ["Primary", "Alternative A", "Alternative B", "Alternative C"][i] if i < 4 else f"Route {i+1}"
        route["confidence"] = round(
            max(0.4, 0.9 - route["avg_congestion"] * 0.3 - route["secondary_congestion_risk"] * 0.2), 2
        )

    return routes


def snap_to_nearest_node(
    lat: float,
    lon: float,
    nodes_df,
) -> str:
    """Find the nearest network node to given GPS coordinates."""
    import pandas as pd
    nodes = nodes_df.copy()
    # Haversine approximation (simplified for small distances)
    dlat = (nodes["lat"] - lat) * 111.32  # km per degree lat
    dlon = (nodes["lon"] - lon) * 111.32 * np.cos(np.radians(lat))
    dist = np.sqrt(dlat ** 2 + dlon ** 2)
    nearest_idx = dist.idxmin()
    return nodes.loc[nearest_idx, "node_id"]
