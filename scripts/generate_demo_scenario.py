"""
scripts/generate_demo_scenario.py

Pre-compute the demo scenario data from actual training data.
Produces deterministic scenario snapshots for the frontend simulation clock.

Scenario: "Morning Peak + Incident"
Uses TRAIN_SC_001 (R0067, stalled_vehicle, severity 2)
"""

import sys
import json
import logging
from pathlib import Path
from datetime import datetime, timedelta

sys.path.insert(0, str(Path(__file__).parent.parent))
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

import os
os.environ.setdefault("DATA_DIR", "./data")
os.environ.setdefault("MODEL_DIR", "./models")


def main():
    import polars as pl
    import pandas as pd
    import numpy as np

    from ml.data.ingestion import load_traffic, load_incidents, load_context
    from ml.data.graph_builder import build_graphs, get_k_hop_neighbors
    from ml.data.schema_adapter import get_congestion_state
    from ml.propagation.engine import compute_propagation_risk

    print("\n" + "="*60)
    print("FLOWGUARD AI — DEMO SCENARIO GENERATION")
    print("="*60)

    # Load graphs
    graphs = build_graphs(use_cache=True)
    seg_graph = graphs["seg_graph"]
    seg_to_idx = graphs["seg_to_idx"]
    network_df = graphs["network_df"]

    # Target incident from TRAIN_SC_001
    DEMO_SEGMENT = "R0067"
    INCIDENT_START = "2026-01-01 21:57:00"
    INCIDENT_END = "2026-01-01 22:40:00"

    # Load traffic data around incident window
    print(f"\n[1] Loading traffic data around incident on {DEMO_SEGMENT}...")
    df = load_traffic("train", use_cache=True)
    df = df.filter(
        (pl.col("timestamp") >= pl.lit("2026-01-01 21:00:00").str.to_datetime()) &
        (pl.col("timestamp") <= pl.lit("2026-01-01 23:30:00").str.to_datetime())
    ).sort("timestamp")

    timestamps = sorted(df["timestamp"].unique().to_list())
    print(f"  Time range: {timestamps[0]} → {timestamps[-1]}")
    print(f"  Snapshots: {len(timestamps)}")

    # Build scenario steps
    print("\n[2] Building scenario snapshots...")
    scenario_steps = []

    for ts in timestamps:
        ts_str = str(ts)
        ts_data = df.filter(pl.col("timestamp") == ts)

        # Build current state for all segments
        current_state = {}
        for row in ts_data.to_dicts():
            seg_id = row["segment_id"]
            net_row = network_df[network_df["segment_id"] == seg_id]
            cap = float(net_row["capacity_vph"].iloc[0]) if not net_row.empty else 1000
            ffs = float(net_row["free_flow_speed_kmh"].iloc[0]) if not net_row.empty else 50

            flow = max(row.get("flow_vph") or 0, 0)
            speed = max(row.get("speed_kmh") or 0, 0)
            occ = max(row.get("occupancy_pct") or 0, 0)
            tt = max(row.get("travel_time_min") or 0, 0)
            ff_time = max(row.get("free_flow_time_min") or 0.01, 0.01)
            ci = max(row.get("congestion_index") or 0, 0)

            speed_ratio = speed / max(ffs, 1)
            flow_util = flow / max(cap, 1)
            tt_ratio = tt / max(ff_time, 0.1)

            cong_score = (
                0.35 * (1 - min(speed_ratio, 1)) +
                0.30 * min(flow_util, 1) +
                0.20 * min(occ / 100, 1) +
                0.15 * min((tt_ratio - 1) / 4, 1)
            )
            cong_score = max(0, min(cong_score, 1))

            current_state[seg_id] = {
                "speed_kmh": speed,
                "flow_vph": flow,
                "occupancy_pct": occ,
                "travel_time_min": tt,
                "delay_min": max(row.get("delay_min") or 0, 0),
                "queue_length_veh": max(row.get("queue_length_veh") or 0, 0),
                "congestion_index": ci,
                "congestion_score": cong_score,
                "congestion_state": get_congestion_state(cong_score),
                "flow_utilization": flow_util,
            }

        # Incident flag
        ts_dt = pd.Timestamp(ts_str)
        incident_active = (
            ts_dt >= pd.Timestamp(INCIDENT_START) and
            ts_dt <= pd.Timestamp(INCIDENT_END)
        )
        incident_segments = {DEMO_SEGMENT} if incident_active else set()

        # Propagation
        propagation = {}
        if incident_active and seg_graph.has_node(DEMO_SEGMENT):
            prop = compute_propagation_risk(
                DEMO_SEGMENT, seg_graph, current_state,
                incident_segments=incident_segments
            )
            propagation = {k: v["risk"] for k, v in prop.items()}

        # Count summary
        cong_scores = [s["congestion_score"] for s in current_state.values()]
        n_severe = sum(1 for s in cong_scores if s >= 0.75)
        n_high = sum(1 for s in cong_scores if s >= 0.6)
        avg_cong = float(np.mean(cong_scores)) if cong_scores else 0.0

        scenario_steps.append({
            "timestamp": ts_str,
            "step": len(scenario_steps),
            "incident_active": incident_active,
            "incident_segment": DEMO_SEGMENT if incident_active else None,
            "incident_type": "stalled_vehicle" if incident_active else None,
            "incident_severity": 2 if incident_active else 0,
            "current_state": current_state,
            "propagation": propagation,
            "summary": {
                "avg_congestion": round(avg_cong, 3),
                "severe_segments": n_severe,
                "high_segments": n_high,
                "network_health": round(1 - avg_cong, 3),
                "active_incidents": 1 if incident_active else 0,
            }
        })

    print(f"  Generated {len(scenario_steps)} steps")

    # Save scenario
    out_path = Path("./artifacts/demo_scenario.json")
    out_path.parent.mkdir(exist_ok=True)

    # Compact storage — save only per-step summary + key segment states
    compact_steps = []
    key_segments = [DEMO_SEGMENT] + list(
        get_k_hop_neighbors(seg_graph, DEMO_SEGMENT, k=2).get(1, [])[:5]
    )

    for step in scenario_steps:
        compact_step = {
            "timestamp": step["timestamp"],
            "step": step["step"],
            "incident_active": step["incident_active"],
            "incident_segment": step["incident_segment"],
            "incident_type": step["incident_type"],
            "incident_severity": step["incident_severity"],
            "summary": step["summary"],
            "propagation": {k: v for k, v in step["propagation"].items() if v > 0.3},
            "key_segments": {
                seg: step["current_state"].get(seg, {})
                for seg in key_segments
            },
            # Store full state (will be large but needed for map)
            "segment_states": {
                seg_id: {
                    "congestion_score": round(state["congestion_score"], 3),
                    "congestion_state": state["congestion_state"],
                    "speed_kmh": round(state["speed_kmh"], 1),
                    "flow_vph": round(state["flow_vph"], 1),
                }
                for seg_id, state in step["current_state"].items()
            }
        }
        compact_steps.append(compact_step)

    scenario = {
        "scenario_id": "DEMO_MORNING_PEAK_INCIDENT",
        "name": "Morning Peak + Incident",
        "description": "Stalled vehicle on segment R0067, leading to congestion spillback",
        "source": "NEURAX Dataset — TRAIN_SC_001",
        "incident_segment": DEMO_SEGMENT,
        "incident_type": "stalled_vehicle",
        "incident_start": INCIDENT_START,
        "incident_end": INCIDENT_END,
        "total_steps": len(compact_steps),
        "time_interval_minutes": 5,
        "steps": compact_steps,
    }

    # Write in chunks to avoid memory issues
    out_path.write_text(json.dumps(scenario, indent=None, default=str))
    size_mb = out_path.stat().st_size / 1024 / 1024
    print(f"\nDemo scenario saved: {out_path} ({size_mb:.1f} MB)")

    # Save scenario index
    index = {
        "scenarios": [
            {
                "scenario_id": "DEMO_MORNING_PEAK_INCIDENT",
                "name": "Morning Peak + Incident",
                "description": "Stalled vehicle on R0067 → congestion → spillback",
                "type": "incident",
                "total_steps": len(compact_steps),
                "incident_segment": DEMO_SEGMENT,
            }
        ]
    }
    Path("./artifacts/scenario_index.json").write_text(json.dumps(index, indent=2))

    print("\n" + "="*60)
    print("DEMO SCENARIO GENERATION COMPLETE")
    print("="*60 + "\n")


if __name__ == "__main__":
    main()
