"""
scripts/train_forecasting_models.py

Train all forecasting models:
  1. Historical Baseline
  2. XGBoost
  3. GRU (PyTorch)
  4. ST-GNN (PyTorch + segment line graph)

For each: fit on training features, evaluate on validation, save best per horizon.
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
os.environ.setdefault("SAMPLE_ROWS", "200000")  # Limit for speed


def main():
    import numpy as np
    import pandas as pd

    from ml.data.feature_engineering import build_features
    from ml.data.target_alignment import align_targets, get_primary_target_variable
    from ml.data.graph_builder import build_graphs
    from ml.forecasting.models import (
        HistoricalBaseline, XGBoostForecaster, GRUForecaster, STGNNModel,
        mae, rmse, smape, save_forecast_model, HORIZONS, FORECAST_FEATURES
    )

    print("\n" + "="*60)
    print("FLOWGUARD AI — FORECASTING MODEL TRAINING")
    print("="*60)

    # Load features
    print("\n[1] Loading features...")
    SAMPLE_ROWS = int(os.environ.get("SAMPLE_ROWS", 200000))
    df_pl_train = build_features("train", use_cache=True)
    df_pl_val = build_features("validation", use_cache=True)

    # Sample for manageable training time
    import polars as pl
    if len(df_pl_train) > SAMPLE_ROWS:
        df_pl_train = df_pl_train.sample(SAMPLE_ROWS, seed=42)
        print(f"  Sampled train to {SAMPLE_ROWS:,} rows for speed")
    if len(df_pl_val) > SAMPLE_ROWS // 4:
        df_pl_val = df_pl_val.sample(SAMPLE_ROWS // 4, seed=42)

    df_train = df_pl_train.to_pandas()
    df_val = df_pl_val.to_pandas()
    df_train["timestamp"] = pd.to_datetime(df_train["timestamp"])
    df_val["timestamp"] = pd.to_datetime(df_val["timestamp"])
    print(f"  Train: {len(df_train):,}, Val: {len(df_val):,}")

    # Load aligned targets
    print("\n[2] Loading aligned targets...")
    targets_train = align_targets("train").to_pandas()
    targets_val = align_targets("validation").to_pandas()
    target_var = get_primary_target_variable("train")
    print(f"  Primary target variable: {target_var}")

    # Load graph for ST-GNN
    print("\n[3] Loading graphs...")
    graphs = build_graphs(use_cache=True)
    seg_to_idx = graphs["seg_to_idx"]
    idx_to_seg = graphs["idx_to_seg"]
    adj_matrix = graphs["adj_matrix"]

    all_metrics = []

    for horizon in HORIZONS:
        print(f"\n{'='*40}")
        print(f"HORIZON: +{horizon} min")
        print(f"{'='*40}")

        # Get targets aligned to horizon
        t_train = targets_train[
            (targets_train["horizon_minutes"] == horizon) &
            (targets_train["target_variable"] == target_var)
        ].copy()
        t_val = targets_val[
            (targets_val["horizon_minutes"] == horizon) &
            (targets_val["target_variable"] == target_var)
        ].copy()

        if len(t_train) == 0 or len(t_val) == 0:
            print(f"  No targets for horizon {horizon} with var '{target_var}'. Skipping.")
            continue

        # Merge features + targets (aligned targets use 'origin_timestamp')
        t_train_pd = t_train.rename(columns={"origin_timestamp": "timestamp"})
        t_val_pd = t_val.rename(columns={"origin_timestamp": "timestamp"})
        t_train_pd["timestamp"] = pd.to_datetime(t_train_pd["timestamp"])
        t_val_pd["timestamp"] = pd.to_datetime(t_val_pd["timestamp"])

        merged_train = df_train.merge(
            t_train_pd[["segment_id", "timestamp", "target_value"]],
            on=["segment_id", "timestamp"], how="inner"
        ).dropna(subset=["target_value"])

        merged_val = df_val.merge(
            t_val_pd[["segment_id", "timestamp", "target_value"]],
            on=["segment_id", "timestamp"], how="inner"
        ).dropna(subset=["target_value"])

        if len(merged_train) == 0:
            # Fallback: use congestion_score as proxy target
            print(f"  No merged data. Using congestion_score as proxy target.")
            proxy_col = "congestion_score" if "congestion_score" in df_train.columns else "congestion_index"
            merged_train = df_train.copy()
            merged_train["target_value"] = merged_train[proxy_col]
            merged_val = df_val.copy()
            merged_val["target_value"] = merged_val[proxy_col]

        y_train = merged_train["target_value"].values.astype(np.float32)
        y_val = merged_val["target_value"].values.astype(np.float32)

        # Period masks for split evaluation
        peak_mask_val = merged_val.get("is_peak", pd.Series(False, index=merged_val.index)).values.astype(bool)
        incident_mask_val = merged_val.get("incident_active", pd.Series(0, index=merged_val.index)).values.astype(bool)

        horizon_metrics = []

        # ── 1. Historical Baseline ─────────────────────────────
        print(f"\n  [Model 1/4] Historical Baseline...")
        baseline = HistoricalBaseline()
        baseline.fit(merged_train, target_col="target_value")
        pred_baseline = baseline.predict(merged_val)
        m = {
            "model": "historical_baseline",
            "horizon_minutes": horizon,
            "mae": mae(y_val, pred_baseline[:len(y_val)]),
            "rmse": rmse(y_val, pred_baseline[:len(y_val)]),
            "smape": smape(y_val, pred_baseline[:len(y_val)]),
        }
        horizon_metrics.append(m)
        print(f"    MAE={m['mae']:.4f} RMSE={m['rmse']:.4f} sMAPE={m['smape']:.2f}%")
        save_forecast_model(baseline, "historical_baseline", horizon, m)

        # ── 2. XGBoost ─────────────────────────────────────────
        print(f"\n  [Model 2/4] XGBoost...")
        xgb_model = XGBoostForecaster(horizon)
        xgb_model.fit(merged_train, y_train, target_col="target_value")
        pred_xgb = xgb_model.predict(merged_val)
        m = {
            "model": "xgboost",
            "horizon_minutes": horizon,
            "mae": mae(y_val, pred_xgb[:len(y_val)]),
            "rmse": rmse(y_val, pred_xgb[:len(y_val)]),
            "smape": smape(y_val, pred_xgb[:len(y_val)]),
        }
        if peak_mask_val.sum() > 0:
            m["mae_peak"] = mae(y_val[peak_mask_val], pred_xgb[:len(y_val)][peak_mask_val])
        if incident_mask_val.sum() > 0:
            m["mae_incident"] = mae(y_val[incident_mask_val], pred_xgb[:len(y_val)][incident_mask_val])
        horizon_metrics.append(m)
        print(f"    MAE={m['mae']:.4f} RMSE={m['rmse']:.4f} sMAPE={m['smape']:.2f}%")
        save_forecast_model(xgb_model, "xgboost", horizon, m)

        # ── 3. GRU ─────────────────────────────────────────────
        print(f"\n  [Model 3/4] GRU...")
        try:
            gru_model = GRUForecaster(horizon)
            gru_model.fit(merged_train, target_col="target_value")
            pred_gru = gru_model.predict(merged_val)
            m = {
                "model": "gru",
                "horizon_minutes": horizon,
                "mae": mae(y_val, pred_gru[:len(y_val)]),
                "rmse": rmse(y_val, pred_gru[:len(y_val)]),
                "smape": smape(y_val, pred_gru[:len(y_val)]),
            }
            horizon_metrics.append(m)
            print(f"    MAE={m['mae']:.4f} RMSE={m['rmse']:.4f} sMAPE={m['smape']:.2f}%")
            save_forecast_model(gru_model, "gru", horizon, m)
        except Exception as e:
            logger.warning(f"  GRU failed: {e}. Using XGBoost as fallback.")

        # ── 4. ST-GNN ──────────────────────────────────────────
        print(f"\n  [Model 4/4] ST-GNN (Spatio-Temporal GNN)...")
        try:
            stgnn = STGNNModel(n_nodes=len(idx_to_seg))
            stgnn.set_graph(adj_matrix, seg_to_idx, idx_to_seg)
            # Use smaller sample for ST-GNN (more expensive)
            stgnn_train = merged_train.sample(min(50000, len(merged_train)), random_state=42)
            stgnn.fit(stgnn_train, target_col="target_value")
            stgnn_pred = stgnn.predict_all_segments(merged_val)
            if stgnn_pred:
                # Map segment predictions back to val rows
                stgnn_preds_arr = np.array([
                    stgnn_pred.get(row["segment_id"], y_val[i])
                    for i, (_, row) in enumerate(merged_val.iterrows())
                ], dtype=np.float32)
                m = {
                    "model": "st_gnn",
                    "horizon_minutes": horizon,
                    "mae": mae(y_val, stgnn_preds_arr[:len(y_val)]),
                    "rmse": rmse(y_val, stgnn_preds_arr[:len(y_val)]),
                    "smape": smape(y_val, stgnn_preds_arr[:len(y_val)]),
                }
                horizon_metrics.append(m)
                print(f"    MAE={m['mae']:.4f} RMSE={m['rmse']:.4f} sMAPE={m['smape']:.2f}%")
                save_forecast_model(stgnn, "st_gnn", horizon, m)
        except Exception as e:
            logger.warning(f"  ST-GNN failed: {e}. GRU will be used as primary deep-learning model.")

        # ── SELECT BEST ─────────────────────────────────────────
        if horizon_metrics:
            best = min(horizon_metrics, key=lambda x: x["mae"])
            print(f"\n  ★ Best for +{horizon}min: {best['model']} (MAE={best['mae']:.4f})")
            all_metrics.extend(horizon_metrics)

    # Save all metrics
    metrics_path = Path("./artifacts/forecast_metrics.json")
    metrics_path.parent.mkdir(exist_ok=True)
    metrics_path.write_text(json.dumps(all_metrics, indent=2))
    print(f"\nAll forecast metrics saved: {metrics_path}")

    # Print comparison table
    print("\n" + "="*70)
    print("MODEL BENCHMARK RESULTS")
    print("="*70)
    print(f"{'Model':<25} {'Horizon':>8} {'MAE':>10} {'RMSE':>10} {'sMAPE':>10}")
    print("-"*70)
    for m in sorted(all_metrics, key=lambda x: (x["horizon_minutes"], x["mae"])):
        print(f"{m['model']:<25} {m['horizon_minutes']:>7}m {m['mae']:>10.4f} {m['rmse']:>10.4f} {m.get('smape', 0):>9.2f}%")
    print("="*70 + "\n")


if __name__ == "__main__":
    main()
