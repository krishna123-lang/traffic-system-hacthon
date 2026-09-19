# Research / Research Document
## FlowGuard AI — Urban Traffic Flow & Incident Intelligence

### 1. Abstract

Urban traffic systems are dynamic spatiotemporal networks in which local disruptions can propagate across adjacent road segments. The NEURAX Smart Cities problem requires more than point forecasting: the system must infer current network conditions, identify abnormal traffic and supported incident types, forecast traffic 15–60 minutes ahead, generate evidence-based diversion advisories, and estimate the impact of longer-term network interventions.

FlowGuard AI proposes an integrated software-only decision-support architecture combining (1) temporal data-quality and feature engineering, (2) directed road-network graph construction, (3) hybrid congestion/anomaly and incident classification, (4) spatio-temporal graph forecasting, (5) graph-based propagation-risk estimation, (6) future-cost diversion planning, and (7) counterfactual network-intervention simulation. The design is intentionally modular so that a robust tabular baseline remains available when data volume or training time is limited.

The research hypothesis is that a system which couples network structure with temporal forecasting and explicit intervention simulation can provide more operationally useful traffic intelligence than a forecasting-only pipeline.

---

## 2. Problem Definition

Given organizer-provided traffic and road-network observations, construct a continuously updated network state:

\[
S_t = f(X_{\leq t}, G, C_t, I_t, R_t, P)
\]

where:

- \(G\) = road-network graph
- \(X_{\leq t}\) = historical traffic observations
- \(C_t\) = context variables
- \(I_t\) = incident information where available
- \(R_t\) = roadwork / restriction information
- \(P\) = planning candidates and network attributes

The forecasting objective is:

\[
\hat{Y}_{t+h} = F(X_{\leq t}, G, C_{\leq t}, I_{\leq t}, R_{\leq t})
\]

for:

\[
h \in \{15,30,45,60\}\text{ minutes}
\]

The decision-support objective then uses the predicted state to generate an advisory action \(a\) and evaluate a counterfactual network state:

\[
\Delta M = M(G', D') - M(G,D)
\]

where \(M\) is a network performance metric such as delay, congestion or travel-time proxy.

---

## 3. Challenge-Specific Requirements

The source problem statement requires:
- current network-state intelligence;
- congestion and abnormal-behavior detection;
- incident detection/classification where supported by the data;
- 15–60 minute forecasting;
- operational/diversion advisories;
- longer-term road/network modification proposals;
- estimated before/after traffic impact.

All actions must remain simulated/advisory. No live signal control, camera access, GPS integration, roadside-sensor integration or physical intervention is required for judging. fileciteturn0file0L14-L22

---

## 4. Dataset Interpretation

The supplied training dataset contains:

- `traffic_train.csv`
- `forecast_targets_train.csv`
- `traffic_validation.csv`
- `forecast_targets_validation.csv`
- `incidents_*.csv`
- `context_*.csv`
- `roadworks_*.csv`
- `network.csv`
- `nodes.csv`
- `signal_plans.csv`
- `turn_restrictions.csv`
- `planning_candidates.csv`
- `od_demand_profiles.csv`
- `scenario_examples.csv`

A central data-integrity requirement is to keep future forecast-target files out of model-input features. The target files are reserved for supervised evaluation/training labels.

Because the supplied dataset README does not define every column in the files, the implementation should perform runtime schema discovery and maintain a schema-adapter layer rather than assume undocumented field names.

---

## 5. Literature Review

### 5.1 Spatio-temporal graph forecasting

**Kong, Guo & Liu (2024), STPGNN — AAAI.**
The paper proposes Spatio-Temporal Pivotal Graph Neural Networks and explicitly focuses on important graph nodes whose complex connectivity makes prediction difficult. This is relevant to urban bottlenecks and junctions.  
DOI: https://doi.org/10.1609/aaai.v38i8.28707

**Yin et al. (2025), Dynamic Diffusion Spatial-Temporal Graph Convolutional Network.**
This work develops a dynamic diffusion ST-GCN for short-term urban traffic forecasting, supporting the use of dynamic spatial relationships rather than treating road observations independently.  
DOI: https://doi.org/10.1007/s40747-024-01769-6

**Chen et al. (2025), Multi-scale Spatio-Temporal GNN.**
The proposed multi-time-scale STGNN decomposes traffic signals across timescales and reports gains across multiple traffic datasets. The idea motivates separating fast incident effects from slower recurring traffic patterns.  
DOI: https://doi.org/10.1038/s41598-025-11072-0

**Wang et al. (2025), Hybrid Spatial-Temporal GNN.**
The paper targets both long- and short-term temporal patterns and dynamic spatial correlations. This is relevant to a 15–60 minute multi-horizon forecast.  
DOI: https://doi.org/10.1016/j.ins.2025.102978

**Jia et al. (2025), Context-Based STGCN.**
This work explicitly incorporates contextual relationships around traffic chokepoints, motivating context features and neighborhood-aware prediction.  
DOI: https://doi.org/10.1016/j.knosys.2024.112933

**Zhang et al. (2025), Pretraining-improved STG network.**
The paper focuses on generalization, which maps directly to the challenge's requirement for robustness on changed/unseen traffic patterns.  
DOI: https://doi.org/10.1038/s41598-025-11375-2

**Liu et al. (2025), SAFER-Predictor.**
The proposed sparse adversarial training framework addresses missing and noisy data, which is important because the challenge explicitly scores robustness to noisy/missing observations.  
DOI: https://doi.org/10.1016/j.commtr.2025.100192

**GSTTN (2024), Graph Spatial-Temporal Transformer Network.**
The architecture combines graph convolution with multi-head temporal attention, motivating a lightweight graph-attention + temporal-attention design for the project.  
DOI: https://doi.org/10.1016/j.bdr.2024.100427

---

### 5.2 Incident detection

**Ensemble learning approach for incident detection and multi-category classification (2024).**
This work uses a two-stage framework and highlights class imbalance and feature selection in incident detection. It supports using a binary detector followed by category classification rather than forcing a single multi-class model to solve everything.  
DOI: https://doi.org/10.1016/j.engappai.2024.107933

**FDM: Effective and efficient incident detection on sparse trajectory data (2024).**
The paper addresses incident detection when observations are sparse, motivating robust anomaly features and methods that do not depend on perfect dense sensing.  
DOI: https://doi.org/10.1016/j.is.2024.102418

**AutoML-based traffic incident detection in smart cities (2024).**
This work investigates automated machine-learning approaches for traffic incident detection and provides a useful comparison point for supervised incident classification.  
DOI: https://doi.org/10.3233/IDT-240231

---

### 5.3 Routing and intervention

**Dynamic urban traffic rerouting with fog-cloud reinforcement learning (2024).**
The authors discuss dynamic rerouting under congestion and explicitly note the challenge of congestion shifting. This supports adding secondary-congestion penalties when generating diversions.  
DOI: https://doi.org/10.1111/mice.13115

**Dynamic adaptive vehicle re-routing strategy (2024).**
The study uses a k-shortest-path-inspired strategy to mitigate congestion, supporting graph-based candidate route generation for the advisory engine.  
DOI: https://doi.org/10.1016/j.ijtst.2023.04.003

**Network/topology-based traffic control and resilience (2025).**
This research identifies critical intersections from network topology and evaluates targeted interventions through simulated before/after system metrics. This is strongly aligned with the proposed planning lab.  
DOI: https://doi.org/10.1016/j.trip.2025.101729

**Traffic bottleneck identification on urban road networks (2025).**
The study focuses on dynamic interactions among neighboring road segments when identifying bottlenecks. This directly supports a graph-based bottleneck and propagation module.  
DOI: https://doi.org/10.3233/ATDE250439

**Urban congestion relief experiments through routing-app interventions (2026).**
A recent Nature Cities study reports large-scale empirical evidence that routing interventions can alter traffic distribution and improve network efficiency under suitable conditions. It is particularly relevant to the project's “advisory intervention” concept, while also highlighting that routing effects must be evaluated at the network level rather than only for individual trips.  
URL: https://www.nature.com/articles/s44284-026-00443-x

---

## 6. Research Gap

The reviewed literature contains strong solutions for individual subproblems:

```text
traffic forecasting
incident detection
routing
traffic-control optimization
bottleneck identification
robustness
```

The proposed project combines these into one **closed decision-support loop**:

```text
Observe
  ↓
Detect
  ↓
Explain
  ↓
Forecast
  ↓
Propagate
  ↓
Recommend
  ↓
Simulate
  ↓
Measure impact
```

This integration is the main project-level research contribution. It should be described as an **engineering/research integration contribution**, not as a claim that a fundamentally new forecasting algorithm has been invented.

---

## 7. Proposed Methodology

### Stage A — Data fusion
1. Load all organizer files.
2. Validate timestamp/identifier consistency.
3. Exclude forecast-target files from input features.
4. Join traffic with network/context/event/roadwork information where keys support the join.
5. Create a unified time-indexed traffic-state table.

### Stage B — Graph construction

Construct a directed graph:

\[
G=(V,E)
\]

Node features:
- node-level traffic aggregates;
- junction context if available.

Edge features:
- dynamic traffic variables;
- capacity-related attributes;
- restrictions;
- roadwork state.

### Stage C — Congestion and anomaly detection

Use:
- rolling robust baseline;
- anomaly score;
- supervised incident classifier.

A calibrated probability is preferable to a hard label:

\[
P(\text{incident}\mid X_t,G,C_t)
\]

### Stage D — Forecasting

Use a multi-horizon spatiotemporal graph architecture:

```text
traffic history
      ↓
temporal convolution
      ↓
graph attention / message passing
      ↓
temporal GRU or transformer block
      ↓
multi-horizon decoder
      ↓
15/30/45/60 minute outputs
```

### Stage E — Propagation

For each high-risk segment, compute neighboring risk using:
- graph distance;
- current severity;
- forecasted severity;
- edge capacity;
- historical co-movement where measurable;
- incident/roadwork context.

### Stage F — Advisory routing

Generate multiple candidate paths and score them with future network cost.

\[
C_e =
w_1 T_e +
w_2 Congestion_e +
w_3 ForecastRisk_e +
w_4 Incident_e +
w_5 Spillback_e
\]

Then select recommendations subject to turn restrictions and configurable risk tolerance.

### Stage G — Counterfactual intervention

For each planning candidate:

1. modify network parameter(s);
2. recompute route/network costs;
3. re-estimate affected traffic;
4. calculate before/after metrics;
5. retain assumptions and uncertainty.

---

## 8. Explainability

The dashboard should expose:

```text
Prediction
   +
Confidence
   +
Evidence
   +
Network neighborhood
   +
Expected impact
```

For tabular models, use SHAP to show feature importance.

For graph forecasting, expose:
- influential neighbors;
- top contributing segments;
- temporal attention / importance where implemented;
- uncertainty band.

The challenge explicitly assigns marks to evidence, uncertainty and limitations. fileciteturn0file0L42-L50

---

## 9. Evaluation Protocol

### Detection
- precision
- recall
- F1
- PR-AUC
- false-alert rate

### Forecasting
For each horizon:
- MAE
- RMSE
- sMAPE

Report results separately for:
- normal periods;
- peak periods;
- incident periods;
- missing/noisy-data tests.

### Recommendations
Use simulation metrics:
- total travel-time proxy;
- average delay;
- severe-congestion count;
- route cost;
- secondary congestion increase/decrease.

### Generalization
The validation workflow must preserve temporal ordering and never leak forecast targets into features.

---

## 10. Robustness Experiments

Create synthetic perturbations over the validation traffic:
- 5% random missingness;
- 10% random missingness;
- short consecutive data gaps;
- Gaussian/random noise;
- changed demand scenario;
- incident-heavy scenario.

Report:

\[
Robustness\ degradation =
\frac{Metric_{corrupted}-Metric_{clean}}
{Metric_{clean}}
\]

This directly addresses the challenge criterion for unseen traffic patterns and noisy/missing data. fileciteturn0file0L42-L43

---

## 11. Proposed Innovation

The innovation is the **closed-loop traffic intelligence architecture**, especially:

1. forecast-aware incident propagation;
2. future-cost rather than only current-cost diversion;
3. confidence-aware explanations;
4. counterfactual network intervention;
5. unified before/after impact reporting.

The project should avoid cosmetic “AI chatbot” features. The innovation must improve operational decision quality.

---

## 12. Expected Output

For every important network event, the system should be capable of producing:

```text
CURRENT STATE
Segment E17: severe congestion
Incident probability: 0.84

FORECAST
E22: high risk in +15 min
E23: high risk in +30 min

ADVISORY
Avoid E17 → E19 → E22
Alternative route through E31 → E34

EXPECTED IMPACT
Estimated delay reduction: X%
Secondary congestion risk: Low

PLANNING
Recurring bottleneck detected at E17
Candidate intervention: Candidate C4
Simulated network impact: X%
Confidence: Medium/High
```

The exact fields must be adapted to the actual organizer schema.

---

## 13. Limitations

1. The organizer dataset is synthetic; measured operational gains are simulation estimates.
2. Missing undocumented columns may constrain incident classification.
3. Without actual geospatial coordinates, the UI may need a schematic network rather than a geographic map.
4. Counterfactual intervention results depend on the chosen surrogate traffic-assignment model.
5. Forecast uncertainty grows with horizon and under distribution shift.
6. A hackathon implementation cannot validate real municipal response policies.

---

## 14. Conclusion

FlowGuard AI is designed as an integrated traffic decision-support system rather than a standalone forecasting model. Its principal value is the combination of current-state inference, incident intelligence, network-aware forecasting, propagation reasoning, advisory routing, and counterfactual planning. This architecture is aligned with the challenge requirements and creates a coherent technical narrative for the final demonstration.

---

## 15. Selected References

1. Kong, W., Guo, Z., & Liu, Y. (2024). Spatio-Temporal Pivotal Graph Neural Networks for Traffic Flow Forecasting. AAAI. https://doi.org/10.1609/aaai.v38i8.28707
2. Yin, X., et al. (2025). Short-term urban traffic forecasting in smart cities: a dynamic diffusion spatial-temporal graph convolutional network. Complex & Intelligent Systems. https://doi.org/10.1007/s40747-024-01769-6
3. Chen, H., et al. (2025). Multi-scale spatio-temporal graph neural network for urban traffic flow prediction. Scientific Reports. https://doi.org/10.1038/s41598-025-11072-0
4. Wang, P., et al. (2025). Hybrid spatial-temporal graph neural network for traffic forecasting. Information Fusion. https://doi.org/10.1016/j.ins.2025.102978
5. Jia, C., et al. (2025). Context based spatial-temporal graph convolutional networks for traffic prediction. Knowledge-Based Systems. https://doi.org/10.1016/j.knosys.2024.112933
6. Zhang, X., et al. (2025). Pretraining-improved Spatiotemporal graph network for the generalization performance enhancement of traffic forecasting. Scientific Reports. https://doi.org/10.1038/s41598-025-11375-2
7. Liu, Y., et al. (2025). SAFER-predictor: Sparse adversarial training framework for robust traffic prediction under missing and noisy data. Communications in Transportation Research. https://doi.org/10.1016/j.commtr.2025.100192
8. Ensemble learning based approach for traffic incident detection and multi-category classification. (2024). Engineering Applications of Artificial Intelligence. https://doi.org/10.1016/j.engappai.2024.107933
9. FDM: Effective and efficient incident detection on sparse trajectory data. (2024). Information Sciences. https://doi.org/10.1016/j.is.2024.102418
10. Gkioka, G., Dominguez, M., & Mentzas, G. (2024). An AutoML-based approach for automatic traffic incident detection in smart cities. Information Discovery and Delivery. https://doi.org/10.3233/IDT-240231
11. Du, X., et al. (2024). Dynamic urban traffic rerouting with fog-cloud reinforcement learning. Computer-Aided Civil and Infrastructure Engineering. https://doi.org/10.1111/mice.13115
12. Dynamic adaptive vehicle re-routing strategy for traffic congestion mitigation of grid network. (2024). International Journal of Transportation Science and Technology. https://doi.org/10.1016/j.ijtst.2023.04.003
13. Identifying traffic control mechanism to improve the level of service and resilience in road networks based on topological credentials. (2025). Transportation Research Interdisciplinary Perspectives. https://doi.org/10.1016/j.trip.2025.101729
14. Traffic Bottleneck Identification on Urban Road Network: Dynamic Interactions Among Road Segments. (2025). Intelligent Transportation Engineering. https://doi.org/10.3233/ATDE250439
15. Urban congestion relief experiments through routing-app interventions. (2026). Nature Cities. https://www.nature.com/articles/s44284-026-00443-x
