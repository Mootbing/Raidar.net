'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useRadarStore } from '@/store/gameStore';
import { latLonToVector3 } from '@/utils/geo';
import { useCountryGeoJSON } from '@/hooks/useGeoJSON';
import { GLOBE, BORDERS, COLORS } from '@/config/constants';

// ============================================================================
// COUNTRY BORDERS COMPONENT
// Draws animated country borders on the globe
// Uses shared GeoJSON hook to avoid duplicate fetches
// ============================================================================

export function CountryBorders() {
  const geojson = useCountryGeoJSON();
  const introPhase = useRadarStore((s) => s.introPhase);
  const loadingProgress = useRadarStore((s) => s.loadingProgress);

  const fadeStartTime = useRef<number | null>(null);

  // Process GeoJSON into line segment positions
  const lineData = useMemo(() => {
    if (!geojson) return null;

    const allPoints: number[] = [];

    const processRing = (ring: number[][]) => {
      for (let i = 0; i < ring.length - 1; i++) {
        const [lon1, lat1] = ring[i];
        const [lon2, lat2] = ring[i + 1];

        const p1 = latLonToVector3(lat1, lon1, 0, GLOBE.BORDER_SURFACE_OFFSET);
        const p2 = latLonToVector3(lat2, lon2, 0, GLOBE.BORDER_SURFACE_OFFSET);

        allPoints.push(p1.x, p1.y, p1.z);
        allPoints.push(p2.x, p2.y, p2.z);
      }
    };

    geojson.features.forEach((feature) => {
      const { type, coordinates } = feature.geometry;

      if (type === 'Polygon') {
        (coordinates as number[][][]).forEach(processRing);
      } else if (type === 'MultiPolygon') {
        (coordinates as number[][][][]).forEach((polygon) => {
          polygon.forEach(processRing);
        });
      }
    });

    const totalSegments = allPoints.length / 6;
    return { positions: new Float32Array(allPoints), totalSegments };
  }, [geojson]);

  // Create geometry and material when data is ready - useMemo for stable references
  const threeObjects = useMemo(() => {
    if (!lineData) return null;

    // Create geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(lineData.positions, 3));
    geometry.setDrawRange(0, 0); // Start hidden

    // Create material
    const material = new THREE.LineBasicMaterial({
      color: COLORS.BORDERS_LINE,
      transparent: true,
      opacity: 0,
    });

    return { geometry, material };
  }, [lineData]);

  // Animate draw range synced to loading progress
  useFrame((state) => {
    if (!threeObjects || !lineData) return;

    const { geometry, material } = threeObjects;

    // Only animate when borders phase is active
    if (introPhase !== 'borders' && introPhase !== 'airports' && introPhase !== 'docks' && introPhase !== 'maritime' && introPhase !== 'aircraft' && introPhase !== 'satellites' && introPhase !== 'complete') {
      geometry.setDrawRange(0, 0);
      return;
    }

    // Borders finish drawing at 50% loading progress (0-50 → 0-1)
    const progress = Math.min(1, (loadingProgress / 50));

    // Ease out cubic for smooth draw
    const eased = 1 - Math.pow(1 - progress, 3);
    const vertexCount = Math.floor(eased * lineData.positions.length / 3);
    geometry.setDrawRange(0, vertexCount);

    // Two-phase opacity: 10% while drawing, then fade to 50% after complete
    // Three.js objects are intentionally mutable in useFrame
    /* eslint-disable react-hooks/immutability */
    if (progress < 1) {
      // Drawing phase: keep at low opacity
      material.opacity = BORDERS.DRAW_OPACITY;
      fadeStartTime.current = null;
    } else {
      // Drawing complete: fade from DRAW_OPACITY to FINAL_OPACITY
      if (fadeStartTime.current === null) {
        fadeStartTime.current = state.clock.elapsedTime;
      }

      const fadeElapsed = state.clock.elapsedTime - fadeStartTime.current;
      const fadeProgress = Math.min(1, fadeElapsed / BORDERS.FADE_IN_DURATION);

      // Ease out for smooth fade
      const fadeEased = 1 - Math.pow(1 - fadeProgress, 2);
      material.opacity = BORDERS.DRAW_OPACITY + (BORDERS.FINAL_OPACITY - BORDERS.DRAW_OPACITY) * fadeEased;
    }
    /* eslint-enable react-hooks/immutability */
  });

  if (!threeObjects) return null;

  return (
    <lineSegments geometry={threeObjects.geometry} material={threeObjects.material} />
  );
}
