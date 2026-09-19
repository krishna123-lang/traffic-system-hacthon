# FlowGuard AI

> **Intelligent Urban Traffic Flow, Incident & Network Decision Platform**
> Built for NEURAX Hackathon 3.0 — AI in Smart Cities — Urban Traffic Flow & Incident Intelligence

---

## ⚠️ SIMULATION MODE

All data originates from the **NEURAX Hackathon 3.0 organizer dataset** (synthetic Hyderabad-area network with real geographic coordinates). This is **not** live municipal data.

---

## System Overview

FlowGuard AI is a full-stack AI platform for urban traffic intelligence:

| Layer | Technology |
|-------|------------|
| Data Ingestion | Polars → Parquet cache |
| Feature Engineering | 91 features (time, rolling, lag, context, incident flags) |
| Incident Detection | LightGBM + XGBoost + probability calibration |
| Traffic Forecasting | XGBoost (best) · GRU · ST-GNN · Historical Baseline |
| Graph Engine | Dual graph: Physical road graph + Segment line graph |
| Propagation | k-hop spillback risk on segment line graph |
| Routing | Yen's k-shortest paths with future-aware congestion cost |
| Backend API | FastAPI + Pydantic |
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Map | MapLibre GL JS (OpenStreetMap tiles, real Hyderabad lat/lon) |

---

## Dataset

| Property | Value |
|----------|-------|
| Segments | 436 |
| Nodes (junctions) | 120 (real Hyderabad coordinates: 17.3–17.46°N, 78.35–78.55°E) |
| Resolution | 5-minute intervals |
| Training period | 15 days (Jan 1–15, 2026) → 1,883,520 rows |
| Validation period | 4 days (Jan 16–19, 2026) → 502,272 rows |
| Incident labels | 49 labeled incidents (stalled_vehicle, accident_like, lane_blockage, demand_surge, road_closure) |
| Forecast horizons | +15, +30, +45, +60 minutes |

---

## Verified Model Benchmarks

### Congestion Forecasting (target: `congestion_score`)

| Model | +15m MAE | +30m MAE | +45m MAE | +60m MAE |
|-------|----------|----------|----------|----------|
| **XGBoost** ⭐ | **0.0119** | **0.0142** | **0.0151** | **0.0165** |
| Historical Baseline | 0.0204 | 0.0203 | 0.0202 | 0.0203 |
| ST-GNN | 0.0291 | 0.0283 | 0.0282 | 0.0296 |
| GRU | 0.0300 | 0.0293 | 0.0299 | 0.0325 |

> These numbers are computed from the real dataset. XGBoost outperforms all models at every horizon.

---

## Quickstart

### Prerequisites

- Python 3.11+ (Anaconda recommended)
- Node.js 18+
- ~4 GB RAM available

### Step 1: Install Python dependencies

```powershell
pip install xgboost lightgbm polars pyarrow fastapi uvicorn pydantic-settings shap networkx joblib python-dotenv httpx torch
```

### Step 2: Run the data pipeline (one-time)

```powershell
cd d:\sss
python scripts/validate_data.py
python scripts/build_graph.py
python scripts/build_features.py
python scripts/train_incident_model.py
python scripts/train_forecasting_models.py
python scripts/generate_demo_scenario.py
```

> Total time: ~30 minutes (most time is GRU/ST-GNN training)

### Step 3: Start the backend

```powershell
cd d:\sss
$env:PYTHONPATH="d:\sss"
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

Backend starts at: **http://localhost:8000**
API docs at: **http://localhost:8000/docs**

### Step 4: Start the frontend

```powershell
cd d:\sss\frontend
npm install
npm run dev
```

Frontend starts at: **http://localhost:5173**

---

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | System health check |
| `/api/simulation/status` | GET | Simulation mode status |
| `/api/network` | GET | All nodes + segments with current state |
| `/api/state` | GET | Traffic state for all 436 segments |
| `/api/alerts` | GET | Active congestion/incident alerts |
| `/api/incidents` | GET | Incident records |
| `/api/forecast/{segment_id}` | GET | Multi-horizon forecast |
| `/api/forecast/batch` | POST | Batch forecasts |
| `/api/propagation/{segment_id}` | GET | Spillback risk to neighbors |
| `/api/routes` | POST | Route finding between nodes |
| `/api/trips/simulate` | POST | Vehicle trip simulation |
| `/api/bottlenecks` | GET | Recurring bottleneck analysis |
| `/api/interventions/simulate` | POST | Planning intervention impact |
| `/api/metrics` | GET | Model performance metrics |
| `/api/data-health` | GET | Dataset quality report |
| `/api/demo/scenarios` | GET | Available demo scenarios |
| `/api/demo/scenarios/{id}/state?step=N` | GET | Deterministic scenario state |
| `/api/planning/candidates` | GET | 90 planning intervention candidates |
| `/api/segments/{id}` | GET | Full detail for one segment |
| `/api/snap-to-node` | GET | Snap lat/lon to nearest node |

---

## Frontend Pages

| Page | URL | Description |
|------|-----|-------------|
| Command Center | `/` | KPI cards, network map, alerts, forecast timeline |
| Live Network | `/network` | Full-page map, trip planner, route comparison |
| Forecast Intelligence | `/forecast` | Multi-horizon charts with confidence bands |
| Incident Intelligence | `/incidents` | Incident table, SHAP evidence |
| Diversion Advisor | `/diversion` | Route comparison, vehicle animation |
| Bottleneck Analytics | `/bottlenecks` | Ranked table, intervention candidates |
| Planning Lab | `/planning` | Intervention simulation, before/after |
| Model Performance | `/performance` | Benchmark table, confusion matrix |
| Data Health | `/data-health` | Dataset quality indicators |

---

## Architecture

### Two-Graph Representation

**Physical Road Graph** (routing + visualization)
- Nodes = 120 junctions with real GPS coordinates
- Edges = 436 road segments (arterial/collector)
- Used for: Yen's k-shortest paths, geographic rendering, turn restrictions

**Segment Line Graph** (ML forecasting + propagation)
- Nodes = 436 road segments
- Edges = connections when segments are physically adjacent + directionally compatible
- Used for: ST-GNN, k-hop propagation risk, neighborhood-aware forecasting

### Congestion Score Formula

```
score = 0.35*(1 - speed_ratio) + 0.30*flow_utilization + 0.20*(occ/100) + 0.15*((tt_ratio-1)/4)
```
Clamped to [0, 1]. States: normal < 0.2 < low_risk < 0.4 < moderate < 0.6 < high < 0.75 < severe < 0.9 < incident

### Demo Mode

The frontend demo plays a pre-computed scenario (TRAIN_SC_001: stalled vehicle on R0067, Jan 1 2026 21:57–22:40) step by step using:
```
GET /api/demo/scenarios/DEMO_MORNING_PEAK_INCIDENT/state?step=N
```
Each step is deterministic. The frontend controls play/pause/reset and 1x/2x/5x speed.

---

## Project Structure

```
d:\sss\
├── data/                      # Organizer dataset (19 CSV files)
├── ml/                        # ML Python package
│   ├── data/                  # Ingestion, features, graphs, targets
│   ├── incidents/             # Detector (XGBoost/LightGBM)
│   ├── forecasting/           # 4 models (Baseline, XGBoost, GRU, ST-GNN)
│   ├── propagation/           # k-hop spillback engine
│   └── interventions/         # Routing + simulation
├── scripts/                   # Training and generation scripts
├── backend/
│   └── app/
│       ├── main.py            # FastAPI app (20+ endpoints)
│       ├── config.py          # Settings from .env
│       ├── schemas/           # Pydantic response models
│       └── services/          # AppState singleton
├── frontend/
│   └── src/
│       ├── api/client.ts      # Axios + all API functions
│       ├── components/        # 13 shared components
│       ├── pages/             # 9 full page implementations
│       ├── hooks/             # useTheme, useDemo, useNetwork
│       └── lib/               # Congestion color utilities
├── cache/                     # Parquet feature caches
├── models/                    # Trained model files (.pkl, .joblib)
└── artifacts/                 # Metrics, health report, demo scenario
```

---

## Team / Credits

Built end-to-end for NEURAX Hackathon 3.0.
Dataset provided by hackathon organizers.
Map tiles © OpenStreetMap contributors.
