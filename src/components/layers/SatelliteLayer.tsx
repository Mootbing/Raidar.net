'use client';

import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useLayerData } from '@/hooks/useLayerData';
import { useRadarStore } from '@/store/gameStore';
import { GLOBE } from '@/config/constants';

/**
 * Satellite Overhead Layer
 *
 * Renders satellite positions above the globe with orbital tracks.
 * Data is fetched globally (not per-viewport) since satellites orbit everywhere.
 * Client-side SGP4 propagation recommended for real-time position updates.
 *
 * To activate: implement /api/satellites to return { satellites: [...] }
 * Each satellite needs: { id, name, noradId, lat, lon, alt, orbitType, operator }
 *
 * For real orbital math, install satellite.js and propagate TLE data per-frame.
 */

interface Satellite {
  id: string;
  name: string;
  noradId: string;
  lat: number;
  lon: number;
  alt: number; // km above earth
  orbitType: string;
  operator: string;
}

export function SatelliteLayer() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const satellites = useLayerData<Satellite>('satellites');
  const setLayerEntities = useRadarStore((s) => s.setLayerEntities);

  useEffect(() => {
    setLayerEntities('satellites', satellites);
  }, [satellites, setLayerEntities]);

  useFrame(() => {
    if (!meshRef.current || satellites.length === 0) return;

    const dummy = new THREE.Object3D();
    meshRef.current.count = satellites.length;

    for (let i = 0; i < satellites.length; i++) {
      const sat = satellites[i];
      const phi = (90 - sat.lat) * (Math.PI / 180);
      const theta = (sat.lon + 180) * (Math.PI / 180);
      // Scale altitude: LEO ~200-2000km, GEO ~35786km
      const altNorm = Math.min(sat.alt / 35786, 1);
      const r =
        GLOBE.SATELLITE_MIN_ALTITUDE +
        altNorm * (GLOBE.SATELLITE_MAX_ALTITUDE - GLOBE.SATELLITE_MIN_ALTITUDE);

      dummy.position.set(
        -r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
      );
      dummy.lookAt(0, 0, 0);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, 5000]}
        frustumCulled={false}
      >
        <octahedronGeometry args={[0.003, 0]} />
        <meshBasicMaterial color="#ff66aa" transparent opacity={0.8} />
      </instancedMesh>
    </group>
  );
}
