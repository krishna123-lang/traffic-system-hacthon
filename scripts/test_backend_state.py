"""Quick backend state test."""
import sys
sys.path.insert(0, ".")
import os
os.environ.setdefault("DATA_DIR", "./data")
os.environ.setdefault("MODEL_DIR", "./models")

from backend.app.services.state import app_state
app_state.load()

print("=== STATE LOADED ===")
pg = app_state.physical_graph
sg = app_state.seg_graph
print(f"Physical graph nodes: {pg.number_of_nodes() if pg else 0}")
print(f"Segment graph nodes: {sg.number_of_nodes() if sg else 0}")
print(f"Forecast models loaded: {list(app_state.forecast_models.keys())}")
print(f"Best forecast models: {app_state.best_forecast_model_names}")
print(f"Incident model loaded: {app_state.incident_model_payload is not None}")
print(f"Current state segments: {len(app_state.current_state)}")
sc = app_state.demo_scenario
print(f"Demo scenario steps: {len(sc.get('steps', [])) if sc else 0}")
print(f"Forecast metrics: {len(app_state.forecast_metrics)} entries")
print(f"Data health: {list(app_state.data_health.keys())[:5] if app_state.data_health else 'empty'}")
