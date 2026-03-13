'use client';

import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useLayerData } from '@/hooks/useLayerData';
import { useRadarStore } from '@/store/gameStore';
import { GLOBE } from '@/config/constants';

/**
 * Shipping Docks / Ports Layer
 *
 * Static markers for major ports. Fetched once globally (no polling).
 * Only ports within the current viewport are rendered (via useLayerData cache).
 *
 * To activate: implement /api/docks to return { docks: [...] }
 * Each dock needs: { id, name, portCode, lat, lon, country, portType }
 */

interface Dock {
  id: string;
  name: string;
  portCode: string;
  lat: number;
  lon: number;
  country: string;
  portType: string;
}

export function DocksLayer() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const docks = useLayerData<Dock>('docks');
  const setLayerEntities = useRadarStore((s) => s.setLayerEntities);

  useEffect(() => {
    setLayerEntities('docks', docks);
  }, [docks, setLayerEntities]);

  useFrame(() => {
    if (!meshRef.current || docks.length === 0) return;

    const dummy = new THREE.Object3D();
    meshRef.current.count = docks.length;

    for (let i = 0; i < docks.length; i++) {
      const dock = docks[i];
      const phi = (90 - dock.lat) * (Math.PI / 180);
      const theta = (dock.lon + 180) * (Math.PI / 180);
      const r = GLOBE.DOCK_SURFACE_OFFSET;

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
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, 1000]}
      frustumCulled={false}
    >
      <boxGeometry args={[0.003, 0.003, 0.001]} />
      <meshBasicMaterial color="#88ccff" transparent opacity={0.7} />
    </instancedMesh>
  );
}
