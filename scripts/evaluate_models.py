"""
scripts/evaluate_models.py

Robustness evaluation and model comparison.
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
    import numpy as np
    import pandas as pd
    from ml.forecasting.models import mae, rmse, smape, load_forecast_model, HORIZONS

    print("\n" + "="*60)
    print("FLOWGUARD AI -- MODEL EVALUATION & ROBUSTNESS")
    print("="*60)

    # Load existing metrics
    metrics_path = Path("./artifacts/forecast_metrics.json")
    if metrics_path.exists():
        all_metrics = json.loads(metrics_path.read_text())
        print("\n[Forecast Benchmark Results]")
        print(f"{'Model':<25} {'Horizon':>8} {'MAE':>10} {'RMSE':>10} {'sMAPE':>10}")
        print("-"*65)
        for m in sorted(all_metrics, key=lambda x: (x["horizon_minutes"], x["mae"])):
            print(f"{m['model']:<25} {m['horizon_minutes']:>7}m {m['mae']:>10.4f} "
                  f"{m['rmse']:>10.4f} {m.get('smape', 0):>9.2f}%")
    else:
        print("  No forecast metrics found. Run train_forecasting_models.py first.")

    # Robustness simulation
    print("\n[Robustness Evaluation]")
    robustness_results = {}

    # Load validation features
    try:
        import polars as pl
        from ml.data.feature_engineering import build_features
        from ml.data.target_alignment import align_targets

        df_val = build_features("validation", use_cache=True).to_pandas()
        targets_val = align_targets("validation").to_pandas()

        model_payload = load_forecast_model("xgboost", 15)
        if model_payload:
            model = model_payload["model"]

            # Get baseline target
            t_val = targets_val[
                (targets_val["horizon_minutes"] == 15) &
                (targets_val["target_variable"] == "congestion")
            ].copy()
            t_val["timestamp"] = pd.to_datetime(t_val["origin_timestamp"])
            df_val["timestamp"] = pd.to_datetime(df_val["timestamp"])

            merged = df_val.merge(
                t_val[["segment_id", "timestamp", "target_value"]],
                on=["segment_id", "timestamp"], how="inner"
            ).dropna(subset=["target_value"])

            if len(merged) > 0:
                X_base = merged[[c for c in model.feature_cols if c in merged.columns]].fillna(0)
                y_true = merged["target_value"].values

                baseline_pred = model.predict(merged)
                baseline_mae = mae(y_true, baseline_pred[:len(y_true)])

                robustness_results["baseline"] = {"mae": baseline_mae}

                # Test 1: 5% missing data
                X_5pct = merged.copy()
                for col in ["speed_kmh", "flow_vph", "occupancy_pct"]:
                    if col in X_5pct.columns:
                        mask = np.random.random(len(X_5pct)) < 0.05
                        X_5pct.loc[mask, col] = np.nan
                pred_5pct = model.predict(X_5pct.fillna(0))
                m_5pct = mae(y_true, pred_5pct[:len(y_true)])
                robustness_results["missing_5pct"] = {
                    "mae": m_5pct,
                    "degradation_pct": (m_5pct - baseline_mae) / baseline_mae * 100
                }
                print(f"  5% missing: MAE={m_5pct:.4f} ({robustness_results['missing_5pct']['degradation_pct']:+.1f}%)")

                # Test 2: 10% missing data
                X_10pct = merged.copy()
                for col in ["speed_kmh", "flow_vph"]:
                    if col in X_10pct.columns:
                        mask = np.random.random(len(X_10pct)) < 0.10
                        X_10pct.loc[mask, col] = np.nan
                pred_10pct = model.predict(X_10pct.fillna(0))
                m_10pct = mae(y_true, pred_10pct[:len(y_true)])
                robustness_results["missing_10pct"] = {
                    "mae": m_10pct,
                    "degradation_pct": (m_10pct - baseline_mae) / baseline_mae * 100
                }
                print(f"  10% missing: MAE={m_10pct:.4f} ({robustness_results['missing_10pct']['degradation_pct']:+.1f}%)")

                # Test 3: Random noise
                X_noisy = merged.copy()
                for col in ["speed_kmh", "flow_vph"]:
                    if col in X_noisy.columns:
                        noise = np.random.normal(0, X_noisy[col].std() * 0.1, len(X_noisy))
                        X_noisy[col] = X_noisy[col] + noise
                pred_noisy = model.predict(X_noisy.fillna(0))
                m_noisy = mae(y_true, pred_noisy[:len(y_true)])
                robustness_results["random_noise"] = {
                    "mae": m_noisy,
                    "degradation_pct": (m_noisy - baseline_mae) / baseline_mae * 100
                }
                print(f"  +10% noise: MAE={m_noisy:.4f} ({robustness_results['random_noise']['degradation_pct']:+.1f}%)")

    except Exception as e:
        logger.warning(f"Robustness evaluation failed: {e}")
        robustness_results["error"] = str(e)

    # Save robustness results
    rob_path = Path("./artifacts/robustness_metrics.json")
    rob_path.write_text(json.dumps(robustness_results, indent=2))
    print(f"\nRobustness metrics saved: {rob_path}")

    print("\n" + "="*60)
    print("EVALUATION COMPLETE")
    print("="*60 + "\n")


if __name__ == "__main__":
    main()
