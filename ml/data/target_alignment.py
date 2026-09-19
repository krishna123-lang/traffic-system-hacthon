"""
Forecast Target Alignment Layer.

Inspects the actual structure of forecast_targets_train.csv and
forecast_targets_validation.csv, then normalizes them into a standard
long-format representation:

  segment_id | origin_timestamp | horizon_minutes | target_variable | target_value

NEVER used as model input features — only as training labels.
"""

from __future__ import annotations
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import polars as pl
import pandas as pd
import numpy as np

from ml.data.ingestion import load_forecast_targets, load_traffic, CACHE_DIR

logger = logging.getLogger(__name__)

# Supported horizons
HORIZONS_MINUTES = [15, 30, 45, 60]


def inspect_target_schema(split: str = "train") -> Dict:
    """Inspect the actual column structure of forecast targets."""
    df = load_forecast_targets(split)
    schema_info = {
        "columns": df.columns,
        "dtypes": {col: str(df[col].dtype) for col in df.columns},
        "n_rows": len(df),
        "sample": df.head(3).to_pandas().to_dict(),
    }

    # Detect timestamp column
    ts_candidates = [c for c in df.columns if "time" in c.lower() or "ts" in c.lower() or c == "timestamp"]
    schema_info["timestamp_col"] = ts_candidates[0] if ts_candidates else None

    # Detect segment_id column
    seg_candidates = [c for c in df.columns if "segment" in c.lower() or c == "id"]
    schema_info["segment_col"] = seg_candidates[0] if seg_candidates else None

    # Detect horizon columns (e.g., speed_15, flow_30, target_15min, etc.)
    horizon_cols = {}
    for col in df.columns:
        for h in HORIZONS_MINUTES:
            if str(h) in col:
                if h not in horizon_cols:
                    horizon_cols[h] = []
                horizon_cols[h].append(col)

    schema_info["horizon_cols"] = horizon_cols

    logger.info(f"Target schema for {split}: {schema_info}")
    return schema_info


def align_targets(split: str = "train", use_cache: bool = True) -> pl.DataFrame:
    """
    Normalize forecast targets into standard long format.

    Detects column structure automatically and maps to:
      segment_id | origin_timestamp | horizon_minutes | target_variable | target_value
    """
    cache = CACHE_DIR / f"aligned_targets_{split}.parquet"
    if use_cache and cache.exists():
        logger.info(f"Loading aligned targets from cache: {cache}")
        return pl.read_parquet(cache)

    logger.info(f"Aligning forecast targets for {split}...")
    df = load_forecast_targets(split)
    schema = inspect_target_schema(split)

    ts_col = schema["timestamp_col"]
    seg_col = schema["segment_col"]
    horizon_cols = schema["horizon_cols"]

    # Build long-format target dataframe
    records = []

    if horizon_cols:
        # Wide format: columns like target_speed_15m, target_congestion_30m, etc.
        for h, cols in horizon_cols.items():
            for col in cols:
                # Determine variable name:
                # "target_speed_15m"   -> "speed"
                # "target_flow_30m"    -> "flow"
                # "target_congestion_45m" -> "congestion"
                import re
                # Strip leading "target_" prefix, then strip trailing "_<digits>m" suffix
                var_name = re.sub(r'^target_?', '', col)
                var_name = re.sub(r'_?\d+m?$', '', var_name)
                var_name = var_name.strip('_').strip()
                if not var_name:
                    var_name = "target"

                sub = df.select([ts_col, seg_col, col]).rename({
                    ts_col: "origin_timestamp",
                    seg_col: "segment_id",
                    col: "target_value",
                }).with_columns([
                    pl.lit(h).alias("horizon_minutes"),
                    pl.lit(var_name).alias("target_variable"),
                ])
                records.append(sub)
    else:
        # Maybe the file is already in long format or has different structure
        # Try to identify a "horizon" column directly
        horizon_col_candidates = [c for c in df.columns if "horizon" in c.lower() or "h_" in c.lower()]
        value_col_candidates = [c for c in df.columns
                                 if c not in [ts_col, seg_col] + horizon_col_candidates
                                 and df[c].dtype in [pl.Float32, pl.Float64, pl.Int32, pl.Int64]]

        if horizon_col_candidates and value_col_candidates:
            for vc in value_col_candidates:
                sub = df.select([ts_col, seg_col, horizon_col_candidates[0], vc]).rename({
                    ts_col: "origin_timestamp",
                    seg_col: "segment_id",
                    horizon_col_candidates[0]: "horizon_minutes",
                    vc: "target_value",
                }).with_columns(pl.lit(vc).alias("target_variable"))
                records.append(sub)
        else:
            # Fallback: treat all numeric non-id columns as targets at unknown horizon
            logger.warning("Could not detect horizon structure. Using all numeric columns as h=15 targets.")
            for col in df.columns:
                if col in [ts_col, seg_col]:
                    continue
                if df[col].dtype in [pl.Float32, pl.Float64, pl.Int32, pl.Int64]:
                    sub = df.select([ts_col, seg_col, col]).rename({
                        ts_col: "origin_timestamp",
                        seg_col: "segment_id",
                        col: "target_value",
                    }).with_columns([
                        pl.lit(15).alias("horizon_minutes"),
                        pl.lit(col).alias("target_variable"),
                    ])
                    records.append(sub)

    if not records:
        raise ValueError(f"Could not extract any targets from forecast_targets_{split}.csv")

    aligned = pl.concat(records)

    # Ensure types
    aligned = aligned.with_columns([
        pl.col("horizon_minutes").cast(pl.Int32),
        pl.col("target_value").cast(pl.Float32),
    ])

    logger.info(f"Aligned targets: {len(aligned):,} rows, horizons: {aligned['horizon_minutes'].unique().to_list()}")
    aligned.write_parquet(cache, compression="zstd")
    return aligned


def get_targets_for_training(
    features_df: pl.DataFrame,
    split: str = "train",
    target_variable: str = "congestion_index",
    horizon_minutes: int = 15,
) -> Tuple[pd.DataFrame, pd.Series]:
    """
    Join features with aligned targets to produce (X, y) for model training.

    Uses chronological order — no random shuffling at join stage.
    Features and targets are aligned by segment_id + timestamp.
    """
    targets = align_targets(split)

    # Filter to desired horizon and variable
    target_filter = targets.filter(
        (pl.col("horizon_minutes") == horizon_minutes) &
        (pl.col("target_variable") == target_variable)
    )

    if len(target_filter) == 0:
        # Try the first available variable
        available = targets["target_variable"].unique().to_list()
        logger.warning(f"No targets for variable '{target_variable}'. Available: {available}. Using first.")
        target_variable = available[0]
        target_filter = targets.filter(
            (pl.col("horizon_minutes") == horizon_minutes) &
            (pl.col("target_variable") == target_variable)
        )

    # Join features with targets
    target_filter = target_filter.rename({"origin_timestamp": "timestamp"})
    merged = features_df.join(
        target_filter.select(["segment_id", "timestamp", "target_value"]),
        on=["segment_id", "timestamp"],
        how="inner",
    ).drop_nulls(subset=["target_value"])

    return merged, target_variable


def get_primary_target_variable(split: str = "train") -> str:
    """Detect the primary target variable to predict."""
    targets = align_targets(split)
    variables = targets["target_variable"].unique().to_list()

    # Prefer congestion index or speed in that order
    preferred = ["congestion", "speed", "flow", "congestion_index", "speed_kmh", "flow_vph"]
    for pref in preferred:
        if pref in variables:
            return pref
    # Try partial match
    for pref in ["congestion", "speed", "flow"]:
        for v in variables:
            if pref in v.lower():
                return v

    return variables[0] if variables else "congestion"
