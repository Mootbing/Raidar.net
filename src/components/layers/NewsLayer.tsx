'use client';

import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useLayerData } from '@/hooks/useLayerData';
import { useRadarStore } from '@/store/gameStore';
import { GLOBE } from '@/config/constants';

/**
 * Real-Time News Layer
 *
 * Pulsing markers at geolocated news event positions.
 * Entities appear as you pan to the relevant region.
 *
 * To activate: implement /api/news to return { events: [...] }
 * Each event needs: { id, headline, source, lat, lon, category, severity, publishedAt }
 */

interface NewsEvent {
  id: string;
  headline: string;
  source: string;
  lat: number;
  lon: number;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  publishedAt: number;
}

const SEVERITY_COLORS: Record<string, THREE.Color> = {
  low: new THREE.Color('#00ff88'),
  medium: new THREE.Color('#ffcc00'),
  high: new THREE.Color('#ff8800'),
  critical: new THREE.Color('#ff2222'),
};

export function NewsLayer() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const events = useLayerData<NewsEvent>('news');
  const setLayerEntities = useRadarStore((s) => s.setLayerEntities);

  useEffect(() => {
    setLayerEntities('news', events);
  }, [events, setLayerEntities]);

  useFrame(({ clock }) => {
    if (!meshRef.current || events.length === 0) return;

    const dummy = new THREE.Object3D();
    meshRef.current.count = events.length;
    const t = clock.elapsedTime;

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
      // Pulse scale by severity
      const pulseRate = ev.severity === 'critical' ? 4 : ev.severity === 'high' ? 2.5 : 1.5;
      const pulse = 1 + 0.3 * Math.sin(t * pulseRate + i);
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
    >
      <circleGeometry args={[0.005, 8]} />
      <meshBasicMaterial
        color="#ffffff"
        transparent
        opacity={0.8}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
}
