"""
Feature engineering pipeline.
Builds features from traffic observations + context + incidents + roadworks.
Saves to Parquet cache for reuse.

IMPORTANT: Never uses forecast_targets_*.csv as input.
"""

from __future__ import annotations
import logging
from pathlib import Path
from typing import Optional, Tuple

import polars as pl
import pandas as pd
import numpy as np

from ml.data.ingestion import (
    load_traffic, load_context, load_incidents, load_roadworks,
    load_network, get_time_interval, CACHE_DIR
)

logger = logging.getLogger(__name__)

# Feature windows in steps (5-min intervals)
ROLLING_WINDOWS = [3, 6, 12]   # 15, 30, 60 min
LAG_STEPS = [1, 3, 6, 12]      # 5, 15, 30, 60 min


def build_time_features(df: pl.DataFrame) -> pl.DataFrame:
    """Add time-based features."""
    df = df.with_columns([
        pl.col("timestamp").dt.hour().alias("hour"),
        pl.col("timestamp").dt.weekday().alias("day_of_week"),  # 0=Mon
        pl.col("timestamp").dt.minute().alias("minute"),
        (pl.col("timestamp").dt.weekday() >= 5).alias("is_weekend"),
    ])
    # Peak hour flag (7-9 AM, 5-7 PM)
    df = df.with_columns([
        (
            ((pl.col("hour") >= 7) & (pl.col("hour") < 10)) |
            ((pl.col("hour") >= 17) & (pl.col("hour") < 20))
        ).alias("is_peak"),
    ])
    return df


def build_congestion_features(df: pl.DataFrame, network_df: pd.DataFrame) -> pl.DataFrame:
    """Add capacity utilization and congestion-derived features."""
    # Join network capacity info
    net = pl.from_pandas(network_df[["segment_id", "capacity_vph", "free_flow_speed_kmh",
                                      "lanes", "structural_bottleneck", "importance",
                                      "length_km", "peak_capacity_factor"]])
    df = df.join(net, on="segment_id", how="left")

    df = df.with_columns([
        # Speed ratio vs free-flow
        (pl.col("speed_kmh") / pl.col("free_flow_speed_kmh").clip(1.0)).alias("speed_ratio"),
        # Flow capacity utilization
        (pl.col("flow_vph") / pl.col("capacity_vph").clip(1.0)).alias("flow_utilization"),
        # Effective travel time ratio
        (pl.col("travel_time_min") / pl.col("free_flow_time_min").clip(0.1)).alias("tt_ratio"),
    ])

    # Composite congestion score (0-1)
    df = df.with_columns([
        (
            0.35 * (1.0 - pl.col("speed_ratio").clip(0.0, 1.0)) +
            0.30 * pl.col("flow_utilization").clip(0.0, 1.0) +
            0.20 * pl.col("occupancy_pct").clip(0.0, 100.0) / 100.0 +
            0.15 * (pl.col("tt_ratio").clip(1.0, 5.0) - 1.0) / 4.0
        ).alias("congestion_score"),
    ])
    return df


def build_rolling_features(df: pl.DataFrame, windows: list = ROLLING_WINDOWS) -> pl.DataFrame:
    """Rolling statistics per segment, sorted by time."""
    df = df.sort(["segment_id", "timestamp"])

    feature_cols = ["speed_kmh", "flow_vph", "occupancy_pct", "congestion_index", "congestion_score"]

    for w in windows:
        for col in feature_cols:
            if col not in df.columns:
                continue
            df = df.with_columns([
                pl.col(col).rolling_mean(window_size=w).over("segment_id").alias(f"{col}_roll_mean_{w}"),
                pl.col(col).rolling_std(window_size=w).over("segment_id").alias(f"{col}_roll_std_{w}"),
            ])
    return df


def build_lag_features(df: pl.DataFrame, lags: list = LAG_STEPS) -> pl.DataFrame:
    """Lag features per segment."""
    df = df.sort(["segment_id", "timestamp"])
    feature_cols = ["speed_kmh", "flow_vph", "occupancy_pct", "congestion_index", "congestion_score"]

    for lag in lags:
        for col in feature_cols:
            if col not in df.columns:
                continue
            df = df.with_columns([
                pl.col(col).shift(lag).over("segment_id").alias(f"{col}_lag{lag}"),
            ])
    return df


def join_context(df: pl.DataFrame, context_df: Optional[pd.DataFrame]) -> pl.DataFrame:
    """Join contextual features (weather, events, holidays)."""
    if context_df is None:
        logger.warning("No context data available, skipping context join")
        return df

    ctx = pl.from_pandas(context_df)
    # Ensure datetime
    if ctx["timestamp"].dtype != pl.Datetime:
        ctx = ctx.with_columns(
            pl.col("timestamp").str.to_datetime(format="%Y-%m-%d %H:%M:%S", strict=False)
        )

    ctx_cols = [c for c in ctx.columns if c != "timestamp"]
    # Normalize datetime precision to microseconds
    df = df.with_columns(pl.col("timestamp").cast(pl.Datetime("us")))
    ctx = ctx.with_columns(pl.col("timestamp").cast(pl.Datetime("us")))
    df = df.join(ctx.select(["timestamp"] + ctx_cols), on="timestamp", how="left")
    return df


def build_incident_flags(
    df: pl.DataFrame,
    incidents_df: Optional[pd.DataFrame]
) -> pl.DataFrame:
    """Mark rows as active-incident rows based on incident time windows."""
    df = df.with_columns([
        pl.lit(0).alias("incident_active"),
        pl.lit(0).alias("incident_severity"),
        pl.lit("none").alias("incident_type_label"),
    ])

    if incidents_df is None or len(incidents_df) == 0:
        return df

    # Build a per-(segment, timestamp) incident mask
    rows = []
    for _, inc in incidents_df.iterrows():
        rows.append({
            "segment_id": inc["segment_id"],
            "start_time": pd.Timestamp(inc["start_time"]),
            "end_time": pd.Timestamp(inc["end_time"]),
            "severity": int(inc["severity"]),
            "incident_type": str(inc["incident_type"]),
        })

    # Convert to polars for join
    inc_pl = pl.DataFrame(rows).with_columns([
        pl.col("start_time").cast(pl.Datetime),
        pl.col("end_time").cast(pl.Datetime),
    ])

    # Mark incidents via cross-join filter (small incidents table)
    df_pd = df.to_pandas()
    df_pd["timestamp"] = pd.to_datetime(df_pd["timestamp"])
    df_pd["incident_active"] = 0
    df_pd["incident_severity"] = 0
    df_pd["incident_type_label"] = "none"

    for _, inc in incidents_df.iterrows():
        mask = (
            (df_pd["segment_id"] == inc["segment_id"]) &
            (df_pd["timestamp"] >= pd.Timestamp(inc["start_time"])) &
            (df_pd["timestamp"] <= pd.Timestamp(inc["end_time"]))
        )
        df_pd.loc[mask, "incident_active"] = 1
        df_pd.loc[mask, "incident_severity"] = int(inc["severity"])
        df_pd.loc[mask, "incident_type_label"] = str(inc["incident_type"])

    return pl.from_pandas(df_pd)


def build_roadwork_flags(
    df: pl.DataFrame,
    roadworks_df: Optional[pd.DataFrame]
) -> pl.DataFrame:
    """Mark rows where active roadworks exist on the segment."""
    df = df.with_columns([
        pl.lit(0).alias("roadwork_active"),
        pl.lit(0.0).alias("roadwork_closure_fraction"),
    ])

    if roadworks_df is None or len(roadworks_df) == 0:
        return df

    df_pd = df.to_pandas()
    df_pd["timestamp"] = pd.to_datetime(df_pd["timestamp"])
    df_pd["roadwork_active"] = 0
    df_pd["roadwork_closure_fraction"] = 0.0

    for _, rw in roadworks_df.iterrows():
        mask = (
            (df_pd["segment_id"] == rw["segment_id"]) &
            (df_pd["timestamp"] >= pd.Timestamp(rw["start_time"])) &
            (df_pd["timestamp"] <= pd.Timestamp(rw["end_time"]))
        )
        df_pd.loc[mask, "roadwork_active"] = 1
        df_pd.loc[mask, "roadwork_closure_fraction"] = float(rw.get("closure_fraction", 0.0))

    return pl.from_pandas(df_pd)


def build_features(split: str = "train", use_cache: bool = True) -> pl.DataFrame:
    """
    Full feature engineering pipeline.
    Returns feature DataFrame (never contains forecast target values).
    """
    cache = CACHE_DIR / f"features_{split}.parquet"
    if use_cache and cache.exists():
        logger.info(f"Loading features from cache: {cache}")
        return pl.read_parquet(cache)

    logger.info(f"Building features for {split} split...")

    # 1. Load base traffic
    df = load_traffic(split)
    network_df = load_network()
    context_df = load_context(split)
    incidents_df = load_incidents(split)
    roadworks_df = load_roadworks(split)

    # 2. Time features
    df = build_time_features(df)

    # 3. Congestion features (requires network join)
    df = build_congestion_features(df, network_df)

    # 4. Context join
    df = join_context(df, context_df)

    # 5. Incident flags
    df = build_incident_flags(df, incidents_df)

    # 6. Roadwork flags
    df = build_roadwork_flags(df, roadworks_df)

    # 7. Rolling features
    df = build_rolling_features(df)

    # 8. Lag features
    df = build_lag_features(df)

    # 9. Drop rows with excessive nulls in critical columns
    df = df.drop_nulls(subset=["speed_kmh", "flow_vph", "timestamp"])

    logger.info(f"Features built: {len(df):,} rows, {len(df.columns)} columns")
    df.write_parquet(cache, compression="zstd")
    logger.info(f"Features cached: {cache}")
    return df


def get_feature_columns() -> list:
    """Return list of feature columns used for ML models."""
    base = [
        "speed_kmh", "flow_vph", "occupancy_pct", "travel_time_min",
        "free_flow_time_min", "delay_min", "queue_length_veh",
        "congestion_index", "sensor_quality",
        "speed_ratio", "flow_utilization", "tt_ratio", "congestion_score",
        "hour", "day_of_week", "is_weekend", "is_peak", "minute",
        "lanes", "structural_bottleneck", "importance", "length_km", "peak_capacity_factor",
    ]
    rolling = []
    for w in ROLLING_WINDOWS:
        for col in ["speed_kmh", "flow_vph", "occupancy_pct", "congestion_index", "congestion_score"]:
            rolling.append(f"{col}_roll_mean_{w}")
            rolling.append(f"{col}_roll_std_{w}")

    lags = []
    for lag in LAG_STEPS:
        for col in ["speed_kmh", "flow_vph", "occupancy_pct", "congestion_index", "congestion_score"]:
            lags.append(f"{col}_lag{lag}")

    context = [
        "temperature_c", "rain_intensity", "event_level", "holiday_flag",
    ]
    incident_flags = ["incident_active", "incident_severity", "roadwork_active", "roadwork_closure_fraction"]

    return base + rolling + lags + context + incident_flags
