"""
FlowGuard AI — FastAPI Backend Configuration
"""

from pydantic_settings import BaseSettings
from typing import List
import os


class Settings(BaseSettings):
    app_name: str = "FlowGuard AI"
    app_env: str = "development"
    debug: bool = True

    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    data_dir: str = "./data"
    model_dir: str = "./models"
    artifacts_dir: str = "./artifacts"

    forecast_horizons_minutes: str = "15,30,45,60"
    lookback_steps: int = 12
    time_interval_minutes: int = 5

    k_shortest_paths: int = 5
    max_propagation_hops: int = 3
    confidence_threshold: float = 0.70

    simulation_only: bool = True

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",")]

    @property
    def horizons(self) -> List[int]:
        return [int(h) for h in self.forecast_horizons_minutes.split(",")]


settings = Settings()
