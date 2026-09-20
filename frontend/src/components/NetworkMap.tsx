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

interface CongestionMarkerData {
  segment_id: string;
  congestion_score: number;
  lon: number;
  lat: number;
  isIncident: boolean;
}

interface CongestionSegmentOverlay {
  segment_id: string;
  congestion_score: number;
  startFrac: number;  // 0..1 fraction along route
  endFrac: number;
}

interface HeatmapSegment {
  segment_id: string;
  congestion_score: number;
  line: [number, number][];
  speed_kmh: number;
  road_class: string;
}

interface Props {
  network?: NetworkData;
  onSegmentClick?: (segmentId: string) => void;
  selectedSegmentId?: string | null;
  height?: string;
  routeCoordinates?: [number, number][];  // Real road-following coords [lon,lat][]
  congestionMarkers?: CongestionMarkerData[];
  congestionSegments?: CongestionSegmentOverlay[];  // colored overlays on route
  sourceNodeId?: string;
  targetNodeId?: string;
  isAnimating?: boolean;
  interventionOverlay?: InterventionOverlay | null;
  heatmapData?: HeatmapSegment[];
}

export function NetworkMap({
  network,
  onSegmentClick,
  selectedSegmentId,
  height = 'h-full',
  routeCoordinates,
  congestionMarkers,
  congestionSegments,
  sourceNodeId,
  targetNodeId,
  isAnimating = false,
  interventionOverlay,
  heatmapData,
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

  // Draw congestion overlays on the route (colored sections)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const drawCongestion = () => {
      // Remove old congestion overlay layers
      const existingLayers = map.getStyle()?.layers || [];
      existingLayers.forEach(l => {
        if (l.id.startsWith('congestion-seg-')) {
          map.removeLayer(l.id);
        }
      });
      // Remove old sources  
      if (map.getSource('congestion-overlay')) map.removeSource('congestion-overlay');

      if (!congestionSegments?.length || !routeCoordinates || routeCoordinates.length < 2) return;

      // Build features: each congestion segment is a sub-linestring of the route
      const features: GeoJSON.Feature[] = [];

      congestionSegments.forEach((cs, idx) => {
        const startIdx = Math.floor(cs.startFrac * (routeCoordinates.length - 1));
        const endIdx = Math.ceil(cs.endFrac * (routeCoordinates.length - 1));
        const coords = routeCoordinates.slice(
          Math.max(0, startIdx),
          Math.min(routeCoordinates.length, endIdx + 1)
        );
        if (coords.length < 2) return;

        // Color by severity
        let color = '#eab308'; // yellow - mild
        if (cs.congestion_score > 0.5) color = '#ef4444';      // red - severe
        else if (cs.congestion_score > 0.3) color = '#f97316';  // orange - moderate
        else if (cs.congestion_score > 0.15) color = '#eab308'; // yellow - mild

        features.push({
          type: 'Feature',
          properties: {
            segment_id: cs.segment_id,
            congestion_score: cs.congestion_score,
            color,
            index: idx,
          },
          geometry: {
            type: 'LineString',
            coordinates: coords,
          },
        });
      });

      if (!features.length) return;

      map.addSource('congestion-overlay', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });

      // Congestion glow (outer)
      map.addLayer({
        id: 'congestion-seg-glow',
        type: 'line',
        source: 'congestion-overlay',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'color'] as any,
          'line-width': 16,
          'line-opacity': 0.3,
          'line-blur': 5,
        },
      });

      // Congestion line (on top of route)
      map.addLayer({
        id: 'congestion-seg-line',
        type: 'line',
        source: 'congestion-overlay',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'color'] as any,
          'line-width': 7,
          'line-opacity': 0.85,
        },
      });

      // Hover popup for congestion segments
      map.on('mousemove', 'congestion-seg-line', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        const feat = e.features?.[0];
        if (!feat) return;
        const props = feat.properties;
        popupRef.current?.setLngLat(e.lngLat).setHTML(
          `<div style="padding:4px 8px;font-size:12px">
            <strong style="color:${props.color}">\u26A0 ${props.segment_id}</strong>
            <br/>Congestion: ${(Number(props.congestion_score) * 100).toFixed(1)}%
          </div>`
        ).addTo(map);
      });
      map.on('mouseleave', 'congestion-seg-line', () => {
        map.getCanvas().style.cursor = '';
        popupRef.current?.remove();
      });
    };

    if (map.isStyleLoaded()) {
      drawCongestion();
    } else {
      map.once('load', drawCongestion);
    }
  }, [congestionSegments, routeCoordinates]);

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

  // Congestion point markers — positioned on the actual route
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear old markers
    congestionMarkersRef.current.forEach(m => m.remove());
    congestionMarkersRef.current = [];

    if (!congestionMarkers?.length) return;

    congestionMarkers.forEach(cm => {
      const bgColor = cm.isIncident ? 'rgba(239,68,68,0.9)' : 'rgba(249,115,22,0.9)';
      const shadowColor = cm.isIncident ? 'rgba(239,68,68,0.4)' : 'rgba(249,115,22,0.4)';

      const el = document.createElement('div');
      el.style.cssText = `
        width: 24px; height: 24px; border-radius: 50%;
        background: ${bgColor}; border: 2px solid white;
        box-shadow: 0 0 0 4px ${shadowColor};
        animation: cpulse 1.5s infinite;
        display: flex; align-items: center; justify-content: center;
        font-size: 10px; color: white; font-weight: bold;
      `;
      el.textContent = cm.isIncident ? '!' : '\u25CF';
      el.innerHTML += '<style>@keyframes cpulse{0%,100%{transform:scale(1)}50%{transform:scale(1.2)}}</style>';

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([cm.lon, cm.lat])
        .setPopup(new maplibregl.Popup({ offset: 16 }).setHTML(
          `<div style="padding:4px 8px;font-size:12px">
            <strong style="color:${cm.isIncident ? '#dc2626' : '#f97316'}">${cm.isIncident ? '\u26A0 Incident' : '\u26A0 Congestion'}: ${cm.segment_id}</strong>
            <br/>${(cm.congestion_score * 100).toFixed(1)}% congestion
          </div>`
        ))
        .addTo(map);

      congestionMarkersRef.current.push(marker);
    });
  }, [congestionMarkers]);

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

  // ── Heatmap: city-wide congestion visualization ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const cleanup = () => {
      if (map.getLayer('heatmap-glow')) map.removeLayer('heatmap-glow');
      if (map.getLayer('heatmap-lines')) map.removeLayer('heatmap-lines');
      if (map.getSource('heatmap-source')) map.removeSource('heatmap-source');
    };

    if (!heatmapData?.length) {
      try { cleanup(); } catch {}
      return;
    }

    const drawHeatmap = () => {
      cleanup();

      const features = heatmapData.map(seg => {
        const score = seg.congestion_score;
        // Color: green (0) -> yellow (0.15) -> orange (0.3) -> red (0.5+)
        let color = '#22c55e'; // green
        if (score > 0.5) color = '#ef4444';      // red
        else if (score > 0.3) color = '#f97316';  // orange
        else if (score > 0.15) color = '#eab308'; // yellow
        else if (score > 0.05) color = '#84cc16'; // lime
        
        return {
          type: 'Feature' as const,
          properties: { 
            segment_id: seg.segment_id, 
            score, 
            color,
            speed: seg.speed_kmh,
            road: seg.road_class,
          },
          geometry: {
            type: 'LineString' as const,
            coordinates: seg.line,
          },
        };
      });

      map.addSource('heatmap-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });

      // Glow layer
      map.addLayer({
        id: 'heatmap-glow',
        type: 'line',
        source: 'heatmap-source',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 8,
          'line-opacity': 0.35,
          'line-blur': 4,
        },
      });

      // Main line
      map.addLayer({
        id: 'heatmap-lines',
        type: 'line',
        source: 'heatmap-source',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 4,
          'line-opacity': 0.85,
        },
      });

      // Hover popup
      map.on('mouseenter', 'heatmap-lines', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'heatmap-lines', () => { map.getCanvas().style.cursor = ''; });
      map.on('click', 'heatmap-lines', (e) => {
        const feat = e.features?.[0];
        if (!feat) return;
        const p = feat.properties;
        new maplibregl.Popup({ closeButton: true, maxWidth: '200px' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-family:system-ui;font-size:12px">
              <b>${p?.segment_id}</b><br/>
              Congestion: <b style="color:${p?.color}">${(p?.score * 100).toFixed(1)}%</b><br/>
              Speed: ${p?.speed} km/h<br/>
              Road: ${p?.road}
            </div>
          `)
          .addTo(map);
      });
    };

    if (map.isStyleLoaded()) {
      drawHeatmap();
    } else {
      map.once('load', drawHeatmap);
    }
  }, [heatmapData]);

  return (
    <div className={`relative ${height} w-full`}>
      <div ref={containerRef} className="absolute inset-0 rounded-xl overflow-hidden" />
    </div>
  );
}
