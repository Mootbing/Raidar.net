'use client';

import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useLayerData } from '@/hooks/useLayerData';
import { useRadarStore } from '@/store/gameStore';
import { GLOBE } from '@/config/constants';

/**
 * Maritime Traffic Layer
 *
 * Renders ship positions as instanced meshes on the globe surface.
 * Ships only appear when you pan to their area — useLayerData handles
 * viewport-based fetching and spatial caching automatically.
 *
 * To activate: implement /api/maritime to return { vessels: [...] }
 * Each vessel needs: { id, lat, lon, heading, speed, name, shipType, flag }
 */

interface Ship {
  id: string;
  lat: number;
  lon: number;
  heading: number;
  speed: number;
  name: string;
  shipType: string;
  flag: string;
}

export function MaritimeLayer() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const ships = useLayerData<Ship>('maritime');
  const setLayerEntities = useRadarStore((s) => s.setLayerEntities);

  // Sync visible entities into the store for search/selection
  useEffect(() => {
    setLayerEntities('maritime', ships);
  }, [ships, setLayerEntities]);

  useFrame(() => {
    if (!meshRef.current || ships.length === 0) return;

    const dummy = new THREE.Object3D();
    meshRef.current.count = ships.length;

    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i];
      const phi = (90 - ship.lat) * (Math.PI / 180);
      const theta = (ship.lon + 180) * (Math.PI / 180);
      const r = GLOBE.MARITIME_SURFACE_OFFSET;

      dummy.position.set(
        -r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
      );
      // Point along surface normal
      dummy.lookAt(0, 0, 0);
      dummy.rotateZ(((ship.heading || 0) * Math.PI) / 180);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, 2000]}
      frustumCulled={false}
    >
      <coneGeometry args={[0.004, 0.01, 3]} />
      <meshBasicMaterial color="#4488ff" transparent opacity={0.8} />
    </instancedMesh>
  );
}
