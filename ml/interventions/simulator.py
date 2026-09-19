"""
Counterfactual Intervention Simulator.

For each planning candidate, simulates the before/after network impact
using surrogate model (modify capacity/cost, recompute metrics).

Uses planning_candidates.csv intervention types:
  - lane_addition
  - capacity_upgrade
  - connector
  - turn_lane
  - signal_retiming

Output: before/after comparison of network KPIs.
"""

from __future__ import annotations
import logging
from typing import Dict, List, Optional, Tuple, Any

import numpy as np
import pandas as pd
import networkx as nx

logger = logging.getLogger(__name__)


def simulate_intervention(
    candidate: Dict,
    physical_graph: nx.DiGraph,
    seg_graph: nx.DiGraph,
    current_state: Dict[str, Dict],
    network_df: pd.DataFrame,
    all_segment_states: Optional[List[Dict]] = None,
) -> Dict[str, Any]:
    """
    Simulate the effect of a planning candidate intervention.

    Returns before/after network metrics as simulation estimate.
    """
    target_seg = candidate.get("target_segment")
    intervention_type = candidate.get("intervention_type", "capacity_upgrade")
    capacity_delta = float(candidate.get("capacity_delta_vph", 500))
    feasibility = candidate.get("feasibility_band", "medium")

    # ── BEFORE metrics ──────────────────────────────────
    before_metrics = _compute_network_metrics(current_state, physical_graph, network_df)

    # ── SIMULATE INTERVENTION ────────────────────────────
    simulated_state = _apply_intervention(
        target_seg, intervention_type, capacity_delta,
        current_state, network_df
    )

    # ── AFTER metrics ─────────────────────────────────────
    after_metrics = _compute_network_metrics(simulated_state, physical_graph, network_df)

    # ── COMPUTE CHANGES ──────────────────────────────────
    changes = {}
    for key in before_metrics:
        if isinstance(before_metrics[key], (int, float)):
            before_val = before_metrics[key]
            after_val = after_metrics.get(key, before_val)
            if before_val != 0:
                pct_change = (after_val - before_val) / abs(before_val) * 100
            else:
                pct_change = 0.0
            changes[key] = {
                "before": round(before_val, 3),
                "after": round(after_val, 3),
                "change_pct": round(pct_change, 1),
                "direction": "improved" if pct_change < 0 else "worsened" if pct_change > 0 else "unchanged",
            }

    # ── FEASIBILITY CONFIDENCE ─────────────────────────────
    confidence_map = {"low": 0.55, "medium": 0.70, "high": 0.85}
    confidence = confidence_map.get(feasibility, 0.65)

    return {
        "candidate_id": candidate.get("candidate_id"),
        "target_segment": target_seg,
        "intervention_type": intervention_type,
        "capacity_delta_vph": capacity_delta,
        "feasibility_band": feasibility,
        "before": before_metrics,
        "after": after_metrics,
        "changes": changes,
        "confidence": confidence,
        "disclaimer": "SIMULATION ESTIMATE — not a real-world guarantee. Results depend on model assumptions.",
        "key_benefits": _summarize_benefits(changes),
    }


def _apply_intervention(
    target_seg: str,
    intervention_type: str,
    capacity_delta: float,
    current_state: Dict[str, Dict],
    network_df: pd.DataFrame,
) -> Dict[str, Dict]:
    """
    Simulate state change after intervention.
    Returns modified current_state.
    """
    simulated = {seg: dict(state) for seg, state in current_state.items()}

    if target_seg not in simulated:
        return simulated

    state = simulated[target_seg]
    seg_row = network_df[network_df["segment_id"] == target_seg]

    if seg_row.empty:
        return simulated

    original_capacity = float(seg_row["capacity_vph"].iloc[0])
    current_flow = float(state.get("flow_vph", original_capacity * 0.5))
    new_capacity = original_capacity + capacity_delta

    # Apply intervention effects
    if intervention_type in ["lane_addition", "capacity_upgrade"]:
        new_flow_util = current_flow / max(new_capacity, 1.0)
        new_cong_score = state.get("congestion_score", 0.5) * (original_capacity / new_capacity)
        state["flow_utilization"] = min(new_flow_util, 1.0)
        state["congestion_score"] = max(min(new_cong_score, 1.0), 0.0)
        state["capacity_vph"] = new_capacity

        # Speed improvement (simplified)
        free_flow_speed = float(seg_row["free_flow_speed_kmh"].iloc[0])
        current_speed = float(state.get("speed_kmh", free_flow_speed * 0.6))
        improvement_ratio = min(new_capacity / original_capacity, 2.0)
        state["speed_kmh"] = min(current_speed * (1 + 0.2 * (improvement_ratio - 1)), free_flow_speed)
        state["delay_min"] = state.get("delay_min", 2.0) * (original_capacity / new_capacity)

    elif intervention_type in ["signal_retiming"]:
        # Signal retiming reduces delay for same capacity
        state["delay_min"] = state.get("delay_min", 2.0) * 0.75
        state["congestion_score"] = max(state.get("congestion_score", 0.5) * 0.85, 0.0)
        state["speed_kmh"] = state.get("speed_kmh", 30) * 1.1

    elif intervention_type in ["turn_lane"]:
        # Turn lane reduces local delay and improves flow
        state["delay_min"] = state.get("delay_min", 2.0) * 0.80
        state["congestion_score"] = max(state.get("congestion_score", 0.5) * 0.88, 0.0)

    elif intervention_type in ["connector"]:
        # Connector distributes demand — model as moderate improvement
        state["flow_vph"] = current_flow * 0.75
        state["congestion_score"] = max(state.get("congestion_score", 0.5) * 0.80, 0.0)

    simulated[target_seg] = state

    # Propagate improvement to 1-hop neighbors (simplified)
    # Neighbors benefit partially from the intervention
    return simulated


def _compute_network_metrics(
    state: Dict[str, Dict],
    physical_graph: nx.DiGraph,
    network_df: pd.DataFrame,
) -> Dict[str, float]:
    """Compute aggregate network KPIs."""
    scores = [s.get("congestion_score", 0.0) for s in state.values()]
    delays = [s.get("delay_min", 0.0) for s in state.values()]
    speeds = [s.get("speed_kmh", 0.0) for s in state.values() if s.get("speed_kmh", 0) > 0]

    severe_threshold = 0.75
    high_threshold = 0.6

    scores_arr = np.array(scores, dtype=float)
    delays_arr = np.array(delays, dtype=float)

    return {
        "avg_congestion_score": float(np.mean(scores_arr)) if len(scores_arr) > 0 else 0.0,
        "max_congestion_score": float(np.max(scores_arr)) if len(scores_arr) > 0 else 0.0,
        "severe_segments": int(np.sum(scores_arr >= severe_threshold)),
        "high_segments": int(np.sum(scores_arr >= high_threshold)),
        "avg_delay_min": float(np.mean(delays_arr)) if len(delays_arr) > 0 else 0.0,
        "max_delay_min": float(np.max(delays_arr)) if len(delays_arr) > 0 else 0.0,
        "avg_speed_kmh": float(np.mean(speeds)) if speeds else 0.0,
        "network_health_score": float(1.0 - np.mean(scores_arr)) if len(scores_arr) > 0 else 1.0,
        "congestion_variance": float(np.var(scores_arr)) if len(scores_arr) > 0 else 0.0,
    }


def _summarize_benefits(changes: Dict) -> List[str]:
    """Generate human-readable benefit summary."""
    benefits = []
    for key, info in changes.items():
        if info["direction"] == "improved" and abs(info["change_pct"]) >= 1.0:
            label_map = {
                "avg_congestion_score": "average congestion",
                "severe_segments": "severe-congestion segments",
                "avg_delay_min": "average delay",
                "max_delay_min": "peak delay",
                "network_health_score": "network health",
            }
            label = label_map.get(key, key)
            pct = abs(info["change_pct"])
            benefits.append(f"↓ {pct:.1f}% {label}")
    return benefits[:5]


def identify_recurring_bottlenecks(
    traffic_df: pd.DataFrame,
    network_df: pd.DataFrame,
    seg_centrality: Optional[Dict[str, float]] = None,
    top_k: int = 15,
) -> List[Dict]:
    """
    Identify top recurring bottlenecks from historical traffic data.

    Score = severity_frequency × avg_duration × network_centrality × structural_flag
    """
    if "congestion_score" not in traffic_df.columns:
        # Compute from available columns
        if "congestion_index" in traffic_df.columns:
            traffic_df = traffic_df.copy()
            traffic_df["congestion_score"] = traffic_df["congestion_index"]
        else:
            return []

    traffic_df = traffic_df.copy()
    traffic_df["timestamp"] = pd.to_datetime(traffic_df["timestamp"])

    HIGH_THRESHOLD = 0.6
    SEVERE_THRESHOLD = 0.75

    results = []

    for seg_id, grp in traffic_df.groupby("segment_id"):
        grp_sorted = grp.sort_values("timestamp")
        scores = grp_sorted["congestion_score"].values

        high_count = int((scores >= HIGH_THRESHOLD).sum())
        severe_count = int((scores >= SEVERE_THRESHOLD).sum())
        total = max(len(scores), 1)

        high_freq = high_count / total
        severe_freq = severe_count / total

        if high_freq < 0.02:  # skip segments with <2% high congestion
            continue

        # Estimate average duration of congestion episodes
        is_high = (scores >= HIGH_THRESHOLD).astype(int)
        transitions = np.diff(is_high)
        n_episodes = int((transitions == 1).sum())
        if n_episodes > 0:
            avg_duration = (high_count / n_episodes) * 5  # minutes (5 min per step)
        else:
            avg_duration = 0.0

        # Network centrality
        centrality = seg_centrality.get(seg_id, 0.5) if seg_centrality else 0.5

        # Structural bottleneck flag
        net_row = network_df[network_df["segment_id"] == seg_id]
        struct_flag = float(net_row["structural_bottleneck"].iloc[0]) if not net_row.empty else 0
        importance = float(net_row["importance"].iloc[0]) if not net_row.empty else 0.5

        # Composite bottleneck score
        bottleneck_score = (
            0.35 * severe_freq +
            0.25 * high_freq +
            0.15 * min(avg_duration / 60.0, 1.0) +
            0.15 * centrality +
            0.10 * (struct_flag * 0.5 + importance * 0.5)
        )

        results.append({
            "segment_id": seg_id,
            "bottleneck_score": round(bottleneck_score, 4),
            "high_congestion_frequency": round(high_freq, 4),
            "severe_congestion_frequency": round(severe_freq, 4),
            "avg_duration_minutes": round(avg_duration, 1),
            "n_episodes": n_episodes,
            "centrality": round(centrality, 4),
            "structural_bottleneck": bool(struct_flag),
            "importance": round(importance, 3),
            "severity": "high" if severe_freq > 0.1 else "moderate",
        })

    results.sort(key=lambda x: x["bottleneck_score"], reverse=True)
    return results[:top_k]
