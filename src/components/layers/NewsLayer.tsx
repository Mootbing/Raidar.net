'use client';

import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useLayerData } from '@/hooks/useLayerData';
import { useEntityInteraction } from '@/hooks/useEntityInteraction';
import { useRadarStore } from '@/store/gameStore';
import { GLOBE, COLORS } from '@/config/constants';

interface NewsEvent {
  id: string;
  headline: string;
  source: string;
  lat: number;
  lon: number;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  publishedAt: number;
  url?: string;
}

const SEVERITY_COLORS: Record<string, THREE.Color> = {
  low: new THREE.Color(COLORS.NEWS_LOW),
  medium: new THREE.Color(COLORS.NEWS_MEDIUM),
  high: new THREE.Color(COLORS.NEWS_HIGH),
  critical: new THREE.Color(COLORS.NEWS_CRITICAL),
};

// Pulse speed multiplier by severity
const SEVERITY_PULSE_SPEED: Record<string, number> = {
  low: 1,
  medium: 1.5,
  high: 2.5,
  critical: 4,
};

export function NewsLayer() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const events = useLayerData<NewsEvent>('news');
  const setLayerEntities = useRadarStore((s) => s.setLayerEntities);
  const { indexToIdRef, handlers } = useEntityInteraction('news_event');

  useEffect(() => {
    setLayerEntities('news', events);
    indexToIdRef.current = events.map((e) => e.id);
  }, [events, setLayerEntities, indexToIdRef]);

  useFrame(({ clock }) => {
    if (!meshRef.current || events.length === 0) return;

    const t = clock.getElapsedTime();
    const dummy = new THREE.Object3D();
    meshRef.current.count = events.length;

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const phi = (90 - ev.lat) * (Math.PI / 180);
      const theta = (ev.lon + 180) * (Math.PI / 180);
      const r = GLOBE.NEWS_SURFACE_OFFSET;

      dummy.position.set(
        -r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
      );
      dummy.lookAt(0, 0, 0);

      // Pulse scale based on severity
      const pulseSpeed = SEVERITY_PULSE_SPEED[ev.severity] ?? 1;
      const pulse = 0.8 + 0.4 * Math.sin(t * pulseSpeed * 3 + i * 0.7);
      dummy.scale.setScalar(pulse);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);

      // Per-instance color by severity
      const color = SEVERITY_COLORS[ev.severity] ?? SEVERITY_COLORS.low;
      meshRef.current.setColorAt(i, color);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, 500]}
      frustumCulled={false}
      {...handlers}
    >
      <circleGeometry args={[0.005, 8]} />
      <meshBasicMaterial
        color={COLORS.HITBOX}
        transparent
        opacity={0.8}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
}
