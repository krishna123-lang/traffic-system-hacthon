"""
Traffic Forecasting Engine.

Multi-model benchmark:
  1. Historical Baseline (rolling mean)
  2. XGBoost (tabular features)
  3. GRU (sequence model, PyTorch)
  4. ST-GNN (Spatio-Temporal Graph Neural Network)

Uses SEGMENT LINE GRAPH (not physical road graph) for graph models.
Targets: +15, +30, +45, +60 minutes.

No forecast target values are used as input features.
"""

from __future__ import annotations
import json
import logging
import pickle
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
import joblib
import xgboost as xgb

logger = logging.getLogger(__name__)

MODEL_DIR = Path("./models")
MODEL_DIR.mkdir(exist_ok=True)

HORIZONS = [15, 30, 45, 60]
STEPS_PER_HORIZON = {h: h // 5 for h in HORIZONS}  # assumes 5-min interval


# ──────────────────────────────────────────────────────────
# METRIC HELPERS
# ──────────────────────────────────────────────────────────

def mae(y_true, y_pred):
    return float(np.mean(np.abs(y_true - y_pred)))

def rmse(y_true, y_pred):
    return float(np.sqrt(np.mean((y_true - y_pred) ** 2)))

def smape(y_true, y_pred):
    denom = (np.abs(y_true) + np.abs(y_pred)) / 2.0
    return float(np.mean(np.where(denom == 0, 0, np.abs(y_true - y_pred) / denom)) * 100)


# ──────────────────────────────────────────────────────────
# 1. HISTORICAL BASELINE
# ──────────────────────────────────────────────────────────

class HistoricalBaseline:
    """Rolling historical mean per segment per time-of-day."""
    name = "historical_baseline"

    def __init__(self):
        self.segment_hour_mean: Dict[Tuple, float] = {}
        self.segment_mean: Dict[str, float] = {}
        self.global_mean: float = 0.0
        self.target_col: str = "congestion_index"

    def fit(self, df: pd.DataFrame, target_col: str = "congestion_index"):
        self.target_col = target_col
        df = df.copy()
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df["hour"] = df["timestamp"].dt.hour

        self.segment_hour_mean = (
            df.groupby(["segment_id", "hour"])[target_col].mean().to_dict()
        )
        self.segment_mean = df.groupby("segment_id")[target_col].mean().to_dict()
        self.global_mean = float(df[target_col].mean())
        return self

    def predict(self, df: pd.DataFrame) -> np.ndarray:
        df = df.copy()
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df["hour"] = df["timestamp"].dt.hour

        preds = []
        for _, row in df.iterrows():
            key = (row["segment_id"], int(row["hour"]))
            if key in self.segment_hour_mean:
                preds.append(self.segment_hour_mean[key])
            elif row["segment_id"] in self.segment_mean:
                preds.append(self.segment_mean[row["segment_id"]])
            else:
                preds.append(self.global_mean)
        return np.array(preds, dtype=np.float32)


# ──────────────────────────────────────────────────────────
# 2. XGBOOST FORECASTER
# ──────────────────────────────────────────────────────────

FORECAST_FEATURES = [
    "speed_kmh", "flow_vph", "occupancy_pct", "travel_time_min",
    "delay_min", "queue_length_veh", "congestion_index", "sensor_quality",
    "speed_ratio", "flow_utilization", "tt_ratio", "congestion_score",
    "hour", "day_of_week", "is_peak", "is_weekend", "minute",
    "lanes", "structural_bottleneck", "importance", "length_km",
    "speed_kmh_roll_mean_3", "speed_kmh_roll_mean_6", "speed_kmh_roll_mean_12",
    "flow_vph_roll_mean_3", "flow_vph_roll_mean_6",
    "congestion_score_roll_mean_3", "congestion_score_roll_mean_6",
    "speed_kmh_lag1", "speed_kmh_lag3", "speed_kmh_lag6", "speed_kmh_lag12",
    "flow_vph_lag1", "flow_vph_lag3",
    "congestion_index_lag1", "congestion_index_lag3", "congestion_index_lag6",
    "congestion_score_lag1", "congestion_score_lag3",
    "temperature_c", "rain_intensity", "event_level", "holiday_flag",
    "incident_active", "roadwork_active",
]


class XGBoostForecaster:
    name = "xgboost"

    def __init__(self, horizon_minutes: int):
        self.horizon = horizon_minutes
        self.model = None
        self.scaler = StandardScaler()
        self.feature_cols: List[str] = []
        self.target_col: str = "congestion_index"

    def _get_features(self, df: pd.DataFrame) -> List[str]:
        return [f for f in FORECAST_FEATURES if f in df.columns]

    def fit(self, X_train: pd.DataFrame, y_train: np.ndarray, target_col: str = "congestion_index"):
        self.target_col = target_col
        self.feature_cols = self._get_features(X_train)
        X = X_train[self.feature_cols].fillna(0).values
        self.scaler.fit(X)
        X_scaled = self.scaler.transform(X)

        self.model = xgb.XGBRegressor(
            n_estimators=500,
            max_depth=7,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            min_child_weight=3,
            random_state=42,
            n_jobs=-1,
        )
        self.model.fit(X_scaled, y_train)
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        feats = [f for f in self.feature_cols if f in X.columns]
        X_arr = X[feats].fillna(0).values
        # Pad if features missing
        if X_arr.shape[1] < len(self.feature_cols):
            missing = len(self.feature_cols) - X_arr.shape[1]
            X_arr = np.hstack([X_arr, np.zeros((len(X_arr), missing))])
        X_scaled = self.scaler.transform(X_arr)
        return self.model.predict(X_scaled).astype(np.float32)


# ──────────────────────────────────────────────────────────
# 3. GRU FORECASTER
# ──────────────────────────────────────────────────────────

try:
    import torch
    import torch.nn as nn
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False


GRU_SEQ_FEATURES = [
    "speed_kmh", "flow_vph", "occupancy_pct", "congestion_index",
    "congestion_score", "speed_ratio", "flow_utilization",
    "hour", "is_peak", "incident_active",
]

LOOKBACK_STEPS = 12  # 60 minutes of history


if HAS_TORCH:
    class GRUNet(nn.Module):
        def __init__(self, input_size: int, hidden_size: int = 128, n_layers: int = 2, dropout: float = 0.2):
            super().__init__()
            self.gru = nn.GRU(
                input_size, hidden_size, n_layers,
                batch_first=True, dropout=dropout if n_layers > 1 else 0
            )
            self.fc = nn.Sequential(
                nn.Linear(hidden_size, 64),
                nn.ReLU(),
                nn.Dropout(0.1),
                nn.Linear(64, 1),
            )

        def forward(self, x):
            # x: (batch, seq_len, features)
            out, _ = self.gru(x)
            return self.fc(out[:, -1, :]).squeeze(-1)  # use last time step


class GRUForecaster:
    name = "gru"

    def __init__(self, horizon_minutes: int, lookback: int = LOOKBACK_STEPS):
        self.horizon = horizon_minutes
        self.lookback = lookback
        self.model = None
        self.scaler = StandardScaler()
        self.feature_cols: List[str] = []
        self.target_col: str = "congestion_index"
        self.device = "cpu"

    def _get_features(self, df: pd.DataFrame) -> List[str]:
        return [f for f in GRU_SEQ_FEATURES if f in df.columns]

    def _build_sequences(
        self, df: pd.DataFrame, target_col: str
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Build (X_seq, y) arrays from sorted per-segment data."""
        df = df.sort_values(["segment_id", "timestamp"])
        feature_cols = self.feature_cols

        seqs, targets = [], []
        for seg_id, grp in df.groupby("segment_id"):
            X_seg = grp[feature_cols].fillna(0).values.astype(np.float32)
            y_seg = grp[target_col].fillna(0).values.astype(np.float32)

            for i in range(self.lookback, len(X_seg)):
                seqs.append(X_seg[i - self.lookback:i])
                targets.append(y_seg[i])

        if not seqs:
            return np.zeros((0, self.lookback, len(feature_cols))), np.zeros(0)

        return np.array(seqs), np.array(targets)

    def fit(self, df_train: pd.DataFrame, target_col: str = "congestion_index"):
        if not HAS_TORCH:
            logger.warning("PyTorch not available. GRU model skipped.")
            return self

        self.target_col = target_col
        self.feature_cols = self._get_features(df_train)

        # Fit scaler on training features
        X_flat = df_train[self.feature_cols].fillna(0).values
        self.scaler.fit(X_flat)

        df_scaled = df_train.copy()
        df_scaled[self.feature_cols] = self.scaler.transform(X_flat)

        X_seq, y = self._build_sequences(df_scaled, target_col)
        if len(X_seq) == 0:
            logger.warning("No sequences built for GRU training")
            return self

        # Limit to manageable size for hackathon
        MAX_SAMPLES = 200_000
        if len(X_seq) > MAX_SAMPLES:
            idx = np.random.choice(len(X_seq), MAX_SAMPLES, replace=False)
            X_seq, y = X_seq[idx], y[idx]

        # Train
        X_tensor = torch.FloatTensor(X_seq).to(self.device)
        y_tensor = torch.FloatTensor(y).to(self.device)

        n_features = X_seq.shape[2]
        self.model = GRUNet(n_features).to(self.device)
        optimizer = torch.optim.Adam(self.model.parameters(), lr=0.001)
        criterion = nn.HuberLoss()

        dataset = torch.utils.data.TensorDataset(X_tensor, y_tensor)
        loader = torch.utils.data.DataLoader(dataset, batch_size=512, shuffle=True)

        self.model.train()
        for epoch in range(10):  # quick training
            total_loss = 0
            for batch_X, batch_y in loader:
                optimizer.zero_grad()
                pred = self.model(batch_X)
                loss = criterion(pred, batch_y)
                loss.backward()
                optimizer.step()
                total_loss += loss.item()
            if epoch % 3 == 0:
                logger.info(f"GRU epoch {epoch}: loss={total_loss/len(loader):.4f}")

        return self

    def predict(self, df: pd.DataFrame) -> np.ndarray:
        if not HAS_TORCH or self.model is None:
            return np.zeros(len(df))

        df = df.copy()
        df_scaled = df.copy()
        feat_cols = [f for f in self.feature_cols if f in df.columns]
        if not feat_cols:
            return np.zeros(len(df))

        X_flat = df[feat_cols].fillna(0).values
        df_scaled[feat_cols] = self.scaler.transform(X_flat)

        # Use last lookback steps per segment for prediction
        preds = {}
        for seg_id, grp in df_scaled.groupby("segment_id"):
            grp_sorted = grp.sort_values("timestamp")
            X_seg = grp_sorted[feat_cols].fillna(0).values.astype(np.float32)

            # Pad if not enough history
            if len(X_seg) < self.lookback:
                pad = np.zeros((self.lookback - len(X_seg), len(feat_cols)), dtype=np.float32)
                X_seg = np.vstack([pad, X_seg])

            # Predict for each time step
            seg_preds = []
            self.model.eval()
            with torch.no_grad():
                for i in range(self.lookback, len(X_seg) + 1):
                    seq = X_seg[max(0, i - self.lookback):i]
                    if len(seq) < self.lookback:
                        seq = np.vstack([np.zeros((self.lookback - len(seq), len(feat_cols))), seq])
                    t = torch.FloatTensor(seq).unsqueeze(0).to(self.device)
                    seg_preds.append(self.model(t).item())

            preds[seg_id] = seg_preds

        # Map predictions back
        result = []
        for seg_id, grp in df.groupby("segment_id"):
            n = len(grp)
            if seg_id in preds:
                p = preds[seg_id]
                result.extend(p[-n:] if len(p) >= n else p + [p[-1]] * (n - len(p)))
            else:
                result.extend([0.0] * n)
        return np.array(result, dtype=np.float32)


# ──────────────────────────────────────────────────────────
# 4. ST-GNN FORECASTER
# ──────────────────────────────────────────────────────────

if HAS_TORCH:
    class STGNNBlock(nn.Module):
        """Simplified Spatio-Temporal GNN block: GRU + Graph attention."""
        def __init__(self, n_nodes: int, input_size: int, hidden_size: int = 64):
            super().__init__()
            self.n_nodes = n_nodes
            self.temporal = nn.GRU(input_size, hidden_size, batch_first=True)
            self.spatial_w = nn.Parameter(torch.FloatTensor(hidden_size, hidden_size))
            nn.init.xavier_uniform_(self.spatial_w)
            self.act = nn.ReLU()
            self.dropout = nn.Dropout(0.1)

        def forward(self, x: torch.Tensor, adj: torch.Tensor) -> torch.Tensor:
            # x: (batch, n_nodes, seq_len, features)
            B, N, T, F = x.shape
            x_reshaped = x.view(B * N, T, F)
            h, _ = self.temporal(x_reshaped)         # (B*N, T, hidden)
            h_last = h[:, -1, :]                      # (B*N, hidden)
            h_last = h_last.view(B, N, -1)            # (B, N, hidden)

            # Graph message passing
            h_graph = torch.bmm(adj.unsqueeze(0).expand(B, -1, -1), h_last)  # (B, N, hidden)
            h_graph = torch.matmul(h_graph, self.spatial_w)
            h_out = self.act(h_last + self.dropout(h_graph))
            return h_out  # (B, N, hidden)

    class STGNNForecaster(nn.Module):
        def __init__(self, n_nodes: int, input_size: int, hidden_size: int = 64, n_horizons: int = 4):
            super().__init__()
            self.block1 = STGNNBlock(n_nodes, input_size, hidden_size)
            self.decoder = nn.Sequential(
                nn.Linear(hidden_size, 32),
                nn.ReLU(),
                nn.Linear(32, n_horizons),
            )

        def forward(self, x: torch.Tensor, adj: torch.Tensor) -> torch.Tensor:
            h = self.block1(x, adj)                    # (B, N, hidden)
            out = self.decoder(h)                      # (B, N, n_horizons)
            return out


class STGNNModel:
    name = "st_gnn"

    def __init__(self, n_nodes: int, lookback: int = LOOKBACK_STEPS):
        self.n_nodes = n_nodes
        self.lookback = lookback
        self.model = None
        self.scaler = StandardScaler()
        self.feature_cols: List[str] = []
        self.target_col: str = "congestion_index"
        self.adj_tensor = None
        self.seg_to_idx: Dict[str, int] = {}
        self.idx_to_seg: List[str] = []
        self.device = "cpu"

    def set_graph(self, adj_matrix: np.ndarray, seg_to_idx: Dict[str, int], idx_to_seg: List[str]):
        self.adj_matrix = adj_matrix
        self.seg_to_idx = seg_to_idx
        self.idx_to_seg = idx_to_seg
        # Row-normalize adjacency
        row_sum = adj_matrix.sum(axis=1, keepdims=True)
        row_sum = np.where(row_sum == 0, 1, row_sum)
        adj_norm = adj_matrix / row_sum
        self.adj_tensor = torch.FloatTensor(adj_norm)

    def _get_features(self, df: pd.DataFrame) -> List[str]:
        return [f for f in GRU_SEQ_FEATURES if f in df.columns]

    def _build_graph_sequences(
        self, df: pd.DataFrame, target_col: str
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Build (X, y) with shape (T, N, F) and (T, N) for graph training.
        T = timesteps, N = nodes (segments), F = features.
        """
        df = df.copy()
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        timestamps = sorted(df["timestamp"].unique())

        n_nodes = len(self.idx_to_seg)
        feat_cols = self.feature_cols
        n_feats = len(feat_cols)

        # Pivot: timestamp × segment → features
        seqs, targets = [], []

        for i in range(self.lookback, len(timestamps)):
            window_ts = timestamps[i - self.lookback:i]
            target_ts = timestamps[i]

            X_window = np.zeros((self.lookback, n_nodes, n_feats), dtype=np.float32)
            y_target = np.zeros(n_nodes, dtype=np.float32)

            for t_idx, ts in enumerate(window_ts):
                ts_data = df[df["timestamp"] == ts]
                for _, row in ts_data.iterrows():
                    seg = row["segment_id"]
                    if seg in self.seg_to_idx:
                        n_idx = self.seg_to_idx[seg]
                        for f_idx, feat in enumerate(feat_cols):
                            X_window[t_idx, n_idx, f_idx] = row.get(feat, 0.0) or 0.0

            target_data = df[df["timestamp"] == target_ts]
            for _, row in target_data.iterrows():
                seg = row["segment_id"]
                if seg in self.seg_to_idx:
                    n_idx = self.seg_to_idx[seg]
                    y_target[n_idx] = row.get(target_col, 0.0) or 0.0

            seqs.append(X_window)   # (lookback, N, F)
            targets.append(y_target)

            # Limit samples to avoid memory explosion
            if len(seqs) >= 2000:
                break

        if not seqs:
            return np.zeros((0, self.lookback, n_nodes, n_feats)), np.zeros((0, n_nodes))

        X = np.array(seqs)   # (T, lookback, N, F)
        y = np.array(targets)  # (T, N)
        # Reshape X to (T, N, lookback, F)
        X = X.transpose(0, 2, 1, 3)
        return X, y

    def fit(self, df_train: pd.DataFrame, target_col: str = "congestion_index"):
        if not HAS_TORCH:
            logger.warning("PyTorch not available. ST-GNN skipped.")
            return self

        self.target_col = target_col
        self.feature_cols = self._get_features(df_train)

        if not self.seg_to_idx:
            logger.warning("Graph not set. Call set_graph() first.")
            return self

        # Scale
        X_flat = df_train[self.feature_cols].fillna(0).values
        self.scaler.fit(X_flat)
        df_scaled = df_train.copy()
        df_scaled[self.feature_cols] = self.scaler.transform(X_flat)

        logger.info("Building ST-GNN sequences...")
        X_seq, y = self._build_graph_sequences(df_scaled, target_col)

        if len(X_seq) == 0:
            logger.warning("No sequences for ST-GNN")
            return self

        n_feats = len(self.feature_cols)
        n_nodes = len(self.idx_to_seg)

        self.model = STGNNForecaster(n_nodes, n_feats, hidden_size=64, n_horizons=1).to(self.device)
        optimizer = torch.optim.Adam(self.model.parameters(), lr=0.001)
        criterion = nn.HuberLoss()

        X_tensor = torch.FloatTensor(X_seq).to(self.device)
        y_tensor = torch.FloatTensor(y).to(self.device)
        adj = self.adj_tensor.to(self.device)

        dataset = torch.utils.data.TensorDataset(X_tensor, y_tensor)
        loader = torch.utils.data.DataLoader(dataset, batch_size=16, shuffle=True)

        self.model.train()
        for epoch in range(5):
            total_loss = 0
            for batch_X, batch_y in loader:
                optimizer.zero_grad()
                pred = self.model(batch_X, adj)  # (B, N, 1)
                pred = pred.squeeze(-1)          # (B, N)
                loss = criterion(pred, batch_y)
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
                optimizer.step()
                total_loss += loss.item()
            logger.info(f"ST-GNN epoch {epoch}: loss={total_loss/len(loader):.4f}")

        return self

    def predict_all_segments(self, df: pd.DataFrame) -> Dict[str, float]:
        """Predict congestion for all segments at current time."""
        if not HAS_TORCH or self.model is None:
            return {}

        df = df.copy()
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df_scaled = df.copy()
        feat_cols = [f for f in self.feature_cols if f in df.columns]
        if feat_cols:
            df_scaled[feat_cols] = self.scaler.transform(df[feat_cols].fillna(0).values)

        timestamps = sorted(df["timestamp"].unique())
        if len(timestamps) < self.lookback:
            return {}

        n_nodes = len(self.idx_to_seg)
        n_feats = len(self.feature_cols)
        window_ts = timestamps[-self.lookback:]

        X_window = np.zeros((1, n_nodes, self.lookback, n_feats), dtype=np.float32)
        for t_idx, ts in enumerate(window_ts):
            ts_data = df_scaled[df_scaled["timestamp"] == ts]
            for _, row in ts_data.iterrows():
                seg = row["segment_id"]
                if seg in self.seg_to_idx:
                    n_idx = self.seg_to_idx[seg]
                    for f_idx, feat in enumerate(self.feature_cols):
                        X_window[0, n_idx, t_idx, f_idx] = row.get(feat, 0.0) or 0.0

        self.model.eval()
        adj = self.adj_tensor.to(self.device)
        with torch.no_grad():
            pred = self.model(
                torch.FloatTensor(X_window).to(self.device), adj
            ).squeeze(-1).cpu().numpy()  # (1, N)

        return {self.idx_to_seg[i]: float(pred[0, i]) for i in range(n_nodes)}


# ──────────────────────────────────────────────────────────
# MODEL BENCHMARK & SELECTION
# ──────────────────────────────────────────────────────────

def evaluate_forecast_model(
    model,
    df_val: pd.DataFrame,
    y_val: np.ndarray,
    target_col: str,
    horizon: int,
    split_labels: Optional[Dict[str, np.ndarray]] = None,
) -> Dict:
    """Evaluate a forecasting model on validation set."""
    try:
        if hasattr(model, 'predict') and not isinstance(model, STGNNModel):
            y_pred = model.predict(df_val)
        elif isinstance(model, HistoricalBaseline):
            y_pred = model.predict(df_val)
        else:
            return {"error": "unknown model type"}
    except Exception as e:
        logger.error(f"Evaluation failed for {model.name}: {e}")
        return {"error": str(e)}

    # Align lengths
    min_len = min(len(y_val), len(y_pred))
    y_val, y_pred = y_val[:min_len], y_pred[:min_len]

    base_metrics = {
        "model": model.name,
        "horizon_minutes": horizon,
        "mae": mae(y_val, y_pred),
        "rmse": rmse(y_val, y_pred),
        "smape": smape(y_val, y_pred),
    }

    # Segment performance by period
    if split_labels is not None:
        for period_name, period_mask in split_labels.items():
            m = period_mask[:min_len].astype(bool)
            if m.sum() > 0:
                base_metrics[f"mae_{period_name}"] = mae(y_val[m], y_pred[m])
                base_metrics[f"rmse_{period_name}"] = rmse(y_val[m], y_pred[m])

    return base_metrics


def save_forecast_model(model, model_name: str, horizon: int, metrics: Dict):
    """Save a forecast model artifact."""
    path = MODEL_DIR / f"forecast_{model_name}_h{horizon}.pkl"
    joblib.dump({"model": model, "metrics": metrics}, path)
    logger.info(f"Saved forecast model: {path}")
    return path


def load_forecast_model(model_name: str, horizon: int) -> Optional[Dict]:
    """Load a saved forecast model."""
    path = MODEL_DIR / f"forecast_{model_name}_h{horizon}.pkl"
    if not path.exists():
        return None
    return joblib.load(path)


def load_best_forecast_models() -> Dict[int, Any]:
    """Load the best forecast model for each horizon."""
    best = {}
    metrics_path = Path("./artifacts/forecast_metrics.json")

    if metrics_path.exists():
        with open(metrics_path) as f:
            all_metrics = json.load(f)

        for horizon in HORIZONS:
            best_model_name = None
            best_mae = float("inf")

            for m in all_metrics:
                if m.get("horizon_minutes") == horizon and m.get("mae", float("inf")) < best_mae:
                    best_mae = m["mae"]
                    best_model_name = m["model"]

            if best_model_name:
                payload = load_forecast_model(best_model_name, horizon)
                if payload:
                    best[horizon] = payload["model"]

    return best
