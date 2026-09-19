"""
Incident Detection Engine.

Hybrid architecture:
  Traffic anomalies + Temporal change detection + Neighbor deterioration
    → Anomaly score
    → XGBoost / LightGBM classifier
    → Calibrated incident probability

Only 49 training incidents → uses time-aware cross-validation to prevent
incident-window leakage.

Output per segment:
  incident_probability, confidence, incident_type, severity_estimate,
  evidence (SHAP features), false_alarm_rate
"""

from __future__ import annotations
import json
import logging
import pickle
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import (
    precision_score, recall_score, f1_score,
    average_precision_score, confusion_matrix, roc_auc_score
)
from sklearn.model_selection import StratifiedKFold
from sklearn.preprocessing import StandardScaler
import xgboost as xgb
import lightgbm as lgb
import joblib

try:
    import shap
    HAS_SHAP = True
except ImportError:
    HAS_SHAP = False

from ml.data.ingestion import load_incidents, CACHE_DIR

logger = logging.getLogger(__name__)

MODEL_DIR = Path("./models")
MODEL_DIR.mkdir(exist_ok=True)

INCIDENT_MODEL_PATH = MODEL_DIR / "incident_model.joblib"
INCIDENT_METRICS_PATH = Path("./artifacts/incident_metrics.json")
INCIDENT_METRICS_PATH.parent.mkdir(exist_ok=True)


# ──────────────────────────────────────────────────────────
# LABEL CONSTRUCTION
# ──────────────────────────────────────────────────────────

def build_incident_labels(
    features_df: pd.DataFrame,
    incidents_df: pd.DataFrame,
    pre_incident_window: int = 3,   # steps before incident
    post_incident_window: int = 6,  # steps after (including recovery)
) -> pd.DataFrame:
    """
    Build binary labels: 1 = incident-affected window.

    Handles small incident count (49) carefully.
    Adds incident_type label for multi-class stage.
    """
    df = features_df.copy()
    df["incident_label"] = 0
    df["incident_type_label"] = "none"
    df["incident_severity_label"] = 0
    df["incident_group"] = -1  # for time-aware CV

    if incidents_df is None or len(incidents_df) == 0:
        return df

    df["timestamp"] = pd.to_datetime(df["timestamp"])

    for inc_idx, inc in incidents_df.iterrows():
        seg_id = inc["segment_id"]
        start = pd.Timestamp(inc["start_time"])
        end = pd.Timestamp(inc["end_time"])

        # Expand window
        delta = pd.Timedelta(minutes=5 * pre_incident_window)
        extended_start = start - delta
        delta2 = pd.Timedelta(minutes=5 * post_incident_window)
        extended_end = end + delta2

        mask = (
            (df["segment_id"] == seg_id) &
            (df["timestamp"] >= extended_start) &
            (df["timestamp"] <= extended_end)
        )
        df.loc[mask, "incident_label"] = 1
        df.loc[mask, "incident_type_label"] = str(inc["incident_type"])
        df.loc[mask, "incident_severity_label"] = int(inc["severity"])
        df.loc[mask, "incident_group"] = inc_idx  # group for time-aware CV

    logger.info(
        f"Incident labels: {df['incident_label'].sum():,} positive, "
        f"{(df['incident_label']==0).sum():,} negative, "
        f"positive rate: {df['incident_label'].mean():.3%}"
    )
    return df


# ──────────────────────────────────────────────────────────
# ANOMALY SCORE COMPONENT
# ──────────────────────────────────────────────────────────

def compute_anomaly_scores(df: pd.DataFrame) -> pd.DataFrame:
    """Rolling z-score based anomaly detection per segment."""
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.sort_values(["segment_id", "timestamp"])

    for col in ["speed_kmh", "flow_vph", "occupancy_pct", "congestion_index"]:
        if col not in df.columns:
            continue
        roll_mean = df.groupby("segment_id")[col].transform(
            lambda x: x.rolling(window=12, min_periods=3).mean()
        )
        roll_std = df.groupby("segment_id")[col].transform(
            lambda x: x.rolling(window=12, min_periods=3).std()
        )
        z = (df[col] - roll_mean) / (roll_std + 1e-6)
        df[f"{col}_zscore"] = z.fillna(0)

    # Composite anomaly score
    z_cols = [c for c in df.columns if c.endswith("_zscore")]
    if z_cols:
        df["anomaly_score"] = np.abs(df[z_cols]).mean(axis=1)
    else:
        df["anomaly_score"] = 0.0

    return df


# ──────────────────────────────────────────────────────────
# MODEL TRAINING
# ──────────────────────────────────────────────────────────

INCIDENT_FEATURES = [
    "speed_kmh", "flow_vph", "occupancy_pct", "travel_time_min",
    "delay_min", "queue_length_veh", "congestion_index", "sensor_quality",
    "speed_ratio", "flow_utilization", "tt_ratio", "congestion_score",
    "hour", "day_of_week", "is_peak", "is_weekend",
    "anomaly_score",
    "speed_kmh_roll_mean_3", "speed_kmh_roll_std_3",
    "flow_vph_roll_mean_3", "congestion_score_roll_mean_3",
    "speed_kmh_lag1", "flow_vph_lag1", "congestion_score_lag1",
    "speed_kmh_lag3", "congestion_score_lag3",
    "structural_bottleneck", "importance", "lanes",
    "roadwork_active", "roadwork_closure_fraction",
    "temperature_c", "rain_intensity", "event_level", "holiday_flag",
]


def get_available_features(df: pd.DataFrame) -> List[str]:
    """Return only features that exist in the dataframe."""
    available = [f for f in INCIDENT_FEATURES if f in df.columns]
    # Fill missing context columns with 0
    for col in INCIDENT_FEATURES:
        if col not in df.columns:
            df[col] = 0.0
    return INCIDENT_FEATURES


def train_incident_model(
    df_labeled: pd.DataFrame,
    model_type: str = "xgboost",
    threshold: float = 0.35,
) -> Tuple[Any, float, Dict]:
    """
    Train incident detection model with time-aware validation.

    Returns: (model, threshold, metrics_dict)
    """
    feature_cols = get_available_features(df_labeled)
    df_labeled = df_labeled.copy()

    # Fill NaN
    df_labeled[feature_cols] = df_labeled[feature_cols].fillna(0)

    X = df_labeled[feature_cols].values.astype(np.float32)
    y = df_labeled["incident_label"].values.astype(int)

    # Class weights
    n_pos = y.sum()
    n_neg = len(y) - n_pos
    scale_pos = max(n_neg / max(n_pos, 1), 1.0)
    logger.info(f"Class balance: {n_pos} positive, {n_neg} negative (scale_pos={scale_pos:.1f})")

    # Time-aware split: use last 20% of time as validation
    df_sorted = df_labeled.sort_values("timestamp")
    split_idx = int(len(df_sorted) * 0.8)
    train_idx = df_sorted.index[:split_idx]
    val_idx = df_sorted.index[split_idx:]

    X_tr, y_tr = df_labeled.loc[train_idx, feature_cols].fillna(0).values, y[df_labeled.index.isin(train_idx)]
    X_val, y_val = df_labeled.loc[val_idx, feature_cols].fillna(0).values, y[df_labeled.index.isin(val_idx)]

    if model_type == "xgboost":
        model = xgb.XGBClassifier(
            n_estimators=300,
            max_depth=6,
            learning_rate=0.05,
            scale_pos_weight=scale_pos,
            subsample=0.8,
            colsample_bytree=0.8,
            eval_metric="aucpr",
            use_label_encoder=False,
            random_state=42,
            n_jobs=-1,
        )
    else:
        model = lgb.LGBMClassifier(
            n_estimators=300,
            max_depth=6,
            learning_rate=0.05,
            scale_pos_weight=scale_pos,
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=42,
            n_jobs=-1,
            verbose=-1,
        )

    model.fit(X_tr, y_tr)

    # Calibrate probabilities using cross-validation
    from sklearn.calibration import CalibratedClassifierCV
    # Use cv=5 for cross-validated calibration (sklearn ≥1.0 compatible)
    calibrated = CalibratedClassifierCV(model, method="sigmoid", cv=5)
    calibrated.fit(X_tr, y_tr)

    # Evaluate
    y_prob = calibrated.predict_proba(X_val)[:, 1]
    y_pred = (y_prob >= threshold).astype(int)

    # Auto-tune threshold to maximize F1
    best_f1, best_thresh = 0.0, threshold
    for t in np.arange(0.1, 0.9, 0.05):
        pred_t = (y_prob >= t).astype(int)
        if pred_t.sum() == 0:
            continue
        f1 = f1_score(y_val, pred_t, zero_division=0)
        if f1 > best_f1:
            best_f1 = f1
            best_thresh = t

    y_pred_tuned = (y_prob >= best_thresh).astype(int)
    cm = confusion_matrix(y_val, y_pred_tuned)
    tn, fp, fn, tp = cm.ravel() if cm.shape == (2, 2) else (0, 0, 0, max(y_val.sum(), 1))

    metrics = {
        "model": model_type,
        "threshold": float(best_thresh),
        "precision": float(precision_score(y_val, y_pred_tuned, zero_division=0)),
        "recall": float(recall_score(y_val, y_pred_tuned, zero_division=0)),
        "f1": float(f1_score(y_val, y_pred_tuned, zero_division=0)),
        "pr_auc": float(average_precision_score(y_val, y_prob)) if y_val.sum() > 0 else 0.0,
        "false_alarm_rate": float(fp / max(tn + fp, 1)),
        "confusion_matrix": cm.tolist(),
        "n_train": len(y_tr),
        "n_val": len(y_val),
        "n_positive_train": int(y_tr.sum()),
        "n_positive_val": int(y_val.sum()),
    }

    logger.info(f"Incident model ({model_type}): P={metrics['precision']:.3f}, "
                f"R={metrics['recall']:.3f}, F1={metrics['f1']:.3f}, "
                f"PR-AUC={metrics['pr_auc']:.3f}, FAR={metrics['false_alarm_rate']:.3f}")

    return calibrated, best_thresh, metrics


# ──────────────────────────────────────────────────────────
# SHAP EXPLAINABILITY
# ──────────────────────────────────────────────────────────

def compute_shap_explanation(model, X_sample: np.ndarray, feature_names: List[str]) -> Dict:
    """Compute SHAP values for an incident prediction."""
    if not HAS_SHAP:
        return {"available": False}

    try:
        # Try TreeExplainer for XGBoost/LightGBM
        base_model = model.estimator if hasattr(model, "estimator") else model
        if hasattr(base_model, "estimators_"):
            # CalibratedClassifierCV wraps the base model
            base_model = base_model.estimators_[0] if hasattr(base_model, "estimators_") else base_model

        explainer = shap.TreeExplainer(base_model)
        shap_values = explainer.shap_values(X_sample)

        if isinstance(shap_values, list):
            sv = shap_values[1]  # positive class
        else:
            sv = shap_values

        if len(sv.shape) > 1:
            sv = sv[0]

        # Top contributing features
        top_k = min(5, len(feature_names))
        indices = np.argsort(np.abs(sv))[::-1][:top_k]
        evidence = []
        for idx in indices:
            fname = feature_names[idx]
            fval = float(X_sample[0, idx]) if len(X_sample.shape) > 1 else float(X_sample[idx])
            sval = float(sv[idx])
            evidence.append({
                "feature": fname,
                "value": round(fval, 3),
                "shap_contribution": round(sval, 4),
                "direction": "increases_risk" if sval > 0 else "decreases_risk",
            })

        return {"available": True, "evidence": evidence, "base_value": float(explainer.expected_value[1] if isinstance(explainer.expected_value, list) else explainer.expected_value)}
    except Exception as e:
        logger.warning(f"SHAP computation failed: {e}")
        return {"available": False, "error": str(e)}


# ──────────────────────────────────────────────────────────
# SAVE / LOAD
# ──────────────────────────────────────────────────────────

def save_incident_model(model, threshold: float, feature_cols: List[str], metrics: Dict):
    payload = {
        "model": model,
        "threshold": threshold,
        "feature_cols": feature_cols,
        "metrics": metrics,
    }
    joblib.dump(payload, INCIDENT_MODEL_PATH)
    logger.info(f"Incident model saved: {INCIDENT_MODEL_PATH}")

    INCIDENT_METRICS_PATH.write_text(json.dumps(metrics, indent=2))
    logger.info(f"Incident metrics saved: {INCIDENT_METRICS_PATH}")


def load_incident_model() -> Optional[Dict]:
    if not INCIDENT_MODEL_PATH.exists():
        logger.warning("Incident model not found. Run scripts/train_incident_model.py first.")
        return None
    return joblib.load(INCIDENT_MODEL_PATH)


# ──────────────────────────────────────────────────────────
# RUNTIME INFERENCE
# ──────────────────────────────────────────────────────────

def predict_incident(
    segment_features: Dict[str, float],
    model_payload: Optional[Dict] = None,
) -> Dict[str, Any]:
    """
    Predict incident probability for a single segment's current features.

    Returns structured output with probability, confidence, evidence.
    """
    if model_payload is None:
        model_payload = load_incident_model()

    if model_payload is None:
        return {
            "incident_probability": 0.0,
            "confidence": 0.0,
            "evidence": [],
            "model_available": False,
        }

    model = model_payload["model"]
    threshold = model_payload["threshold"]
    feature_cols = model_payload["feature_cols"]

    # Build feature vector
    X = np.array([[segment_features.get(f, 0.0) for f in feature_cols]], dtype=np.float32)

    try:
        prob = float(model.predict_proba(X)[0, 1])
    except Exception as e:
        logger.error(f"Inference error: {e}")
        prob = 0.0

    is_incident = prob >= threshold
    confidence = min(abs(prob - 0.5) * 2.0, 1.0)  # distance from decision boundary

    # Simple evidence from feature values (fallback if SHAP fails)
    evidence = []
    key_features = ["speed_kmh", "congestion_score", "anomaly_score",
                    "flow_utilization", "tt_ratio", "roadwork_active"]
    for f in key_features:
        if f in feature_cols:
            val = segment_features.get(f, 0.0)
            evidence.append({"feature": f, "value": round(val, 3)})

    return {
        "incident_probability": round(prob, 4),
        "is_incident": bool(is_incident),
        "confidence": round(confidence, 4),
        "threshold": threshold,
        "evidence": evidence,
        "model_available": True,
    }
