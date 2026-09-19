# FlowGuard AI — Architecture Notes

## System-level architecture

```text
                 ┌───────────────────────────────┐
                 │      ORGANIZER DATASETS       │
                 │ traffic / incidents / context │
                 │ roadworks / network / signals │
                 │ restrictions / OD / planning  │
                 └──────────────┬────────────────┘
                                │
                                ▼
                 ┌───────────────────────────────┐
                 │ DATA INGESTION + VALIDATION   │
                 │ schema adapter / QA / joins   │
                 └──────────────┬────────────────┘
                                │
                                ▼
                 ┌───────────────────────────────┐
                 │ DIRECTED ROAD NETWORK GRAPH   │
                 │ nodes + edges + restrictions  │
                 └───────┬───────────┬───────────┘
                         │           │
              ┌──────────▼───┐   ┌──▼─────────────────┐
              │ CURRENT STATE │   │ CONTEXT FUSION     │
              │ + CONGESTION  │   │ roadworks/events   │
              └───────┬───────┘   └──────────┬─────────┘
                      │                      │
                      └──────────┬───────────┘
                                 ▼
                    ┌──────────────────────────┐
                    │ INCIDENT INTELLIGENCE    │
                    │ anomaly + classifier     │
                    └────────────┬─────────────┘
                                 │
                                 ▼
                    ┌──────────────────────────┐
                    │ ST GRAPH FORECASTER      │
                    │ +15/+30/+45/+60          │
                    └────────────┬─────────────┘
                                 │
                                 ▼
                    ┌──────────────────────────┐
                    │ PROPAGATION ENGINE        │
                    │ spillback / risk field    │
                    └────────────┬─────────────┘
                                 │
                 ┌───────────────┴─────────────────┐
                 ▼                                 ▼
      ┌──────────────────────┐         ┌──────────────────────┐
      │ DIVERSION ADVISOR    │         │ PLANNING LAB         │
      │ future-cost paths    │         │ counterfactual       │
      └──────────┬───────────┘         └──────────┬───────────┘
                 │                                │
                 └───────────────┬────────────────┘
                                 ▼
                    ┌──────────────────────────┐
                    │ EVIDENCE + IMPACT LAYER  │
                    │ confidence / SHAP / KPI   │
                    └────────────┬─────────────┘
                                 │
                                 ▼
                    ┌──────────────────────────┐
                    │ REACT COMMAND CENTER      │
                    └──────────────────────────┘
```

## Model strategy

### Incident
`Robust anomaly features → XGBoost/LightGBM → calibrated probability`

### Forecasting
`Temporal encoder → graph attention/message passing → temporal decoder → multi-horizon forecast`

### Propagation
`k-hop graph + forecast change + capacity/context → propagation risk`

### Routing
`k-shortest paths → future-cost scoring → secondary-congestion penalty`

### Planning
`candidate intervention → simulated network change → before/after metrics`

## Engineering principle

Every model should expose a stable interface. The UI should never directly call a notebook or training script.

```text
Training
   ↓
Saved artifact
   ↓
FastAPI service
   ↓
JSON response
   ↓
React dashboard
```
