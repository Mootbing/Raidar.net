'use client';

import { useRef, useMemo, useCallback, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useRadarStore } from '@/store/gameStore';
import { useCountryGeoJSON, GeoJSONFeature } from '@/hooks/useGeoJSON';
import { latLonToVector3 } from '@/utils/geo';
import { GLOBE, COLORS } from '@/config/constants';

// ============================================================================
// POINT-IN-POLYGON UTILITIES
// Ray casting algorithm for GeoJSON country detection
// ============================================================================

function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInFeature(lon: number, lat: number, feature: GeoJSONFeature): boolean {
  const { type, coordinates } = feature.geometry;

  if (type === 'Polygon') {
    const rings = coordinates as number[][][];
    if (!pointInRing(lon, lat, rings[0])) return false;
    for (let i = 1; i < rings.length; i++) {
      if (pointInRing(lon, lat, rings[i])) return false;
    }
    return true;
  } else if (type === 'MultiPolygon') {
    const polygons = coordinates as number[][][][];
    for (const polygon of polygons) {
      if (!pointInRing(lon, lat, polygon[0])) continue;
      let inHole = false;
      for (let i = 1; i < polygon.length; i++) {
        if (pointInRing(lon, lat, polygon[i])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
  }
  return false;
}

function getCountryAtPoint(lat: number, lon: number, features: GeoJSONFeature[]): string | null {
  for (const feature of features) {
    if (feature.id && pointInFeature(lon, lat, feature)) {
      return feature.id as string;
    }
  }
  return null;
}

function vector3ToLatLon(point: THREE.Vector3): { lat: number; lon: number } {
  const r = point.length();
  const lat = 90 - Math.acos(Math.max(-1, Math.min(1, point.y / r))) * (180 / Math.PI);
  const lon = Math.atan2(point.z, -point.x) * (180 / Math.PI) - 180;
  return { lat, lon };
}

// ============================================================================
// BORDER HIGHLIGHT LAYER
// Renders highlighted country borders with pulse animation.
// Click-to-highlight uses canvas-level click + manual sphere raycast so it
// never blocks pointer events from reaching airports/aircraft/etc.
// ============================================================================

// Pre-allocated raycaster for click detection
const _raycaster = new THREE.Raycaster();
const _pointer = new THREE.Vector2();
const _sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), GLOBE.BORDER_HIGHLIGHT_OFFSET);
const _intersectPoint = new THREE.Vector3();

export function BorderHighlightLayer() {
  const geojson = useCountryGeoJSON();
  const highlighted = useRadarStore((s) => s.highlightedCountries);
  const toggleHighlightedCountry = useRadarStore((s) => s.toggleHighlightedCountry);
  const groupRef = useRef<THREE.Group>(null);
  const { camera, gl } = useThree();

  // Track mouse down position to distinguish clicks from drags
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);

  // Canvas-level click handler — does NOT block other R3F pointer events
  useEffect(() => {
    const canvas = gl.domElement;

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos.current = { x: e.clientX, y: e.clientY };
    };

    const onClick = (e: MouseEvent) => {
      if (!geojson) return;

      // Ignore drags (moved more than 4px)
      if (pointerDownPos.current) {
        const dx = e.clientX - pointerDownPos.current.x;
        const dy = e.clientY - pointerDownPos.current.y;
        if (dx * dx + dy * dy > 16) return;
      }

      // Convert screen coords to NDC
      const rect = canvas.getBoundingClientRect();
      _pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      _pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      // Raycast against an invisible sphere (no mesh needed)
      _raycaster.setFromCamera(_pointer, camera);
      const hit = _raycaster.ray.intersectSphere(_sphere, _intersectPoint);
      if (!hit) return;

      const { lat, lon } = vector3ToLatLon(_intersectPoint);
      const countryCode = getCountryAtPoint(lat, lon, geojson.features);
      if (countryCode) {
        toggleHighlightedCountry(countryCode, COLORS.LAYER_BORDER_HIGHLIGHT, 'manual');
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('click', onClick);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('click', onClick);
    };
  }, [geojson, toggleHighlightedCountry, camera, gl]);

  // Build LineSegments geometry from highlighted countries' borders
  const geometry = useMemo(() => {
    if (!geojson || highlighted.length === 0) return null;

    const highlightedCodes = new Set(highlighted.map(h => h.code));
    const features = geojson.features.filter(
      (f) => f.id && highlightedCodes.has(f.id as string)
    );

    if (features.length === 0) return null;

    const positions: number[] = [];

    const processRing = (ring: number[][]) => {
      for (let i = 0; i < ring.length - 1; i++) {
        const [lon1, lat1] = ring[i];
        const [lon2, lat2] = ring[i + 1];
        const p1 = latLonToVector3(lat1, lon1, 0, GLOBE.BORDER_HIGHLIGHT_OFFSET);
        const p2 = latLonToVector3(lat2, lon2, 0, GLOBE.BORDER_HIGHLIGHT_OFFSET);
        positions.push(p1.x, p1.y, p1.z);
        positions.push(p2.x, p2.y, p2.z);
      }
    };

    for (const feature of features) {
      const { type, coordinates } = feature.geometry;
      if (type === 'Polygon') {
        (coordinates as number[][][]).forEach(processRing);
      } else if (type === 'MultiPolygon') {
        (coordinates as number[][][][]).forEach(polygon => {
          polygon.forEach(processRing);
        });
      }
    }

    if (positions.length === 0) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, [geojson, highlighted]);

  // Pulse opacity animation
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 2);
    groupRef.current.children.forEach(child => {
      if ((child as THREE.LineSegments).material) {
        const mat = (child as THREE.LineSegments).material as THREE.LineBasicMaterial;
        mat.opacity = 0.4 + 0.5 * pulse;
      }
    });
  });

  if (!geometry) return null;

  return (
    <group ref={groupRef}>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial
          color={COLORS.LAYER_BORDER_HIGHLIGHT}
          transparent
          opacity={0.8}
          linewidth={1}
        />
      </lineSegments>
    </group>
  );
}
