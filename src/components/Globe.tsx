'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const EARTH_RADIUS = 1;

export function Globe() {
  const globeRef = useRef<THREE.Mesh>(null);
  
  useFrame(() => {
    if (globeRef.current) globeRef.current.rotation.y += 0.0002;
  });
  
  return (
    <mesh ref={globeRef} raycast={() => null}>
      <sphereGeometry args={[EARTH_RADIUS, 64, 64]} />
      <meshBasicMaterial color="#000000" />
    </mesh>
  );
}
