import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Waypoint } from '../api/client';

interface Vehicle {
  id: string;
  waypoints: Waypoint[];
  color?: string;
}

interface Props {
  map: MapLibreMap | null;
  vehicles: Vehicle[];
  speedFactor?: number;
}

interface VehicleState {
  wpIndex: number;
  progress: number; // 0..1 between waypoints
  lon: number;
  lat: number;
  active: boolean;
}

export function useVehicleAnimation(
  map: MapLibreMap | null,
  vehicles: Vehicle[],
  speedFactor: number = 1
) {
  const statesRef = useRef<Map<string, VehicleState>>(new Map());
  const frameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!map || !vehicles.length) return;

    // Init states
    vehicles.forEach(v => {
      if (!statesRef.current.has(v.id) && v.waypoints.length > 0) {
        statesRef.current.set(v.id, {
          wpIndex: 0,
          progress: 0,
          lon: v.waypoints[0].lon,
          lat: v.waypoints[0].lat,
          active: true,
        });
      }
    });

    // Ensure source/layer exists
    const sourceId = 'vehicles-source';
    const layerId = 'vehicles-layer';

    const initLayer = () => {
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: 'circle',
          source: sourceId,
          paint: {
            'circle-radius': 6,
            'circle-color': ['get', 'color'],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#fff',
            'circle-opacity': 0.9,
          },
        });
      }
    };

    if (map.isStyleLoaded()) initLayer();
    else map.once('load', initLayer);

    const STEP_MS = 200; // update interval ms
    const animate = (timestamp: number) => {
      const elapsed = timestamp - lastTimeRef.current;
      if (elapsed < STEP_MS) {
        frameRef.current = requestAnimationFrame(animate);
        return;
      }
      lastTimeRef.current = timestamp;

      const features: GeoJSON.Feature[] = [];

      vehicles.forEach(v => {
        const state = statesRef.current.get(v.id);
        if (!state || !state.active || v.waypoints.length < 2) return;

        const wp = v.waypoints[state.wpIndex];
        const nextWp = v.waypoints[state.wpIndex + 1];
        if (!nextWp) {
          state.active = false;
          return;
        }

        // Speed factor: congested segments are slower
        const segSpeed = wp.speed_factor ?? 1;
        const step = (0.05 * speedFactor * segSpeed);
        state.progress += step;

        if (state.progress >= 1) {
          state.progress = 0;
          state.wpIndex = Math.min(state.wpIndex + 1, v.waypoints.length - 2);
        }

        const t = state.progress;
        state.lon = wp.lon + (nextWp.lon - wp.lon) * t;
        state.lat = wp.lat + (nextWp.lat - wp.lat) * t;

        features.push({
          type: 'Feature',
          properties: { id: v.id, color: v.color ?? '#4f46e5' },
          geometry: { type: 'Point', coordinates: [state.lon, state.lat] },
        });
      });

      const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData({ type: 'FeatureCollection', features });
      }

      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameRef.current);
      // Clean up layers
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      statesRef.current.clear();
    };
  }, [map, vehicles, speedFactor]); // eslint-disable-line
}

// RouteLayer — draws route polylines on the map
interface RouteLayerProps {
  map: MapLibreMap | null;
  routes: { id: string; coordinates: [number, number][]; color: string; width?: number }[];
}

export function useRouteLayer({ map, routes }: RouteLayerProps) {
  useEffect(() => {
    if (!map) return;

    const addedSourceIds: string[] = [];
    const addedLayerIds: string[] = [];

    const init = () => {
      routes.forEach(r => {
        const srcId = `route-src-${r.id}`;
        const layId = `route-layer-${r.id}`;
        addedSourceIds.push(srcId);
        addedLayerIds.push(layId);

        if (!map.getSource(srcId)) {
          map.addSource(srcId, {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: r.coordinates },
            },
          });
        }

        if (!map.getLayer(layId)) {
          map.addLayer({
            id: layId,
            type: 'line',
            source: srcId,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': r.color,
              'line-width': r.width ?? 4,
              'line-opacity': 0.75,
            },
          });
        }
      });
    };

    if (map.isStyleLoaded()) init();
    else map.once('load', init);

    return () => {
      addedLayerIds.forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
      addedSourceIds.forEach(id => { if (map.getSource(id)) map.removeSource(id); });
    };
  }, [map, routes]); // eslint-disable-line
}
