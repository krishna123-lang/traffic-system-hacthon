"""
Propagation Engine.

When a segment is congested or incident-affected, calculates spillback risk
for neighboring segments using the segment line graph.

propagation_risk = adjacency_weight
                 × current_congestion
                 × predicted_future_stress
                 × dependency_strength
                 × incident_impact_factor
"""

from __future__ import annotations
import logging
from typing import Dict, List, Optional, Tuple, Any

import numpy as np
import networkx as nx

from ml.data.schema_adapter import get_congestion_state

logger = logging.getLogger(__name__)

MAX_HOPS = 3  # k-hop neighborhood for propagation


def compute_propagation_risk(
    segment_id: str,
    seg_graph: nx.DiGraph,
    current_state: Dict[str, Dict],   # segment_id → {congestion_score, speed_kmh, ...}
    forecast_state: Optional[Dict[str, Dict]] = None,  # segment_id → {h15, h30, ...}
    incident_segments: Optional[set] = None,
    max_hops: int = MAX_HOPS,
) -> Dict[str, Dict]:
    """
    Calculate propagation risk for all k-hop neighbors of segment_id.

    Returns:
        {neighbor_segment_id: {hop, risk, horizon_risks, reason}}
    """
    if not seg_graph.has_node(segment_id):
        return {}

    source_state = current_state.get(segment_id, {})
    source_congestion = float(source_state.get("congestion_score", 0.5))
    source_is_incident = incident_segments and segment_id in incident_segments
    incident_factor = 1.5 if source_is_incident else 1.0

    results = {}
    visited = {segment_id}
    current_level = {segment_id}

    for hop in range(1, max_hops + 1):
        next_level = set()

        for node in current_level:
            for neighbor in seg_graph.successors(node):
                if neighbor in visited:
                    continue
                visited.add(neighbor)
                next_level.add(neighbor)

                # Neighbor current state
                nbr_state = current_state.get(neighbor, {})
                nbr_congestion = float(nbr_state.get("congestion_score", 0.0))
                nbr_capacity_ratio = float(nbr_state.get("flow_utilization", 0.0))

                # Dependency strength: how connected is this neighbor to source
                try:
                    path_len = nx.shortest_path_length(seg_graph, segment_id, neighbor)
                    dependency = 1.0 / max(path_len, 1)
                except nx.NetworkXNoPath:
                    dependency = 0.0

                # Current congestion contribution
                congestion_contrib = (source_congestion + nbr_congestion) / 2.0

                # Forecast future stress
                future_stress = 0.0
                if forecast_state:
                    nbr_forecast = forecast_state.get(neighbor, {})
                    h15 = float(nbr_forecast.get("h15", nbr_congestion))
                    h30 = float(nbr_forecast.get("h30", nbr_congestion))
                    future_stress = (h15 * 0.6 + h30 * 0.4)

                # Decay by hop
                hop_decay = 1.0 / hop

                risk = (
                    hop_decay *
                    congestion_contrib *
                    (0.5 + 0.5 * dependency) *
                    incident_factor *
                    (1.0 + 0.3 * nbr_capacity_ratio)
                )

                if future_stress > 0:
                    risk = risk * (0.7 + 0.3 * future_stress)

                risk = min(risk, 1.0)

                horizon_risks = {}
                if hop == 1:
                    horizon_risks = {15: round(risk * 1.0, 3), 30: round(min(risk * 1.2, 1.0), 3)}
                elif hop == 2:
                    horizon_risks = {15: round(risk * 0.6, 3), 30: round(risk * 1.0, 3), 45: round(min(risk * 1.1, 1.0), 3)}
                else:
                    horizon_risks = {30: round(risk * 0.5, 3), 45: round(risk * 0.8, 3), 60: round(min(risk * 1.0, 1.0), 3)}

                # Determine reason
                reasons = []
                if source_congestion > 0.6:
                    reasons.append(f"source {segment_id} is severely congested")
                if source_is_incident:
                    reasons.append("active incident on source segment")
                if nbr_congestion > 0.5:
                    reasons.append("neighbor already showing stress")
                if hop == 1:
                    reasons.append("direct downstream connection")
                reason = "; ".join(reasons) if reasons else "network adjacency"

                results[neighbor] = {
                    "hop": hop,
                    "risk": round(risk, 3),
                    "risk_level": _risk_level(risk),
                    "horizon_risks": horizon_risks,
                    "reason": reason,
                    "current_congestion": round(nbr_congestion, 3),
                    "congestion_state": get_congestion_state(nbr_congestion),
                }

        current_level = next_level
        if not current_level:
            break

    return results


def _risk_level(risk: float) -> str:
    if risk >= 0.8:
        return "critical"
    elif risk >= 0.6:
        return "high"
    elif risk >= 0.4:
        return "moderate"
    elif risk >= 0.2:
        return "low"
    return "minimal"


def compute_network_propagation_summary(
    congested_segments: List[str],
    seg_graph: nx.DiGraph,
    current_state: Dict[str, Dict],
    forecast_state: Optional[Dict[str, Dict]] = None,
) -> List[Dict]:
    """
    Compute propagation for all congested/incident segments.
    Returns ranked list of at-risk segments.
    """
    risk_accumulator: Dict[str, float] = {}

    for seg in congested_segments:
        prop = compute_propagation_risk(
            seg, seg_graph, current_state, forecast_state
        )
        for nbr, info in prop.items():
            if nbr not in risk_accumulator or risk_accumulator[nbr] < info["risk"]:
                risk_accumulator[nbr] = info["risk"]

    # Sort by risk
    ranked = sorted(risk_accumulator.items(), key=lambda x: x[1], reverse=True)
    return [
        {"segment_id": seg, "propagation_risk": round(risk, 3), "risk_level": _risk_level(risk)}
        for seg, risk in ranked[:20]
    ]
