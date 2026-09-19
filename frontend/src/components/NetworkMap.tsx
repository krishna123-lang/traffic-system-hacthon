import { useEffect, useRef, useCallback, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { NetworkData, Node } from '../api/client';

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

interface InterventionOverlay {
  type: string;  // flyover, lane_addition, signal_optimization, connector, capacity_upgrade
  segments: string[];
  label: string;
}

interface Props {
  network?: NetworkData;
  onSegmentClick?: (segmentId: string) => void;
  selectedSegmentId?: string | null;
  height?: string;
  routeCoordinates?: [number, number][];  // Real road-following coords [lon,lat][]
  congestionPoints?: {segment_id: string, congestion_score: number}[];
  incidentSegments?: string[];
  sourceNodeId?: string;
  targetNodeId?: string;
  isAnimating?: boolean;
  interventionOverlay?: InterventionOverlay | null;
}

export function NetworkMap({
  network,
  onSegmentClick,
  selectedSegmentId,
  height = 'h-full',
  routeCoordinates,
  congestionPoints,
  incidentSegments,
  sourceNodeId,
  targetNodeId,
  isAnimating = false,
  interventionOverlay,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const vehicleMarkerRef = useRef<maplibregl.Marker | null>(null);
  const sourceMarkerRef = useRef<maplibregl.Marker | null>(null);
  const targetMarkerRef = useRef<maplibregl.Marker | null>(null);
  const congestionMarkersRef = useRef<maplibregl.Marker[]>([]);
  const animationRef = useRef<number | null>(null);
  const animProgressRef = useRef(0);
  const [vehiclePos, setVehiclePos] = useState<[number, number] | null>(null);

  // Init map - clean, no grid
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

    return () => { 
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      map.remove(); 
      mapRef.current = null; 
    };
  }, []);

  // Draw route on map (real road-following coordinates)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const drawRoute = () => {
      // Remove old route layers/sources
      ['route-glow', 'route-line', 'route-direction'].forEach(id => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource('route')) map.removeSource('route');

      if (!routeCoordinates || routeCoordinates.length < 2) return;

      const geojson: GeoJSON.Feature = {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: routeCoordinates,
        },
      };

      map.addSource('route', { type: 'geojson', data: geojson });

      // Outer glow
      map.addLayer({
        id: 'route-glow',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#6366f1',
          'line-width': 12,
          'line-opacity': 0.2,
          'line-blur': 4,
        },
      });

      // Main route line
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#4f46e5',
          'line-width': 5,
          'line-opacity': 0.9,
        },
      });

      // Fit map to route bounds
      const lngs = routeCoordinates.map(c => c[0]);
      const lats = routeCoordinates.map(c => c[1]);
      map.fitBounds(
        [[Math.min(...lngs) - 0.01, Math.min(...lats) - 0.01],
         [Math.max(...lngs) + 0.01, Math.max(...lats) + 0.01]],
        { padding: 80, duration: 1000 }
      );
    };

    if (map.isStyleLoaded()) {
      drawRoute();
    } else {
      map.once('load', drawRoute);
    }
  }, [routeCoordinates]);

  // Source and destination markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !network) return;

    // Remove old markers
    sourceMarkerRef.current?.remove();
    targetMarkerRef.current?.remove();
    sourceMarkerRef.current = null;
    targetMarkerRef.current = null;

    const addNodeMarker = (nodeId: string | undefined, color: string, label: string) => {
      if (!nodeId) return null;
      const node = network.nodes.find(n => n.node_id === nodeId);
      if (!node) return null;

      const el = document.createElement('div');
      el.style.cssText = `
        width: 32px; height: 32px; border-radius: 50%;
        background: ${color}; border: 3px solid white;
        box-shadow: 0 2px 10px ${color}80;
        display: flex; align-items: center; justify-content: center;
        font-size: 14px; font-weight: bold; color: white;
        cursor: pointer;
      `;
      el.textContent = label;

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([node.lon, node.lat])
        .setPopup(new maplibregl.Popup({ offset: 20 }).setHTML(
          `<div style="padding:4px 8px;font-size:13px"><strong>${nodeId}</strong> (${label === 'S' ? 'Source' : 'Destination'})</div>`
        ))
        .addTo(map);
      return marker;
    };

    sourceMarkerRef.current = addNodeMarker(sourceNodeId, '#22c55e', 'S');
    targetMarkerRef.current = addNodeMarker(targetNodeId, '#ef4444', 'D');
  }, [sourceNodeId, targetNodeId, network]);

  // Congestion point markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !network) return;

    // Clear old markers
    congestionMarkersRef.current.forEach(m => m.remove());
    congestionMarkersRef.current = [];

    if (!congestionPoints?.length) return;

    congestionPoints.forEach(cp => {
      const seg = network.segments.find(s => (s.segment_id ?? s.id) === cp.segment_id);
      if (!seg) return;
      const srcNode = network.nodes.find(n => n.node_id === seg.source_node);
      const tgtNode = network.nodes.find(n => n.node_id === seg.target_node);
      if (!srcNode || !tgtNode) return;

      const midLng = (srcNode.lon + tgtNode.lon) / 2;
      const midLat = (srcNode.lat + tgtNode.lat) / 2;

      const isIncident = incidentSegments?.includes(cp.segment_id);
      const bgColor = isIncident ? 'rgba(239,68,68,0.9)' : 'rgba(249,115,22,0.9)';
      const shadowColor = isIncident ? 'rgba(239,68,68,0.4)' : 'rgba(249,115,22,0.4)';

      const el = document.createElement('div');
      el.style.cssText = `
        width: 24px; height: 24px; border-radius: 50%;
        background: ${bgColor}; border: 2px solid white;
        box-shadow: 0 0 0 4px ${shadowColor};
        animation: cpulse 1.5s infinite;
        display: flex; align-items: center; justify-content: center;
        font-size: 10px; color: white; font-weight: bold;
      `;
      el.textContent = isIncident ? '!' : '●';
      el.innerHTML += '<style>@keyframes cpulse{0%,100%{transform:scale(1)}50%{transform:scale(1.2)}}</style>';

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([midLng, midLat])
        .setPopup(new maplibregl.Popup({ offset: 16 }).setHTML(
          `<div style="padding:4px 8px;font-size:12px">
            <strong style="color:${isIncident ? '#dc2626' : '#f97316'}">${isIncident ? '⚠ Incident' : '⚠ Congestion'}: ${cp.segment_id}</strong>
            <br/>${(cp.congestion_score * 100).toFixed(1)}% congestion
          </div>`
        ))
        .addTo(map);

      congestionMarkersRef.current.push(marker);
    });
  }, [congestionPoints, incidentSegments, network]);

  // Vehicle animation along route
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !routeCoordinates || routeCoordinates.length < 2) {
      vehicleMarkerRef.current?.remove();
      vehicleMarkerRef.current = null;
      return;
    }

    // Create vehicle marker if not exists
    if (!vehicleMarkerRef.current) {
      const el = document.createElement('div');
      el.style.cssText = `
        width: 36px; height: 36px; border-radius: 50%;
        background: white; border: 3px solid #4f46e5;
        box-shadow: 0 2px 12px rgba(79,70,229,0.5);
        display: flex; align-items: center; justify-content: center;
        font-size: 18px;
        transition: transform 0.1s ease;
        z-index: 100;
      `;
      el.textContent = '🚗';

      vehicleMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat(routeCoordinates[0] as [number, number])
        .addTo(map);
    }

    // Calculate total route distance in coordinate space
    let totalDist = 0;
    const segDists: number[] = [0];
    for (let i = 1; i < routeCoordinates.length; i++) {
      const dx = routeCoordinates[i][0] - routeCoordinates[i - 1][0];
      const dy = routeCoordinates[i][1] - routeCoordinates[i - 1][1];
      totalDist += Math.sqrt(dx * dx + dy * dy);
      segDists.push(totalDist);
    }

    // Interpolate position along route
    const getPositionAt = (progress: number): [number, number] => {
      const targetDist = progress * totalDist;
      for (let i = 1; i < segDists.length; i++) {
        if (segDists[i] >= targetDist) {
          const segStart = segDists[i - 1];
          const segEnd = segDists[i];
          const t = segEnd === segStart ? 0 : (targetDist - segStart) / (segEnd - segStart);
          return [
            routeCoordinates[i - 1][0] + t * (routeCoordinates[i][0] - routeCoordinates[i - 1][0]),
            routeCoordinates[i - 1][1] + t * (routeCoordinates[i][1] - routeCoordinates[i - 1][1]),
          ];
        }
      }
      return routeCoordinates[routeCoordinates.length - 1] as [number, number];
    };

    if (isAnimating) {
      let startTime: number | null = null;
      const DURATION = 20000; // 20 seconds for full route

      const animate = (timestamp: number) => {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / DURATION, 1);

        const pos = getPositionAt(progress);
        vehicleMarkerRef.current?.setLngLat(pos);
        setVehiclePos(pos);
        animProgressRef.current = progress;

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          // Loop: restart after a brief pause
          setTimeout(() => {
            startTime = null;
            animationRef.current = requestAnimationFrame(animate);
          }, 2000);
        }
      };

      animationRef.current = requestAnimationFrame(animate);
    } else {
      // Place vehicle at start
      vehicleMarkerRef.current?.setLngLat(routeCoordinates[0] as [number, number]);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [routeCoordinates, isAnimating]);

  // Intervention overlay visualization
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !network) return;

    const drawOverlay = () => {
      // Remove old intervention layers
      ['intervention-glow', 'intervention-line', 'intervention-dashed'].forEach(id => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource('intervention')) map.removeSource('intervention');

      // Remove old intervention markers
      document.querySelectorAll('.intervention-marker').forEach(el => el.remove());

      if (!interventionOverlay || !interventionOverlay.segments.length) return;

      const nodeMap = new Map<string, Node>(network.nodes.map(n => [n.node_id, n]));
      const features: GeoJSON.Feature[] = [];

      interventionOverlay.segments.forEach(segId => {
        const seg = network.segments.find(s => (s.segment_id ?? s.id) === segId);
        if (!seg) return;
        const src = nodeMap.get(seg.source_node);
        const tgt = nodeMap.get(seg.target_node);
        if (!src || !tgt) return;

        // For connectors and flyovers, offset the line slightly to show as parallel
        const dx = tgt.lon - src.lon;
        const dy = tgt.lat - src.lat;
        const len = Math.sqrt(dx * dx + dy * dy);
        const offset = len > 0 ? 0.001 : 0; // ~100m offset
        const nx = -dy / (len || 1) * offset;
        const ny = dx / (len || 1) * offset;

        const useOffset = ['flyover', 'connector', 'lane_addition'].includes(interventionOverlay.type);

        features.push({
          type: 'Feature',
          properties: { type: interventionOverlay.type, segment_id: segId },
          geometry: {
            type: 'LineString',
            coordinates: useOffset
              ? [[src.lon + nx, src.lat + ny], [tgt.lon + nx, tgt.lat + ny]]
              : [[src.lon, src.lat], [tgt.lon, tgt.lat]],
          },
        });

        // Add icon marker at midpoint
        const midLon = (src.lon + tgt.lon) / 2 + (useOffset ? nx : 0);
        const midLat = (src.lat + tgt.lat) / 2 + (useOffset ? ny : 0);

        const icons: Record<string, string> = {
          flyover: '🌉',
          lane_addition: '🛣️',
          signal_optimization: '🚦',
          connector: '🔗',
          capacity_upgrade: '🔧',
        };

        const el = document.createElement('div');
        el.className = 'intervention-marker';
        el.style.cssText = `
          width: 32px; height: 32px; border-radius: 8px;
          background: rgba(99,102,241,0.95); border: 2px solid white;
          box-shadow: 0 2px 10px rgba(99,102,241,0.5);
          display: flex; align-items: center; justify-content: center;
          font-size: 16px; cursor: pointer;
          animation: bounce-in 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
        `;
        el.textContent = icons[interventionOverlay.type] || '⚡';
        el.innerHTML += '<style>@keyframes bounce-in{0%{transform:scale(0)}50%{transform:scale(1.3)}100%{transform:scale(1)}}</style>';

        new maplibregl.Marker({ element: el })
          .setLngLat([midLon, midLat])
          .setPopup(new maplibregl.Popup({ offset: 20 }).setHTML(
            `<div style="padding:6px 10px;font-size:12px;max-width:200px">
              <strong style="color:#4f46e5">${interventionOverlay.label}</strong>
              <br/><span style="color:#666">Segment: ${segId}</span>
            </div>`
          ))
          .addTo(map);
      });

      if (!features.length) return;

      map.addSource('intervention', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });

      // Style by type
      const colors: Record<string, string> = {
        flyover: '#8b5cf6',      // purple
        lane_addition: '#06b6d4', // cyan
        signal_optimization: '#f59e0b', // amber
        connector: '#10b981',     // emerald
        capacity_upgrade: '#f97316', // orange
      };

      const color = colors[interventionOverlay.type] || '#6366f1';

      // Glow
      map.addLayer({
        id: 'intervention-glow',
        type: 'line',
        source: 'intervention',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': color,
          'line-width': 14,
          'line-opacity': 0.3,
          'line-blur': 4,
        },
      });

      // Dashed line
      map.addLayer({
        id: 'intervention-dashed',
        type: 'line',
        source: 'intervention',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': color,
          'line-width': 4,
          'line-opacity': 0.9,
          'line-dasharray': [4, 3],
        },
      });
    };

    if (map.isStyleLoaded()) {
      drawOverlay();
    } else {
      map.once('load', drawOverlay);
    }
  }, [interventionOverlay, network]);

  return (
    <div className={`relative ${height} w-full`}>
      <div ref={containerRef} className="absolute inset-0 rounded-xl overflow-hidden" />
    </div>
  );
}
