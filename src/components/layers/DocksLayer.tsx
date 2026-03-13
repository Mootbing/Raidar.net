'use client';

import { useRef, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useLayerData } from '@/hooks/useLayerData';
import { useEntityInteraction } from '@/hooks/useEntityInteraction';
import { useRadarStore } from '@/store/gameStore';
import { GLOBE, DOCKS, COLORS } from '@/config/constants';
import { calculateViewVisibility } from '@/utils/lod';
import { latLonToVector3 } from '@/utils/geo';
import { createRenderLoopAllocations } from '@/utils/sharedGeometry';

/**
 * Shipping Docks / Ports Layer
 *
 * Static markers for major ports. Fetched once globally (no polling).
 * Only ports within the current viewport are rendered (via useLayerData cache).
 *
 * Features:
 * - Color coded by port type (container=cyan, bulk=gray, naval=red, oil=orange, mixed=white)
 * - Diagonal sweep spawn animation (matching airports pattern)
 * - LOD: camera-distance-based visibility
 * - Hover/click for entity selection
 */

interface Dock {
  id: string;
  name: string;
  portCode: string;
  lat: number;
  lon: number;
  country: string;
  portType: 'container' | 'bulk' | 'naval' | 'mixed' | 'oil_terminal';
  capacity?: number;
  isActive?: boolean;
}

const PORT_TYPE_COLORS: Record<string, string> = {
  container: DOCKS.COLOR_CONTAINER,
  bulk: DOCKS.COLOR_BULK,
  naval: DOCKS.COLOR_NAVAL,
  oil_terminal: DOCKS.COLOR_OIL_TERMINAL,
  mixed: DOCKS.COLOR_MIXED,
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

export function DocksLayer() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { camera } = useThree();
  const docks = useLayerData<Dock>('docks');
  const setLayerEntities = useRadarStore((s) => s.setLayerEntities);
  const hoveredEntity = useRadarStore((s) => s.gameState.hoveredEntity);
  const hoveredDock = hoveredEntity?.type === 'dock' ? hoveredEntity.id : null;
  const introPhase = useRadarStore((s) => s.introPhase);
  const { indexToIdRef, handlers } = useEntityInteraction('dock');

  // Pre-allocated objects for render loop
  const allocs = useRef(createRenderLoopAllocations());
  const animationTime = useRef(0);
  const animationStarted = useRef(false);
  const instanceOpacities = useRef<number[]>([]);

  // Sync entities to store
  useEffect(() => {
    setLayerEntities('docks', docks);
  }, [docks, setLayerEntities]);

  // Pre-computed positions
  const positions = useMemo(() => {
    return docks.map(dock => latLonToVector3(dock.lat, dock.lon, 0, GLOBE.DOCK_SURFACE_OFFSET));
  }, [docks]);

  // Pre-computed stagger delays - diagonal sweep from top-left
  const staggerDelays = useMemo(() => {
    const distances = docks.map((dock, idx) => {
      const normalizedLat = (90 - dock.lat) / 180;
      const normalizedLon = (dock.lon + 180) / 360;
      const distance = Math.sqrt(normalizedLat * normalizedLat + normalizedLon * normalizedLon);
      return { idx, distance };
    });

    distances.sort((a, b) => a.distance - b.distance);

    const delays = new Array(docks.length);
    const delayPerItem = DOCKS.FADE_IN_STAGGER_DURATION / Math.max(1, docks.length);
    distances.forEach((item, sortedIdx) => {
      delays[item.idx] = sortedIdx * delayPerItem;
    });

    return delays;
  }, [docks]);

  // Sync index mapping for hover/click
  const indexToId = useMemo(() => {
    const ids = docks.map(d => d.id);
    indexToIdRef.current = ids;
    return ids;
  }, [docks, indexToIdRef]);

  // Initialize opacity array
  useEffect(() => {
    instanceOpacities.current = new Array(docks.length).fill(0);
  }, [docks.length]);

  // Update colors: military docks are red, others by port type
  useEffect(() => {
    if (!meshRef.current) return;

    const color = new THREE.Color();
    const hoveredIdx = hoveredDock ? indexToId.indexOf(hoveredDock) : -1;

    for (let i = 0; i < docks.length; i++) {
      if (i === hoveredIdx) {
        color.set(DOCKS.COLOR_HOVERED);
      } else if (docks[i].portType === 'naval') {
        color.set(COLORS.MILITARY);
      } else {
        const portColor = PORT_TYPE_COLORS[docks[i].portType] || DOCKS.COLOR_MIXED;
        color.set(portColor);
      }
      meshRef.current.setColorAt(i, color);
    }
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  }, [hoveredDock, docks, indexToId]);

  // Render loop: animation, LOD, positioning for both meshes
  useFrame((_, delta) => {
    if (!meshRef.current || positions.length === 0) return;

    const { dummy, vec3_a } = allocs.current;

    // Start animation when docks phase begins
    // If intro already complete (layer toggled back on), skip sweep
    if (introPhase === 'docks' || introPhase === 'maritime' || introPhase === 'aircraft' || introPhase === 'satellites' || introPhase === 'complete') {
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

    vec3_a.set(0, 0, 1);
    let maxProgress = 0;

    if (instanceOpacities.current.length !== positions.length) {
      instanceOpacities.current = new Array(positions.length).fill(0);
    }

    const smoothFactor = Math.min(delta * DOCKS.OPACITY_SMOOTH_FACTOR, 0.25);
    const hoveredIdx = hoveredDock ? indexToId.indexOf(hoveredDock) : -1;

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      dummy.position.copy(pos);

      // Orient to surface normal
      const normal = dummy.position.clone().normalize();
      dummy.quaternion.setFromUnitVectors(vec3_a, normal);

      // Animation progress with stagger
      const delay = staggerDelays[i];
      const individualTime = Math.max(0, animationTime.current - delay);
      const individualProgress = Math.min(1, individualTime / DOCKS.RIPPLE_DURATION);
      maxProgress = Math.max(maxProgress, individualProgress);

      // Swoop animation
      const swoopScale = animationStarted.current ? swoopEase(individualProgress) : 0;

      // View visibility (LOD)
      const targetVisibility = calculateViewVisibility(pos, camera);
      const isHovered = i === hoveredIdx;

      if (isHovered) {
        instanceOpacities.current[i] = 1;
      } else {
        instanceOpacities.current[i] += (targetVisibility - instanceOpacities.current[i]) * smoothFactor;
      }
      const smoothVisibility = instanceOpacities.current[i];

      // Hover boost
      const hoverBoost = isHovered ? 1.8 : 1;
      const baseScale = swoopScale * smoothVisibility * hoverBoost;

      dummy.scale.setScalar(baseScale);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;

    // Global opacity animation
    const material = meshRef.current.material as THREE.MeshBasicMaterial;
    material.opacity = opacityEase(maxProgress, DOCKS.MAX_OPACITY);
    meshRef.current.visible = maxProgress > 0.01;
  });

  if (docks.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, docks.length]}
      {...handlers}
    >
      <circleGeometry args={[DOCKS.MARKER_SIZE, 3]} />
      <meshBasicMaterial
        color={COLORS.HITBOX}
        transparent
        opacity={0}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </instancedMesh>
  );
}
