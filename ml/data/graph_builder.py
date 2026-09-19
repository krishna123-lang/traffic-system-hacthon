"""
Graph construction module.

Builds TWO graph representations as required:

A. Physical Road Graph (nodes = junctions, edges = road segments)
   - Used for: visualization, routing, turn restrictions, geographic mapping

B. Segment Line Graph (nodes = road segments, edges = connectivity between segments)
   - Used for: ST-GNN, traffic propagation, forecasting

Both are saved as NetworkX graphs and as adjacency matrices for PyTorch Geometric.
"""

from __future__ import annotations
import logging
import pickle
from pathlib import Path
from typing import Dict, List, Tuple, Optional, Any

import numpy as np
import pandas as pd
import networkx as nx

from ml.data.ingestion import (
    load_network, load_nodes, load_turn_restrictions,
    load_signal_plans, CACHE_DIR
)

logger = logging.getLogger(__name__)

GRAPH_CACHE = CACHE_DIR / "graphs.pkl"


# ──────────────────────────────────────────────────────────
# A. PHYSICAL ROAD GRAPH
# ──────────────────────────────────────────────────────────

def build_physical_graph(
    network_df: pd.DataFrame,
    nodes_df: pd.DataFrame,
    turn_restrictions_df: Optional[pd.DataFrame] = None,
    signal_plans_df: Optional[pd.DataFrame] = None,
) -> nx.DiGraph:
    """
    Build physical road graph.
    Nodes = junctions (from nodes.csv with lat/lon).
    Edges = road segments (from network.csv).
    """
    G = nx.DiGraph()

    # Add nodes with attributes
    for _, row in nodes_df.iterrows():
        G.add_node(
            row["node_id"],
            lat=float(row["lat"]),
            lon=float(row["lon"]),
            x=int(row["x"]),
            y=int(row["y"]),
        )

    # Add signal plan info to nodes
    if signal_plans_df is not None:
        for _, sp in signal_plans_df.iterrows():
            nid = sp.get("node_id")
            if nid and nid in G.nodes:
                G.nodes[nid]["signal_id"] = sp["signal_id"]
                G.nodes[nid]["cycle_s"] = float(sp.get("cycle_s", 0))
                G.nodes[nid]["green_ratio"] = float(sp.get("green_ratio", 0.5))

    # Add edges (segments)
    for _, row in network_df.iterrows():
        src = row["source_node"]
        tgt = row["target_node"]
        seg_id = row["segment_id"]

        if src not in G.nodes or tgt not in G.nodes:
            logger.warning(f"Segment {seg_id}: node {src} or {tgt} not in nodes.csv")
            continue

        # Base travel time (free-flow)
        ffs = float(row["free_flow_speed_kmh"])
        length = float(row["length_km"])
        free_flow_time = (length / max(ffs, 1.0)) * 60.0  # minutes

        G.add_edge(
            src, tgt,
            segment_id=seg_id,
            road_class=row["road_class"],
            lanes=int(row["lanes"]),
            free_flow_speed_kmh=ffs,
            capacity_vph=float(row["capacity_vph"]),
            length_km=length,
            grade_pct=float(row["grade_pct"]),
            signal_id=row.get("signal_id", None),
            structural_bottleneck=int(row["structural_bottleneck"]),
            importance=float(row["importance"]),
            peak_capacity_factor=float(row["peak_capacity_factor"]),
            free_flow_time_min=free_flow_time,
            # Mutable traffic state (updated at runtime)
            congestion_score=0.0,
            speed_kmh=ffs,
            flow_vph=0.0,
            congestion_state="normal",
        )

    # Apply turn restrictions
    if turn_restrictions_df is not None:
        for _, tr in turn_restrictions_df.iterrows():
            G.add_edge(
                tr["from_segment"],  # these are segment ids — we'll handle in routing
                tr["to_segment"],
                restriction=tr["restriction"],
                _is_restriction=True,
            )
            # Store restriction as node attribute for routing use
            node = tr.get("node_id")
            if node and node in G.nodes:
                if "restrictions" not in G.nodes[node]:
                    G.nodes[node]["restrictions"] = []
                G.nodes[node]["restrictions"].append({
                    "from_segment": tr["from_segment"],
                    "to_segment": tr["to_segment"],
                    "restriction": tr["restriction"],
                })

    logger.info(
        f"Physical graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges "
        f"({nx.is_strongly_connected(G)} strongly connected)"
    )
    return G


# ──────────────────────────────────────────────────────────
# B. SEGMENT LINE GRAPH
# ──────────────────────────────────────────────────────────

def build_segment_graph(
    network_df: pd.DataFrame,
    turn_restrictions_df: Optional[pd.DataFrame] = None,
) -> Tuple[nx.DiGraph, Dict[str, int], List[str]]:
    """
    Build segment-level line graph for ST-GNN and propagation.

    Nodes = road segments (R0001, R0002, ...).
    Edges = (A→B) if segment A's target_node == segment B's source_node
            and the turn is not restricted.

    Returns:
        seg_graph: NetworkX DiGraph
        seg_to_idx: dict mapping segment_id → integer index
        idx_to_seg: list mapping integer index → segment_id
    """
    # Index mapping
    segments = sorted(network_df["segment_id"].unique().tolist())
    seg_to_idx = {s: i for i, s in enumerate(segments)}
    idx_to_seg = segments

    # Build node→segments lookup
    node_to_outgoing: Dict[str, List[str]] = {}  # node → list of outgoing segment_ids
    node_to_incoming: Dict[str, List[str]] = {}  # node → list of incoming segment_ids

    for _, row in network_df.iterrows():
        sid = row["segment_id"]
        src = row["source_node"]
        tgt = row["target_node"]

        if tgt not in node_to_outgoing:
            node_to_outgoing[tgt] = []
        node_to_outgoing[tgt].append(sid)  # segments entering this node

        if src not in node_to_incoming:
            node_to_incoming[src] = []
        node_to_incoming[src].append(sid)  # this is confusing — let's redo

    # Proper: for each node, find all (incoming_seg, outgoing_seg) pairs
    # incoming_seg ends at node (target_node == node)
    # outgoing_seg starts at node (source_node == node)
    seg_end_at: Dict[str, List[str]] = {}    # node → segments that END here
    seg_start_at: Dict[str, List[str]] = {}  # node → segments that START here

    for _, row in network_df.iterrows():
        sid = row["segment_id"]
        src = row["source_node"]
        tgt = row["target_node"]

        if tgt not in seg_end_at:
            seg_end_at[tgt] = []
        seg_end_at[tgt].append(sid)

        if src not in seg_start_at:
            seg_start_at[src] = []
        seg_start_at[src].append(sid)

    # Build restricted turns set
    restricted_pairs: set = set()
    if turn_restrictions_df is not None:
        for _, tr in turn_restrictions_df.iterrows():
            if tr["restriction"] == "no_turn":
                restricted_pairs.add((tr["from_segment"], tr["to_segment"]))

    # Build segment graph
    seg_graph = nx.DiGraph()

    # Add all segments as nodes
    for _, row in network_df.iterrows():
        sid = row["segment_id"]
        seg_graph.add_node(
            sid,
            idx=seg_to_idx[sid],
            source_node=row["source_node"],
            target_node=row["target_node"],
            road_class=row["road_class"],
            lanes=int(row["lanes"]),
            free_flow_speed_kmh=float(row["free_flow_speed_kmh"]),
            capacity_vph=float(row["capacity_vph"]),
            length_km=float(row["length_km"]),
            structural_bottleneck=int(row["structural_bottleneck"]),
            importance=float(row["importance"]),
        )

    # Add edges: segment A → segment B if A ends at node X and B starts at node X
    for node in set(list(seg_end_at.keys()) + list(seg_start_at.keys())):
        incoming = seg_end_at.get(node, [])
        outgoing = seg_start_at.get(node, [])
        for a in incoming:
            for b in outgoing:
                if a == b:
                    continue  # don't self-connect
                if (a, b) in restricted_pairs:
                    continue  # respect turn restrictions
                seg_graph.add_edge(a, b, via_node=node)

    n_seg = seg_graph.number_of_nodes()
    n_edge = seg_graph.number_of_edges()
    logger.info(
        f"Segment line graph: {n_seg} nodes (segments), {n_edge} edges "
        f"(avg degree: {n_edge/max(n_seg,1):.1f})"
    )
    return seg_graph, seg_to_idx, idx_to_seg


def get_adjacency_matrix(seg_graph: nx.DiGraph, n_nodes: int) -> np.ndarray:
    """Return dense adjacency matrix for the segment graph."""
    A = np.zeros((n_nodes, n_nodes), dtype=np.float32)
    nodes = list(seg_graph.nodes())
    node_to_idx = {n: i for i, n in enumerate(nodes)}
    for u, v in seg_graph.edges():
        if u in node_to_idx and v in node_to_idx:
            A[node_to_idx[u], node_to_idx[v]] = 1.0
    return A


def get_edge_index(seg_graph: nx.DiGraph, seg_to_idx: Dict[str, int]) -> np.ndarray:
    """Return edge_index array of shape (2, E) for PyTorch Geometric."""
    edges = [(seg_to_idx[u], seg_to_idx[v])
             for u, v in seg_graph.edges()
             if u in seg_to_idx and v in seg_to_idx]
    if not edges:
        return np.zeros((2, 0), dtype=np.int64)
    return np.array(edges, dtype=np.int64).T


def build_graphs(use_cache: bool = True) -> Dict[str, Any]:
    """Build and cache both graphs. Returns dict with all graph objects."""
    if use_cache and GRAPH_CACHE.exists():
        logger.info(f"Loading graphs from cache: {GRAPH_CACHE}")
        with open(GRAPH_CACHE, "rb") as f:
            return pickle.load(f)

    logger.info("Building graph representations...")

    network_df = load_network()
    nodes_df = load_nodes()
    turn_restrictions_df = load_turn_restrictions()
    signal_plans_df = load_signal_plans()

    # Physical graph
    physical_graph = build_physical_graph(
        network_df, nodes_df, turn_restrictions_df, signal_plans_df
    )

    # Segment line graph
    seg_graph, seg_to_idx, idx_to_seg = build_segment_graph(
        network_df, turn_restrictions_df
    )

    # Adjacency matrix & edge index for ML
    n_seg = len(idx_to_seg)
    adj_matrix = get_adjacency_matrix(seg_graph, n_seg)
    edge_index = get_edge_index(seg_graph, seg_to_idx)

    # Network-level centrality metrics
    seg_centrality = nx.betweenness_centrality(seg_graph)
    seg_pagerank = nx.pagerank(seg_graph)

    result = {
        "physical_graph": physical_graph,
        "seg_graph": seg_graph,
        "seg_to_idx": seg_to_idx,
        "idx_to_seg": idx_to_seg,
        "adj_matrix": adj_matrix,
        "edge_index": edge_index,
        "n_segments": n_seg,
        "seg_centrality": seg_centrality,
        "seg_pagerank": seg_pagerank,
        "network_df": network_df,
        "nodes_df": nodes_df,
    }

    with open(GRAPH_CACHE, "wb") as f:
        pickle.dump(result, f, protocol=4)
    logger.info(f"Graphs cached: {GRAPH_CACHE}")

    return result


def get_k_hop_neighbors(seg_graph: nx.DiGraph, segment_id: str, k: int = 3) -> Dict[int, List[str]]:
    """Return k-hop neighbors of a segment for propagation analysis."""
    neighbors: Dict[int, List[str]] = {}
    current = {segment_id}
    visited = {segment_id}

    for hop in range(1, k + 1):
        next_level = set()
        for node in current:
            for succ in seg_graph.successors(node):
                if succ not in visited:
                    next_level.add(succ)
                    visited.add(succ)
        neighbors[hop] = sorted(next_level)
        current = next_level
        if not current:
            break

    return neighbors
