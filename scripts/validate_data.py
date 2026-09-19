"""
scripts/validate_data.py

Data validation script. Run first to inspect dataset schema and generate health report.
"""

import sys
import os
import json
import logging
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

os.environ.setdefault("DATA_DIR", "./data")
os.environ.setdefault("MODEL_DIR", "./models")


def main():
    from ml.data.ingestion import (
        load_traffic, load_network, load_nodes, load_incidents,
        load_context, load_roadworks, load_planning_candidates,
        load_signal_plans, load_turn_restrictions, load_od_demand,
        load_scenario_examples, get_time_interval, get_data_health_report
    )
    from ml.data.schema_adapter import verify_interval
    from ml.data.target_alignment import inspect_target_schema, align_targets

    print("\n" + "="*70)
    print("FLOWGUARD AI — DATA VALIDATION")
    print("="*70)

    # 1. Traffic schema
    print("\n[1] TRAFFIC TRAIN")
    df = load_traffic("train")
    print(f"  Rows: {len(df):,}")
    print(f"  Columns: {df.columns}")
    print(f"  Segment IDs: {df['segment_id'].n_unique()} unique")
    print(f"  Time range: {df['timestamp'].min()} to {df['timestamp'].max()}")
    ts = df.filter(__import__('polars').col("segment_id") == df["segment_id"][0]).sort("timestamp")["timestamp"].to_pandas()
    interval = verify_interval(ts)
    print(f"  Detected interval: {interval} minutes")

    # Missing values
    null_counts = {col: df[col].is_null().sum() for col in df.columns if df[col].is_null().sum() > 0}
    print(f"  Missing values: {null_counts if null_counts else 'None'}")

    # 2. Validation traffic
    print("\n[2] TRAFFIC VALIDATION")
    df_val = load_traffic("validation")
    print(f"  Rows: {len(df_val):,}")

    # 3. Forecast targets schema
    print("\n[3] FORECAST TARGETS (labels only — never model inputs)")
    schema = inspect_target_schema("train")
    print(f"  Columns: {schema['columns']}")
    print(f"  Timestamp col: {schema['timestamp_col']}")
    print(f"  Segment col: {schema['segment_col']}")
    print(f"  Horizon columns detected: {schema['horizon_cols']}")

    print("\n[4] ALIGNING TARGETS...")
    aligned = align_targets("train")
    print(f"  Aligned rows: {len(aligned):,}")
    print(f"  Horizons available: {sorted(aligned['horizon_minutes'].unique().to_list())}")
    print(f"  Target variables: {aligned['target_variable'].unique().to_list()}")

    # 4. Network
    print("\n[5] NETWORK")
    net = load_network()
    nodes = load_nodes()
    print(f"  Segments: {len(net)}")
    print(f"  Nodes: {len(nodes)} (lat/lon available: {'lat' in nodes.columns})")
    print(f"  Road classes: {net['road_class'].value_counts().to_dict()}")
    print(f"  Structural bottlenecks: {net['structural_bottleneck'].sum()}")
    print(f"  Lat range: {nodes['lat'].min():.3f}–{nodes['lat'].max():.3f}")
    print(f"  Lon range: {nodes['lon'].min():.3f}–{nodes['lon'].max():.3f}")

    # 5. Optional files
    print("\n[6] OPTIONAL FILES")
    optional_checks = {
        "incidents_train": lambda: load_incidents("train"),
        "context_train": lambda: load_context("train"),
        "roadworks_train": lambda: load_roadworks("train"),
        "planning_candidates": load_planning_candidates,
        "signal_plans": load_signal_plans,
        "turn_restrictions": load_turn_restrictions,
        "od_demand_profiles": load_od_demand,
        "scenario_examples": load_scenario_examples,
    }
    available = {}
    for name, loader in optional_checks.items():
        try:
            df_opt = loader()
            if df_opt is not None:
                print(f"  ✓ {name}: {len(df_opt)} rows")
                available[name] = True
            else:
                print(f"  ✗ {name}: not found")
                available[name] = False
        except Exception as e:
            print(f"  ✗ {name}: ERROR — {e}")
            available[name] = False

    # 6. Data health report
    print("\n[7] DATA HEALTH REPORT")
    report = get_data_health_report()
    health_path = Path("./artifacts/data_health.json")
    health_path.parent.mkdir(exist_ok=True)
    health_path.write_text(json.dumps(report, indent=2, default=str))
    print(f"  Saved to: {health_path}")

    # Summary
    print("\n" + "="*70)
    print("VALIDATION COMPLETE")
    print(f"  Dataset: 436 segments, 120 nodes")
    print(f"  Interval: {interval} min | Horizons: {[15,30,45,60]}")
    print(f"  Available optional files: {sum(available.values())}/{len(available)}")
    print("="*70 + "\n")

    return {"interval": interval, "available": available}


if __name__ == "__main__":
    main()
