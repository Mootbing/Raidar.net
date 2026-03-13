'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useRadarStore } from '@/store/gameStore';

/**
 * Border Highlight Layer
 *
 * Highlights specific country borders with accent colors + pulse.
 * This layer does NOT use useLayerData — it reads the same GeoJSON
 * as CountryBorders and filters to highlighted country ISO codes
 * stored in a "highlightedCountries" list (to be added to the store).
 *
 * No API route needed — purely client-side filtering of existing border data.
 */
export function BorderHighlightLayer() {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    // Pulse opacity on highlighted borders
    const pulse = 0.6 + 0.4 * Math.sin(clock.elapsedTime * 2);
    groupRef.current.children.forEach((child) => {
      if ((child as THREE.LineSegments).material) {
        ((child as THREE.LineSegments).material as THREE.LineBasicMaterial).opacity = pulse;
      }
    });
  });

  return (
    <group ref={groupRef}>
      {/* LineSegments for highlighted country borders will be rendered here.
          Implementation: load the same GeoJSON as CountryBorders, filter by
          ISO code, render with thicker lines + highlight color + pulse. */}
    </group>
  );
}
