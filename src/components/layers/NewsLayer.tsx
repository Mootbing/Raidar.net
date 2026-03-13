'use client';

import { useRef, useEffect, useMemo, useCallback } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useLayerData } from '@/hooks/useLayerData';
import { useRadarStore } from '@/store/gameStore';
import { GLOBE, COLORS, DOCKS } from '@/config/constants';

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

// Swoop ease: starts small, grows BIG, settles to 1.0 (same as AirportsLayer)
function swoopEase(t: number): number {
  if (t <= 0) return DOCKS.RIPPLE_MIN_SCALE;
  if (t >= 1) return 1;

  const peakT = 0.4;
  const overshoot = DOCKS.RIPPLE_OVERSHOOT;
  const minScale = DOCKS.RIPPLE_MIN_SCALE;

  if (t < peakT) {
    const riseProgress = t / peakT;
    const eased = 1 - Math.pow(1 - riseProgress, 2);
    return minScale + (overshoot - minScale) * eased;
  } else {
    const settleProgress = (t - peakT) / (1 - peakT);
    const eased = 1 - Math.pow(1 - settleProgress, 3);
    return overshoot - (overshoot - 1) * eased;
  }
}

// Opacity ease: starts low, peaks at 100%, settles to target
function opacityEase(t: number, targetOpacity: number): number {
  if (t <= 0) return DOCKS.RIPPLE_MIN_OPACITY;
  if (t >= 1) return targetOpacity;

  const peakT = 0.4;
  const minOpacity = DOCKS.RIPPLE_MIN_OPACITY;

  if (t < peakT) {
    const riseProgress = t / peakT;
    const eased = 1 - Math.pow(1 - riseProgress, 2);
    return minOpacity + (1 - minOpacity) * eased;
  } else {
    const settleProgress = (t - peakT) / (1 - peakT);
    const eased = 1 - Math.pow(1 - settleProgress, 3);
    return 1 - (1 - targetOpacity) * eased;
  }
}

export function NewsLayer() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const events = useLayerData<NewsEvent>('news');
  const setLayerEntities = useRadarStore((s) => s.setLayerEntities);
  const hoverEntity = useRadarStore((s) => s.hoverEntity);
  const selectEntity = useRadarStore((s) => s.selectEntity);
  const introPhase = useRadarStore((s) => s.introPhase);

  // Sweep animation state
  const animationTime = useRef(0);
  const animationStarted = useRef(false);

  // Map instance index -> event id
  const indexToId = useRef<string[]>([]);

  useEffect(() => {
    setLayerEntities('news', events);
    indexToId.current = events.map((e) => e.id);
  }, [events, setLayerEntities]);

  // Pre-computed stagger delays - diagonal sweep from top-left (same as airports/docks)
  const staggerDelays = useMemo(() => {
    const distances = events.map((ev, idx) => {
      const normalizedLat = (90 - ev.lat) / 180;
      const normalizedLon = (ev.lon + 180) / 360;
      const distance = Math.sqrt(normalizedLat * normalizedLat + normalizedLon * normalizedLon);
      return { idx, distance };
    });
    distances.sort((a, b) => a.distance - b.distance);
    const delays = new Array(events.length);
    const delayPerItem = DOCKS.FADE_IN_STAGGER_DURATION / Math.max(1, events.length);
    distances.forEach((item, sortedIdx) => {
      delays[item.idx] = sortedIdx * delayPerItem;
    });
    return delays;
  }, [events]);

  // Pointer interaction via raycasting
  const handlePointerOver = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (e.instanceId !== undefined && indexToId.current[e.instanceId]) {
        hoverEntity({ type: 'news_event', id: indexToId.current[e.instanceId] });
      }
    },
    [hoverEntity]
  );

  const handlePointerOut = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    hoverEntity(null);
  }, [hoverEntity]);

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (e.instanceId !== undefined && indexToId.current[e.instanceId]) {
        selectEntity({ type: 'news_event', id: indexToId.current[e.instanceId] });
      }
    },
    [selectEntity]
  );

  useFrame(({ clock }, delta) => {
    if (!meshRef.current || events.length === 0) return;

    // Start animation (news has no dedicated intro phase, so start on any post-loading phase)
    if (introPhase !== 'loading' && introPhase !== 'borders') {
      if (!animationStarted.current) {
        animationStarted.current = true;
        animationTime.current = introPhase === 'complete'
          ? DOCKS.FADE_IN_STAGGER_DURATION * 0.5
          : 0;
      }
    }
    if (animationStarted.current) {
      animationTime.current += delta;
    }

    const t = clock.getElapsedTime();
    const dummy = new THREE.Object3D();
    meshRef.current.count = events.length;

    let maxProgress = 0;

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

      // Sweep animation progress (same as airports/docks)
      const delay = staggerDelays[i] ?? 0;
      const individualTime = Math.max(0, animationTime.current - delay);
      const individualProgress = animationStarted.current ? Math.min(1, individualTime / DOCKS.RIPPLE_DURATION) : 0;
      maxProgress = Math.max(maxProgress, individualProgress);
      const swoopScale = animationStarted.current ? swoopEase(individualProgress) : 0;

      // Pulse scale based on severity (applied after swoop)
      const pulseSpeed = SEVERITY_PULSE_SPEED[ev.severity] ?? 1;
      const pulse = 0.8 + 0.4 * Math.sin(t * pulseSpeed * 3 + i * 0.7);
      dummy.scale.setScalar(swoopScale * pulse);
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

    // Global opacity animation (same as airports/docks)
    const material = meshRef.current.material as THREE.MeshBasicMaterial;
    material.opacity = opacityEase(maxProgress, 0.8);
    meshRef.current.visible = maxProgress > 0.01;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, 500]}
      frustumCulled={false}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      onClick={handleClick}
    >
      <circleGeometry args={[0.005, 8]} />
      <meshBasicMaterial
        color={COLORS.HITBOX}
        transparent
        opacity={0}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
}
