"""
FlowGuard AI — Application State Service.

Loads and caches all data/models at startup.
Provides a single shared state object for all routes.
"""

from __future__ import annotations
import json
import logging
import os
import pickle
from pathlib import Path
from typing import Dict, List, Optional, Any
from datetime import datetime

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Paths
BASE_DIR = Path(__file__).parent.parent.parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR", str(BASE_DIR / "data")))
MODEL_DIR = Path(os.environ.get("MODEL_DIR", str(BASE_DIR / "models")))
ARTIFACTS_DIR = Path(os.environ.get("MODEL_DIR", str(BASE_DIR / "models"))).parent / "artifacts"
CACHE_DIR = MODEL_DIR.parent / "cache"

sys_path_added = False


def _ensure_ml_path():
    global sys_path_added
    if not sys_path_added:
        import sys
        root = str(BASE_DIR)
        if root not in sys.path:
            sys.path.insert(0, root)
        sys_path_added = True


class AppState:
    """Singleton application state — loaded once at startup."""

    def __init__(self):
        self.loaded = False
        self.network_df: Optional[pd.DataFrame] = None
        self.nodes_df: Optional[pd.DataFrame] = None
        self.physical_graph = None
        self.seg_graph = None
        self.seg_to_idx: Dict[str, int] = {}
        self.idx_to_seg: List[str] = []
        self.adj_matrix: Optional[np.ndarray] = None
        self.seg_centrality: Dict[str, float] = {}

        self.incident_model_payload: Optional[Dict] = None
        self.forecast_models: Dict[int, Any] = {}  # horizon → model
        self.best_forecast_model_names: Dict[int, str] = {}

        self.traffic_cache: Optional[pd.DataFrame] = None
        self.current_snapshot_ts: Optional[str] = None
        self.current_state: Dict[str, Dict] = {}

        self.incidents_df: Optional[pd.DataFrame] = None
        self.roadworks_df: Optional[pd.DataFrame] = None
        self.planning_df: Optional[pd.DataFrame] = None
        self.signal_plans_df: Optional[pd.DataFrame] = None
        self.turn_restrictions_df: Optional[pd.DataFrame] = None

        self.demo_scenario: Optional[Dict] = None
        self.demo_step: int = 0

        self.data_health: Dict = {}
        self.forecast_metrics: List[Dict] = []
        self.incident_metrics: List[Dict] = []

    def load(self):
        """Load all models and data into memory."""
        _ensure_ml_path()

        logger.info("Loading AppState...")

        try:
            from ml.data.graph_builder import build_graphs
            graphs = build_graphs(use_cache=True)
            self.physical_graph = graphs["physical_graph"]
            self.seg_graph = graphs["seg_graph"]
            self.seg_to_idx = graphs["seg_to_idx"]
            self.idx_to_seg = graphs["idx_to_seg"]
            self.adj_matrix = graphs["adj_matrix"]
            self.seg_centrality = graphs.get("seg_centrality", {})
            self.network_df = graphs["network_df"]
            self.nodes_df = graphs["nodes_df"]
            logger.info(f"Graph loaded: {len(self.idx_to_seg)} segments")
        except Exception as e:
            logger.error(f"Graph load failed: {e}")
            self._load_fallback_network()

        # Load incident model
        try:
            from ml.incidents.detector import load_incident_model
            self.incident_model_payload = load_incident_model()
            if self.incident_model_payload:
                logger.info("Incident model loaded")
        except Exception as e:
            logger.warning(f"Incident model not loaded: {e}")

        # Load forecast models
        try:
            from ml.forecasting.models import load_forecast_model, load_best_forecast_models, HORIZONS
            for h in HORIZONS:
                for model_name in ["xgboost", "gru", "st_gnn", "historical_baseline"]:
                    payload = load_forecast_model(model_name, h)
                    if payload and h not in self.forecast_models:
                        self.forecast_models[h] = payload["model"]
                        self.best_forecast_model_names[h] = model_name
            logger.info(f"Forecast models loaded for horizons: {list(self.forecast_models.keys())}")
        except Exception as e:
            logger.warning(f"Forecast models not loaded: {e}")

        # Load optional data files
        try:
            from ml.data.ingestion import (
                load_incidents, load_roadworks, load_planning_candidates,
                load_signal_plans, load_turn_restrictions
            )
            self.incidents_df = load_incidents("train")
            self.roadworks_df = load_roadworks("train")
            self.planning_df = load_planning_candidates()
            self.signal_plans_df = load_signal_plans()
            self.turn_restrictions_df = load_turn_restrictions()
        except Exception as e:
            logger.warning(f"Optional data load warning: {e}")

        # Load recent traffic snapshot for "current" state
        self._load_current_state()

        # Load demo scenario
        self._load_demo_scenario()

        # Load metrics
        self._load_metrics()

        # Load data health
        self._load_data_health()

        self.loaded = True
        logger.info("AppState loaded successfully")

    def _load_fallback_network(self):
        """Load network from CSV if graph build fails."""
        try:
            self.network_df = pd.read_csv(DATA_DIR / "network.csv")
            self.nodes_df = pd.read_csv(DATA_DIR / "nodes.csv")
            self.idx_to_seg = self.network_df["segment_id"].tolist()
            self.seg_to_idx = {s: i for i, s in enumerate(self.idx_to_seg)}
            logger.info(f"Fallback network loaded: {len(self.idx_to_seg)} segments")
        except Exception as e:
            logger.error(f"Fallback network load failed: {e}")

    def _load_current_state(self):
        """Load a recent traffic snapshot as current state."""
        try:
            from ml.data.ingestion import load_traffic
            import polars as pl

            df = load_traffic("validation", use_cache=True)

            # Use first timestamp as initial state
            first_ts = df["timestamp"].min()
            snapshot = df.filter(pl.col("timestamp") == first_ts)

            for row in snapshot.to_dicts():
                seg_id = row["segment_id"]
                net_row = self.network_df[self.network_df["segment_id"] == seg_id] if self.network_df is not None else pd.DataFrame()
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
                cong_score = max(0.0, min(cong_score, 1.0))

                self.current_state[seg_id] = {
                    "speed_kmh": speed,
                    "flow_vph": flow,
                    "occupancy_pct": occ,
                    "travel_time_min": tt,
                    "delay_min": max(row.get("delay_min") or 0, 0),
                    "queue_length_veh": max(row.get("queue_length_veh") or 0, 0),
                    "congestion_index": ci,
                    "congestion_score": cong_score,
                    "congestion_state": _get_state_label(cong_score),
                    "flow_utilization": flow_util,
                }

            self.current_snapshot_ts = str(first_ts)
            logger.info(f"Current state loaded: {len(self.current_state)} segments at {first_ts}")
        except Exception as e:
            logger.error(f"Current state load failed: {e}")

    def _load_demo_scenario(self):
        """Load pre-computed demo scenario."""
        scenario_path = ARTIFACTS_DIR / "demo_scenario.json"
        if scenario_path.exists():
            try:
                with open(scenario_path) as f:
                    self.demo_scenario = json.load(f)
                logger.info(f"Demo scenario loaded: {self.demo_scenario.get('total_steps', 0)} steps")
            except Exception as e:
                logger.warning(f"Demo scenario load failed: {e}")

    def _load_metrics(self):
        """Load model metrics from artifacts."""
        try:
            fm_path = ARTIFACTS_DIR / "forecast_metrics.json"
            if fm_path.exists():
                self.forecast_metrics = json.loads(fm_path.read_text())
        except Exception:
            pass

        try:
            im_path = ARTIFACTS_DIR / "incident_metrics.json"
            if im_path.exists():
                data = json.loads(im_path.read_text())
                self.incident_metrics = data if isinstance(data, list) else [data]
        except Exception:
            pass

    def _load_data_health(self):
        """Load data health report."""
        try:
            hp = ARTIFACTS_DIR / "data_health.json"
            if hp.exists():
                self.data_health = json.loads(hp.read_text())
        except Exception:
            pass

    def get_state_at_timestamp(self, timestamp_str: str) -> Dict[str, Dict]:
        """Load traffic state for a specific timestamp from validation data."""
        try:
            from ml.data.ingestion import load_traffic
            import polars as pl
            df = load_traffic("validation", use_cache=True)
            ts_filter = df.filter(pl.col("timestamp") == pl.lit(timestamp_str).str.to_datetime())
            if len(ts_filter) == 0:
                return self.current_state
            state = {}
            for row in ts_filter.to_dicts():
                seg_id = row["segment_id"]
                ci = max(row.get("congestion_index") or 0, 0)
                state[seg_id] = {
                    "speed_kmh": max(row.get("speed_kmh") or 0, 0),
                    "flow_vph": max(row.get("flow_vph") or 0, 0),
                    "occupancy_pct": max(row.get("occupancy_pct") or 0, 0),
                    "congestion_score": min(ci, 1.0),
                    "congestion_state": _get_state_label(min(ci, 1.0)),
                    "delay_min": max(row.get("delay_min") or 0, 0),
                    "queue_length_veh": max(row.get("queue_length_veh") or 0, 0),
                }
            return state
        except Exception as e:
            logger.error(f"State at timestamp failed: {e}")
            return self.current_state


def _get_state_label(score: float) -> str:
    if score >= 0.9:
        return "incident"
    elif score >= 0.75:
        return "severe"
    elif score >= 0.6:
        return "high"
    elif score >= 0.4:
        return "moderate"
    elif score >= 0.2:
        return "low_risk"
    return "normal"


# Global singleton
app_state = AppState()
