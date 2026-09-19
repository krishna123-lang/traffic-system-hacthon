"""
Data ingestion: loads CSV → Polars → Parquet cache.
Memory-efficient pipeline for 1.88M row dataset.
"""

from __future__ import annotations
import os
import logging
from pathlib import Path
from typing import Optional, Dict, Any

import polars as pl
import pandas as pd
import numpy as np

from ml.data.schema_adapter import (
    TRAFFIC_COLS, NETWORK_COLS, NODE_COLS, INCIDENT_COLS,
    CONTEXT_COLS, ROADWORK_COLS, PLANNING_COLS, verify_interval
)

logger = logging.getLogger(__name__)

DATA_DIR = Path(os.getenv("DATA_DIR", "./data"))
CACHE_DIR = Path(os.getenv("MODEL_DIR", "./models")).parent / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _cache_path(name: str) -> Path:
    return CACHE_DIR / f"{name}.parquet"


def load_traffic(split: str = "train", use_cache: bool = True) -> pl.DataFrame:
    """Load traffic observations. Returns Polars DataFrame."""
    fname = f"traffic_{split}.csv"
    cache = _cache_path(f"traffic_{split}")

    if use_cache and cache.exists():
        logger.info(f"Loading traffic {split} from cache: {cache}")
        return pl.read_parquet(cache)

    fpath = DATA_DIR / fname
    if not fpath.exists():
        raise FileNotFoundError(f"Traffic file not found: {fpath}")

    logger.info(f"Loading {fpath} with Polars...")
    df = pl.read_csv(
        fpath,
        try_parse_dates=True,
        null_values=["", "NA", "NaN", "null", "NULL", "-999", "-1"],
        infer_schema_length=5000,
    )

    # Ensure timestamp column is datetime
    if df["timestamp"].dtype == pl.Utf8:
        df = df.with_columns(
            pl.col("timestamp").str.to_datetime(format="%Y-%m-%d %H:%M:%S", strict=False)
        )

    logger.info(f"Loaded {len(df):,} rows. Caching to parquet...")
    df.write_parquet(cache, compression="zstd")
    return df


def load_forecast_targets(split: str = "train", use_cache: bool = True) -> pl.DataFrame:
    """Load forecast targets — LABELS ONLY, never used as input features."""
    fname = f"forecast_targets_{split}.csv"
    cache = _cache_path(f"forecast_targets_{split}")

    if use_cache and cache.exists():
        return pl.read_parquet(cache)

    fpath = DATA_DIR / fname
    if not fpath.exists():
        raise FileNotFoundError(f"Forecast targets not found: {fpath}")

    logger.info(f"Loading forecast targets {split}...")
    df = pl.read_csv(
        fpath,
        try_parse_dates=True,
        null_values=["", "NA", "NaN", "null", "NULL", "-999"],
        infer_schema_length=5000,
    )
    if df["timestamp"].dtype == pl.Utf8:
        df = df.with_columns(
            pl.col("timestamp").str.to_datetime(format="%Y-%m-%d %H:%M:%S", strict=False)
        )
    df.write_parquet(cache, compression="zstd")
    return df


def load_network() -> pd.DataFrame:
    fpath = DATA_DIR / "network.csv"
    df = pd.read_csv(fpath)
    return df


def load_nodes() -> pd.DataFrame:
    fpath = DATA_DIR / "nodes.csv"
    df = pd.read_csv(fpath)
    return df


def _load_optional(fname: str, date_cols: Optional[list] = None) -> Optional[pd.DataFrame]:
    fpath = DATA_DIR / fname
    if not fpath.exists():
        logger.warning(f"Optional file not found: {fpath}")
        return None
    df = pd.read_csv(fpath, parse_dates=date_cols or [])
    logger.info(f"Loaded optional file: {fname} ({len(df)} rows)")
    return df


def load_incidents(split: str = "train") -> Optional[pd.DataFrame]:
    return _load_optional(f"incidents_{split}.csv", date_cols=["start_time", "end_time"])


def load_context(split: str = "train") -> Optional[pd.DataFrame]:
    df = _load_optional(f"context_{split}.csv", date_cols=["timestamp"])
    return df


def load_roadworks(split: str = "train") -> Optional[pd.DataFrame]:
    return _load_optional(f"roadworks_{split}.csv", date_cols=["start_time", "end_time"])


def load_planning_candidates() -> Optional[pd.DataFrame]:
    return _load_optional("planning_candidates.csv")


def load_signal_plans() -> Optional[pd.DataFrame]:
    return _load_optional("signal_plans.csv")


def load_turn_restrictions() -> Optional[pd.DataFrame]:
    return _load_optional("turn_restrictions.csv")


def load_od_demand() -> Optional[pd.DataFrame]:
    return _load_optional("od_demand_profiles.csv")


def load_scenario_examples() -> Optional[pd.DataFrame]:
    return _load_optional("scenario_examples.csv")


def get_time_interval(split: str = "train") -> int:
    """Verify actual time interval from the dataset."""
    df = load_traffic(split)
    # Sample one segment to detect interval
    seg = df["segment_id"][0]
    seg_df = df.filter(pl.col("segment_id") == seg).sort("timestamp")
    timestamps = seg_df["timestamp"].to_pandas()
    interval = verify_interval(timestamps)
    logger.info(f"Detected time interval: {interval} minutes")
    return interval


def get_data_health_report() -> Dict[str, Any]:
    """Generate data health metrics for the dashboard."""
    report = {}

    # Traffic train
    try:
        df = load_traffic("train")
        report["traffic_train"] = {
            "rows": len(df),
            "segments": df["segment_id"].n_unique(),
            "missing_pct": {
                col: round(df[col].is_null().sum() / len(df) * 100, 2)
                for col in df.columns
                if df[col].is_null().sum() > 0
            },
            "time_range": {
                "start": str(df["timestamp"].min()),
                "end": str(df["timestamp"].max()),
            },
            "status": "ok",
        }
    except Exception as e:
        report["traffic_train"] = {"status": "error", "message": str(e)}

    # Traffic validation
    try:
        df = load_traffic("validation")
        report["traffic_validation"] = {
            "rows": len(df),
            "segments": df["segment_id"].n_unique(),
            "status": "ok",
        }
    except Exception as e:
        report["traffic_validation"] = {"status": "error", "message": str(e)}

    # Optional files
    optional_files = {
        "incidents_train": ("incidents_train.csv", ["start_time", "end_time"]),
        "context_train": ("context_train.csv", ["timestamp"]),
        "roadworks_train": ("roadworks_train.csv", ["start_time", "end_time"]),
        "planning_candidates": ("planning_candidates.csv", []),
        "signal_plans": ("signal_plans.csv", []),
        "turn_restrictions": ("turn_restrictions.csv", []),
        "od_demand_profiles": ("od_demand_profiles.csv", []),
        "scenario_examples": ("scenario_examples.csv", []),
    }

    for key, (fname, _) in optional_files.items():
        fpath = DATA_DIR / fname
        if fpath.exists():
            try:
                df = pd.read_csv(fpath)
                report[key] = {"rows": len(df), "status": "ok"}
            except Exception as e:
                report[key] = {"status": "error", "message": str(e)}
        else:
            report[key] = {"status": "unavailable"}

    return report
