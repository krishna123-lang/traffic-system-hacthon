"""
scripts/build_features.py

Feature engineering pipeline.
Loads traffic CSV → Polars → Parquet → features.
"""

import sys
import logging
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

import os
os.environ.setdefault("DATA_DIR", "./data")
os.environ.setdefault("MODEL_DIR", "./models")


def main():
    from ml.data.feature_engineering import build_features, get_feature_columns

    print("\n" + "="*60)
    print("FLOWGUARD AI — FEATURE ENGINEERING")
    print("="*60)

    for split in ["train", "validation"]:
        print(f"\n[Building features for {split}]")
        df = build_features(split, use_cache=False)
        print(f"  Rows: {len(df):,}")
        print(f"  Columns: {len(df.columns)}")

        cols = get_feature_columns()
        available = [c for c in cols if c in df.columns]
        missing = [c for c in cols if c not in df.columns]
        print(f"  Feature columns available: {len(available)}/{len(cols)}")
        if missing:
            print(f"  Missing feature cols: {missing[:10]}")

        null_counts = {col: df[col].is_null().sum() for col in df.columns if df[col].is_null().sum() > 0}
        print(f"  Columns with nulls: {len(null_counts)}")

    print("\n" + "="*60)
    print("FEATURE ENGINEERING COMPLETE")
    print("="*60 + "\n")


if __name__ == "__main__":
    main()
