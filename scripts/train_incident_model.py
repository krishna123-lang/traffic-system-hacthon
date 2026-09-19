"""
scripts/train_incident_model.py

Train incident detection model:
  - Build incident labels from incidents_train.csv
  - Compute anomaly scores
  - Train XGBoost + LightGBM
  - Select best by PR-AUC
  - Save with SHAP metadata
"""

import sys
import json
import logging
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

import os
os.environ.setdefault("DATA_DIR", "./data")
os.environ.setdefault("MODEL_DIR", "./models")


def main():
    import pandas as pd
    import numpy as np
    from ml.data.feature_engineering import build_features, get_feature_columns
    from ml.incidents.detector import (
        build_incident_labels, compute_anomaly_scores,
        train_incident_model, save_incident_model,
        INCIDENT_FEATURES, get_available_features
    )
    from ml.data.ingestion import load_incidents

    print("\n" + "="*60)
    print("FLOWGUARD AI — INCIDENT MODEL TRAINING")
    print("="*60)

    # Load features — sample at POLARS stage to avoid OOM
    print("\n[1] Loading features...")
    import polars as pl
    df_pl = build_features("train", use_cache=True)
    NORMAL_SAMPLE = 80000

    # Load incidents early to keep all incident-segment rows
    from ml.data.ingestion import load_incidents as _load_inc
    _incidents_pre = _load_inc("train")
    if _incidents_pre is not None and len(_incidents_pre) > 0:
        _inc_segs = _incidents_pre["segment_id"].tolist()
        df_incident_pl = df_pl.filter(pl.col("segment_id").is_in(_inc_segs))
        df_normal_pl = df_pl.filter(~pl.col("segment_id").is_in(_inc_segs))
        df_normal_sampled_pl = df_normal_pl.sample(min(NORMAL_SAMPLE, len(df_normal_pl)), seed=42)
        df_sampled_pl = pl.concat([df_incident_pl, df_normal_sampled_pl])
    else:
        df_sampled_pl = df_pl.sample(min(NORMAL_SAMPLE + 20000, len(df_pl)), seed=42)

    df = df_sampled_pl.to_pandas()
    print(f"  Sampled to: {len(df):,} rows")

    # Load incidents
    print("\n[2] Loading incident labels...")
    incidents_df = load_incidents("train")
    if incidents_df is None or len(incidents_df) == 0:
        print("  WARNING: No incident data found. Creating synthetic labels from congestion_score.")
        df["incident_label"] = (df.get("congestion_score", df.get("congestion_index", 0)) > 0.75).astype(int)
        df["incident_type_label"] = "none"
        df["incident_severity_label"] = 0
        df["incident_group"] = -1
    else:
        print(f"  Incidents: {len(incidents_df)} records")
        df = build_incident_labels(df, incidents_df)

    print(f"  Incident-positive rows: {df['incident_label'].sum():,} / {len(df):,}")

    # Compute anomaly scores
    print("\n[3] Computing anomaly scores...")
    df = compute_anomaly_scores(df)

    # Train models
    results = {}
    for model_type in ["xgboost", "lightgbm"]:
        print(f"\n[4] Training {model_type}...")
        try:
            model, threshold, metrics = train_incident_model(df, model_type=model_type)
            results[model_type] = {"model": model, "threshold": threshold, "metrics": metrics}
            print(f"  P={metrics['precision']:.3f} R={metrics['recall']:.3f} "
                  f"F1={metrics['f1']:.3f} PR-AUC={metrics['pr_auc']:.3f} "
                  f"FAR={metrics['false_alarm_rate']:.3f}")
        except Exception as e:
            logger.error(f"  {model_type} failed: {e}")
            results[model_type] = None

    # Select best by F1 score (balanced precision/recall for hackathon)
    best_type = None
    best_f1 = -1
    for mt, res in results.items():
        if res and res["metrics"]["f1"] > best_f1:
            best_f1 = res["metrics"]["f1"]
            best_type = mt

    if best_type is None:
        print("\nAll models failed. Exiting.")
        return

    best = results[best_type]
    print(f"\n[5] Best model: {best_type} (F1={best_f1:.3f})")

    feature_cols = get_available_features(df)
    save_incident_model(best["model"], best["threshold"], feature_cols, best["metrics"])

    # Save all metrics
    all_metrics = []
    for mt, res in results.items():
        if res:
            m = dict(res["metrics"])
            all_metrics.append(m)

    metrics_path = Path("./artifacts/incident_metrics.json")
    metrics_path.parent.mkdir(exist_ok=True)
    metrics_path.write_text(json.dumps(all_metrics, indent=2))
    print(f"\nMetrics saved: {metrics_path}")

    print("\n" + "="*60)
    print("INCIDENT MODEL TRAINING COMPLETE")
    print("="*60 + "\n")


if __name__ == "__main__":
    main()
