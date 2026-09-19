"""
scripts/build_graph.py

Build both graph representations:
  A. Physical road graph (nodes.csv + network.csv)
  B. Segment line graph (for ST-GNN + propagation)

Saves to cache/graphs.pkl
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
    from ml.data.graph_builder import build_graphs, get_k_hop_neighbors
    import networkx as nx
    import json

    print("\n" + "="*60)
    print("FLOWGUARD AI — GRAPH CONSTRUCTION")
    print("="*60)

    # Force rebuild
    cache = Path("./models/../cache/graphs.pkl")
    print("\n[A] Building Physical Road Graph...")
    print("[B] Building Segment Line Graph...")

    graphs = build_graphs(use_cache=False)

    phys = graphs["physical_graph"]
    seg = graphs["seg_graph"]

    print(f"\nPhysical Graph:")
    print(f"  Nodes (junctions): {phys.number_of_nodes()}")
    print(f"  Edges (road segments): {phys.number_of_edges()}")
    print(f"  Strongly connected: {nx.is_strongly_connected(phys)}")
    weakly = list(nx.weakly_connected_components(phys))
    print(f"  Weakly connected components: {len(weakly)}")

    print(f"\nSegment Line Graph:")
    print(f"  Nodes (road segments): {seg.number_of_nodes()}")
    print(f"  Edges (connections): {seg.number_of_edges()}")
    avg_deg = seg.number_of_edges() / max(seg.number_of_nodes(), 1)
    print(f"  Average out-degree: {avg_deg:.2f}")

    print(f"\nAdjacency matrix: {graphs['adj_matrix'].shape}")
    print(f"Edge index shape: {graphs['edge_index'].shape}")

    # Sample propagation neighborhood
    segments = graphs["idx_to_seg"]
    sample_seg = segments[0]
    neighbors = get_k_hop_neighbors(seg, sample_seg, k=3)
    print(f"\nSample k-hop neighbors of {sample_seg}:")
    for hop, segs in neighbors.items():
        print(f"  Hop {hop}: {segs[:5]}{'...' if len(segs) > 5 else ''}")

    # Save graph stats
    stats = {
        "physical_nodes": phys.number_of_nodes(),
        "physical_edges": phys.number_of_edges(),
        "segment_nodes": seg.number_of_nodes(),
        "segment_edges": seg.number_of_edges(),
        "adj_shape": list(graphs["adj_matrix"].shape),
        "edge_index_shape": list(graphs["edge_index"].shape),
        "n_segments": graphs["n_segments"],
    }
    out = Path("./artifacts/graph_stats.json")
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(stats, indent=2))
    print(f"\nGraph stats saved: {out}")

    print("\n" + "="*60)
    print("GRAPH CONSTRUCTION COMPLETE")
    print("="*60 + "\n")

    return graphs


if __name__ == "__main__":
    main()
