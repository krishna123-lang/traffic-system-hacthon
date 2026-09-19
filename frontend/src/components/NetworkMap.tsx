import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { NetworkData, SegmentState, Segment, Node } from '../api/client';
import { getMapLineColor, getMapLineWidth } from '../lib/congestion';

const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

interface Props {
  network?: NetworkData;
  segmentStates?: SegmentState[];
  incidentSegment?: string | null;
  propagationSegments?: string[];
  onSegmentClick?: (segmentId: string) => void;
  selectedSegmentId?: string | null;
  height?: string;
  showIncidentMarker?: boolean;
  highlightSegments?: string[];    // Journey primary route segments
  diversionSegments?: string[];    // Diversion route segments (green)
  vehicleNodeId?: string | null;   // Current vehicle position (node_id)
  segmentCongestionMap?: Map<string, {congestion_score: number, congestion_state: string}>;
  congestionPoints?: {segment_id: string, congestion_score: number}[];
}

function buildGeoJSON(
  network: NetworkData,
  segmentStates?: SegmentState[],
  incidentSegmentId?: string | null,
  propagationSegments?: string[],
  highlightSegments?: string[],
  diversionSegments?: string[],
  segmentCongestionMap?: Map<string, {congestion_score: number, congestion_state: string}>
): GeoJSON.FeatureCollection {
  const nodeMap = new Map<string, Node>(network.nodes.map(n => [n.node_id, n]));
  const stateMap = new Map<string, SegmentState>(
    (segmentStates ?? []).map(s => [s.segment_id ?? s.id ?? '', s])
  );
  const propSet = new Set(propagationSegments ?? []);
  const highlightSet = new Set(highlightSegments ?? []);
  const diversionSet = new Set(diversionSegments ?? []);

  const features: GeoJSON.Feature[] = [];

  for (const seg of network.segments) {
    const segId = seg.segment_id ?? seg.id ?? '';
    const src = nodeMap.get(seg.source_node);
    const tgt = nodeMap.get(seg.target_node);
    if (!src || !tgt) continue;

    const state = stateMap.get(segId);
    
    // Check journey analysis congestion first
    const journeyState = segmentCongestionMap?.get(segId);
    
    const effectiveState = incidentSegmentId === segId
      ? 'incident'
      : (journeyState?.congestion_state ?? state?.congestion_state ?? seg.congestion_state ?? 'normal');
      
    const effectiveScore = journeyState?.congestion_score ?? state?.congestion_score ?? seg.congestion_score ?? 0;

    const isPropagation = propSet.has(segId);
    const isHighlighted = highlightSet.has(segId);
    const isDiversion = diversionSet.has(segId);

    features.push({
      type: 'Feature',
      id: segId,
      properties: {
        id: segId,
        segment_id: segId,
        congestion_state: effectiveState,
        congestion_score: effectiveScore,
        road_class: seg.road_class ?? 'local',
        name: segId,
        is_propagation: isPropagation,
        is_highlighted: isHighlighted,
        is_diversion: isDiversion,
        incident_probability: state?.incident_probability ?? seg.incident_probability ?? 0,
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [src.lon, src.lat],
          [tgt.lon, tgt.lat],
        ],
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

export function NetworkMap({
  network,
  segmentStates,
  incidentSegment,
  propagationSegments,
  onSegmentClick,
  selectedSegmentId,
  height = 'h-full',
  showIncidentMarker,
  highlightSegments = [],
  diversionSegments = [],
  vehicleNodeId,
  segmentCongestionMap,
  congestionPoints,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const incidentMarkerRef = useRef<maplibregl.Marker | null>(null);
  const vehicleMarkerRef = useRef<maplibregl.Marker | null>(null);
  const incidentMarkersRef = useRef<maplibregl.Marker[]>([]);

  // Init map
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [78.45, 17.38],
      zoom: 12,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    mapRef.current = map;
    popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false });

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Update segment data
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !network) return;

    const geojson = buildGeoJSON(network, segmentStates, incidentSegment, propagationSegments, highlightSegments, diversionSegments, segmentCongestionMap);

    const update = () => {
      if (map.getSource('segments')) {
        (map.getSource('segments') as maplibregl.GeoJSONSource).setData(geojson);
      } else {
        map.addSource('segments', { type: 'geojson', data: geojson, generateId: false });
      }

      // Propagation halo
      if (!map.getLayer('segments-propagation')) {
        map.addLayer({
          id: 'segments-propagation',
          type: 'line',
          source: 'segments',
          filter: ['==', ['get', 'is_propagation'], true],
          paint: {
            'line-color': '#f97316',
            'line-width': 6,
            'line-opacity': 0.35,
            'line-blur': 2,
          },
        });
      }

      // Route highlight glow (behind main line)
      if (!map.getLayer('segments-route-glow')) {
        map.addLayer({
          id: 'segments-route-glow',
          type: 'line',
          source: 'segments',
          filter: ['==', ['get', 'is_highlighted'], true],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#6366f1',
            'line-width': 10,
            'line-opacity': 0.25,
            'line-blur': 3,
          },
        });
      } else {
        map.setFilter('segments-route-glow', ['==', ['get', 'is_highlighted'], true]);
      }

      // Diversion route (green)
      if (!map.getLayer('segments-diversion')) {
        map.addLayer({
          id: 'segments-diversion',
          type: 'line',
          source: 'segments',
          filter: ['==', ['get', 'is_diversion'], true],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#22c55e',
            'line-width': 4,
            'line-opacity': 0.85,
            'line-dasharray': [6, 3],
          },
        });
      } else {
        map.setFilter('segments-diversion', ['==', ['get', 'is_diversion'], true]);
      }

      // Base line
      if (!map.getLayer('segments-line')) {
        map.addLayer({
          id: 'segments-line',
          type: 'line',
          source: 'segments',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': getMapLineColor() as maplibregl.ExpressionSpecification,
            'line-width': getMapLineWidth() as maplibregl.ExpressionSpecification,
            'line-opacity': [
              'case',
              ['==', ['get', 'is_highlighted'], true], 1.0,
              ['==', ['get', 'is_diversion'], true], 1.0,
              0.75,
            ] as maplibregl.ExpressionSpecification,
          },
        });

        // Route outline for highlighted segments
        map.addLayer({
          id: 'segments-route-outline',
          type: 'line',
          source: 'segments',
          filter: ['==', ['get', 'is_highlighted'], true],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#4f46e5',
            'line-width': 3.5,
            'line-opacity': 0.9,
          },
        });

        // Selected highlight
        map.addLayer({
          id: 'segments-selected',
          type: 'line',
          source: 'segments',
          filter: ['==', ['get', 'id'], ''],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#818cf8',
            'line-width': 7,
            'line-opacity': 0.9,
          },
        });

        // Hover
        map.on('mousemove', 'segments-line', (e) => {
          map.getCanvas().style.cursor = 'pointer';
          const feat = e.features?.[0];
          if (!feat) return;
          const props = feat.properties;
          const isOnRoute = props.is_highlighted;
          const isDiversion = props.is_diversion;
          const html = `
            <div class="text-sm" style="min-width:150px">
              <p class="font-semibold mb-1">${props.segment_id ?? props.id}
                ${isOnRoute ? '<span style="color:#6366f1"> ● Route</span>' : ''}
                ${isDiversion ? '<span style="color:#22c55e"> ⚡ Diversion</span>' : ''}
              </p>
              <p>State: <strong>${props.congestion_state}</strong></p>
              <p>Score: <strong>${Number(props.congestion_score).toFixed(3)}</strong></p>
              ${props.incident_probability > 0 ? `<p>Inc. Risk: <strong>${(props.incident_probability * 100).toFixed(1)}%</strong></p>` : ''}
            </div>`;
          popupRef.current?.setLngLat(e.lngLat).setHTML(html).addTo(map);
        });

        map.on('mouseleave', 'segments-line', () => {
          map.getCanvas().style.cursor = '';
          popupRef.current?.remove();
        });

        map.on('click', 'segments-line', (e) => {
          const feat = e.features?.[0];
          if (!feat) return;
          onSegmentClick?.(feat.properties.id);
        });
      } else {
        // Update route filters
        map.setFilter('segments-route-outline', ['==', ['get', 'is_highlighted'], true]);
      }
    };

    if (map.isStyleLoaded()) {
      update();
    } else {
      map.once('load', update);
    }
  }, [network, segmentStates, incidentSegment, propagationSegments, highlightSegments, diversionSegments]); // eslint-disable-line

  // Update selected filter
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer('segments-selected')) return;
    map.setFilter('segments-selected', ['==', ['get', 'id'], selectedSegmentId ?? '']);
  }, [selectedSegmentId]);

  // Incident segment markers (red pulse dots on incident segments)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !network) return;

    // Clear old markers
    incidentMarkersRef.current.forEach(m => m.remove());
    incidentMarkersRef.current = [];

    if (showIncidentMarker && incidentSegment) {
      const seg = network.segments.find(s => (s.segment_id ?? s.id) === incidentSegment);
      if (seg) {
        const srcNode = network.nodes.find(n => n.node_id === seg.source_node);
        const tgtNode = network.nodes.find(n => n.node_id === seg.target_node);
        if (srcNode && tgtNode) {
          const midLng = (srcNode.lon + tgtNode.lon) / 2;
          const midLat = (srcNode.lat + tgtNode.lat) / 2;

          // Pulsing ring
          const el = document.createElement('div');
          el.style.cssText = `
            width: 28px; height: 28px; border-radius: 50%;
            background: rgba(239,68,68,0.85); border: 3px solid white;
            box-shadow: 0 0 0 6px rgba(239,68,68,0.35);
            animation: pulse 1.2s infinite;
          `;
          el.innerHTML = '<style>@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.6)}50%{box-shadow:0 0 0 12px rgba(239,68,68,0)}}</style>';

          const marker = new maplibregl.Marker({ element: el })
            .setLngLat([midLng, midLat])
            .setPopup(new maplibregl.Popup({ offset: 20 }).setHTML(`
              <div style="font-size:13px;padding:4px 8px">
                <strong style="color:#dc2626">⚠ Incident: ${incidentSegment}</strong>
              </div>
            `))
            .addTo(map);

          incidentMarkersRef.current.push(marker);
        }
      }
    }

    if (congestionPoints?.length) {
      congestionPoints.forEach(cp => {
        const seg = network.segments.find(s => (s.segment_id ?? s.id) === cp.segment_id);
        if (seg) {
          const srcNode = network.nodes.find(n => n.node_id === seg.source_node);
          const tgtNode = network.nodes.find(n => n.node_id === seg.target_node);
          if (srcNode && tgtNode) {
            const midLng = (srcNode.lon + tgtNode.lon) / 2;
            const midLat = (srcNode.lat + tgtNode.lat) / 2;

            const el = document.createElement('div');
            el.style.cssText = `
              width: 24px; height: 24px; border-radius: 50%;
              background: rgba(249,115,22,0.85); border: 2px solid white;
              box-shadow: 0 0 0 4px rgba(249,115,22,0.35);
              animation: pulse-orange 1.5s infinite;
            `;
            el.innerHTML = '<style>@keyframes pulse-orange{0%,100%{box-shadow:0 0 0 0 rgba(249,115,22,.6)}50%{box-shadow:0 0 0 10px rgba(249,115,22,0)}}</style>';

            const marker = new maplibregl.Marker({ element: el })
              .setLngLat([midLng, midLat])
              .setPopup(new maplibregl.Popup({ offset: 20 }).setHTML(`
                <div style="font-size:13px;padding:4px 8px">
                  <strong style="color:#f97316">⚠ Congestion: ${cp.segment_id}</strong>
                </div>
              `))
              .addTo(map);

            incidentMarkersRef.current.push(marker);
          }
        }
      });
    }

  }, [showIncidentMarker, incidentSegment, network, congestionPoints]);

  // Vehicle marker — moves to current vehicleNodeId position
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !network) return;

    if (!vehicleNodeId) {
      vehicleMarkerRef.current?.remove();
      vehicleMarkerRef.current = null;
      return;
    }

    const node = network.nodes.find(n => n.node_id === vehicleNodeId);
    if (!node) return;

    if (!vehicleMarkerRef.current) {
      const el = document.createElement('div');
      el.style.cssText = `
        width: 20px; height: 20px; border-radius: 50%;
        background: #4f46e5; border: 3px solid white;
        box-shadow: 0 2px 8px rgba(79,70,229,0.7);
        transition: all 0.5s ease;
        display: flex; align-items: center; justify-content: center;
        font-size: 10px;
      `;
      el.textContent = '🚗';
      el.style.fontSize = '14px';
      el.style.background = 'white';
      el.style.border = '2px solid #4f46e5';

      vehicleMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([node.lon, node.lat])
        .addTo(map);
    } else {
      vehicleMarkerRef.current.setLngLat([node.lon, node.lat]);
    }

    // Pan map to follow vehicle gently
    map.easeTo({ center: [node.lon, node.lat], duration: 800, essential: false });

  }, [vehicleNodeId, network]);

  return (
    <div className={`relative ${height} w-full`}>
      <div ref={containerRef} className="absolute inset-0 rounded-xl overflow-hidden" />
    </div>
  );
}
