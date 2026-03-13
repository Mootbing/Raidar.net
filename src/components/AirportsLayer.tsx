'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useRadarStore, Airport } from '@/store/gameStore';
import { GLOBE, AIRPORTS, COLORS } from '@/config/constants';
import { calculateViewVisibility } from '@/utils/lod';
import { latLonToVector3 } from '@/utils/geo';
import { createRenderLoopAllocations } from '@/utils/sharedGeometry';

// ============================================================================
// AIRPORTS LAYER
// Uses instanced mesh for efficient rendering
// Fixed: Pre-allocated objects for render loop, no GC pressure
// ============================================================================

// Swoop ease: starts small, grows BIG, settles to 1.0
// t = 0: minScale (barely visible)
// t = 0.4: peak overshoot (BIG)
// t = 1: settles to 1.0
function swoopEase(t: number): number {
  if (t <= 0) return AIRPORTS.RIPPLE_MIN_SCALE;
  if (t >= 1) return 1;
  
  // Use a curve that peaks around t=0.4 then settles
  const peakT = 0.4;
  const overshoot = AIRPORTS.RIPPLE_OVERSHOOT;
  const minScale = AIRPORTS.RIPPLE_MIN_SCALE;
  
  if (t < peakT) {
    // Rising phase: minScale → overshoot
    const riseProgress = t / peakT;
    const eased = 1 - Math.pow(1 - riseProgress, 2); // ease out
    return minScale + (overshoot - minScale) * eased;
  } else {
    // Settling phase: overshoot → 1.0
    const settleProgress = (t - peakT) / (1 - peakT);
    const eased = 1 - Math.pow(1 - settleProgress, 3); // ease out cubic
    return overshoot - (overshoot - 1) * eased;
  }
}

// Opacity ease: starts low, peaks at 100%, settles to target
function opacityEase(t: number, targetOpacity: number): number {
  if (t <= 0) return AIRPORTS.RIPPLE_MIN_OPACITY;
  if (t >= 1) return targetOpacity;
  
  const peakT = 0.4;
  const minOpacity = AIRPORTS.RIPPLE_MIN_OPACITY;
  
  if (t < peakT) {
    // Rising phase: minOpacity → 1.0
    const riseProgress = t / peakT;
    const eased = 1 - Math.pow(1 - riseProgress, 2);
    return minOpacity + (1 - minOpacity) * eased;
  } else {
    // Settling phase: 1.0 → targetOpacity
    const settleProgress = (t - peakT) / (1 - peakT);
    const eased = 1 - Math.pow(1 - settleProgress, 3);
    return 1 - (1 - targetOpacity) * eased;
  }
}

// Military airport detection by name keywords
const MILITARY_KEYWORDS = ['air force', 'afb', 'naval air', 'military', 'army airfield', 'raf ', 'air base', 'jsdf', 'fuerza aérea'];
function isAirportMilitary(name: string): boolean {
  const lower = name.toLowerCase();
  return MILITARY_KEYWORDS.some(kw => lower.includes(kw));
}
// Instanced mesh for large airports
function LargeAirportsInstanced({ airports }: { airports: Airport[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { camera } = useThree();
  const hoverEntity = useRadarStore((state) => state.hoverEntity);
  const selectEntity = useRadarStore((state) => state.selectEntity);
  const hoveredEntity = useRadarStore((state) => state.gameState.hoveredEntity);
  const hoveredAirport = hoveredEntity?.type === 'airport' ? hoveredEntity.id : null;
  const introPhase = useRadarStore((state) => state.introPhase);
  
  // Pre-allocated objects for render loop - CRITICAL: never recreate these
  const allocs = useRef(createRenderLoopAllocations());
  const animationTime = useRef(0);
  const animationStarted = useRef(false);
  const instanceOpacities = useRef<number[]>([]);
  
  // Pre-computed positions (only update when airports change)
  const positions = useMemo(() => {
    return airports.map(airport => latLonToVector3(airport.lat, airport.lon, 0, GLOBE.AIRPORT_SURFACE_OFFSET));
  }, [airports]);
  
  const militaryFlags = useMemo(() => airports.map(a => isAirportMilitary(a.name)), [airports]);

  // Pre-computed stagger delays - sorted by distance from top-left for nth-child sprawl effect
  const staggerDelays = useMemo(() => {
    // Calculate distance from "top-left" for each airport
    // Top-left = high latitude (north), low longitude (west)
    // We normalize and combine to get a diagonal distance
    const distances = airports.map((airport, idx) => {
      // Invert lat so higher lat = lower value (closer to top)
      // Keep lon as is so lower lon = lower value (closer to left)
      const normalizedLat = (90 - airport.lat) / 180; // 0 = north pole, 1 = south pole
      const normalizedLon = (airport.lon + 180) / 360; // 0 = -180, 1 = 180
      // Combined diagonal distance from top-left (0,0)
      const distance = Math.sqrt(normalizedLat * normalizedLat + normalizedLon * normalizedLon);
      return { idx, distance };
    });
    
    // Sort by distance to get order
    distances.sort((a, b) => a.distance - b.distance);
    
    // Create delay array based on sorted order (nth-child style)
    const delays = new Array(airports.length);
    const delayPerItem = AIRPORTS.FADE_IN_STAGGER_DURATION / Math.max(1, airports.length);
    distances.forEach((item, sortedIdx) => {
      delays[item.idx] = sortedIdx * delayPerItem;
    });
    
    return delays;
  }, [airports]);
  
  const indexToIcao = useMemo(() => airports.map(a => a.icao), [airports]);
  
  // Initialize opacity array
  useEffect(() => {
    instanceOpacities.current = new Array(airports.length).fill(0);
  }, [airports.length]);
  
  // Update instance matrices - uses pre-allocated objects
  useFrame((_, delta) => {
    if (!meshRef.current || positions.length === 0) return;
    
    const { dummy, vec3_a } = allocs.current;
    
    // Start animation when airports phase begins
    // If intro already complete (layer toggled back on), skip sweep
    if (introPhase === 'airports' || introPhase === 'docks' || introPhase === 'maritime' || introPhase === 'aircraft' || introPhase === 'satellites' || introPhase === 'complete') {
      if (!animationStarted.current) {
        animationStarted.current = true;
        animationTime.current = introPhase === 'complete'
          ? AIRPORTS.FADE_IN_STAGGER_DURATION * 0.5
          : 0;
      }
    }

    if (animationStarted.current) {
      animationTime.current += delta;
    }

    // Pre-compute up vector once (reused for all instances)
    vec3_a.set(0, 0, 1);

    let maxProgress = 0;
    
    if (instanceOpacities.current.length !== positions.length) {
      instanceOpacities.current = new Array(positions.length).fill(0);
    }
    
    const smoothFactor = Math.min(delta * AIRPORTS.OPACITY_SMOOTH_FACTOR, 0.25);
    
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      dummy.position.copy(pos);
      
      // Get normal for orientation (position normalized = surface normal)
      const normal = dummy.position.clone().normalize();
      dummy.quaternion.setFromUnitVectors(vec3_a, normal);
      
      // Calculate animation progress
      const delay = staggerDelays[i];
      const individualTime = Math.max(0, animationTime.current - delay);
      const individualProgress = Math.min(1, individualTime / AIRPORTS.RIPPLE_DURATION);
      maxProgress = Math.max(maxProgress, individualProgress);
      
      // Swoop animation: small → BIG → normal
      const swoopScale = animationStarted.current ? swoopEase(individualProgress) : 0;
      
      // View visibility
      const targetVisibility = calculateViewVisibility(pos, camera);
      instanceOpacities.current[i] += (targetVisibility - instanceOpacities.current[i]) * smoothFactor;
      const smoothVisibility = instanceOpacities.current[i];
      
      dummy.scale.setScalar(swoopScale * smoothVisibility);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;

    // Opacity animation: low → 100% → target
    const material = meshRef.current.material as THREE.MeshBasicMaterial;
    material.opacity = opacityEase(maxProgress, AIRPORTS.LARGE_AIRPORT_MAX_OPACITY);
  });
  
  // Update colors based on hover
  useEffect(() => {
    if (!meshRef.current) return;
    
    const color = new THREE.Color();
    const hoveredIdx = hoveredAirport ? indexToIcao.indexOf(hoveredAirport) : -1;
    
    for (let i = 0; i < airports.length; i++) {
      if (i === hoveredIdx) {
        color.set(COLORS.AIRPORT_HOVERED);
      } else if (militaryFlags[i]) {
        color.set(COLORS.MILITARY);
      } else {
        color.set(COLORS.AIRPORT_DEFAULT);
      }
      meshRef.current.setColorAt(i, color);
    }
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  }, [hoveredAirport, airports.length, indexToIcao, militaryFlags]);

  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined && indexToIcao[e.instanceId]) {
      hoverEntity({ type: 'airport', id: indexToIcao[e.instanceId] });
    }
  };

  const handlePointerOut = () => hoverEntity(null);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined && indexToIcao[e.instanceId]) {
      selectEntity({ type: 'airport', id: indexToIcao[e.instanceId] });
    }
  };

  if (airports.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, airports.length]}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      onClick={handleClick}
    >
      <planeGeometry args={[AIRPORTS.LARGE_AIRPORT_SIZE, AIRPORTS.LARGE_AIRPORT_SIZE]} />
      <meshBasicMaterial color={COLORS.HITBOX} transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
    </instancedMesh>
  );
}

// Instanced mesh for small/medium airports
function SmallAirportsInstanced({ airports }: { airports: Airport[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const borderMeshRef = useRef<THREE.InstancedMesh>(null);
  const { camera } = useThree();
  const hoverEntity = useRadarStore((state) => state.hoverEntity);
  const selectEntity = useRadarStore((state) => state.selectEntity);
  const hoveredEntity = useRadarStore((state) => state.gameState.hoveredEntity);
  const hoveredAirport = hoveredEntity?.type === 'airport' ? hoveredEntity.id : null;
  const introPhase = useRadarStore((state) => state.introPhase);

  // Pre-allocated objects - CRITICAL
  const allocs = useRef(createRenderLoopAllocations());
  const animationTime = useRef(0);
  const animationStarted = useRef(false);
  const instanceOpacities = useRef<number[]>([]);
  
  const positions = useMemo(() => {
    return airports.map(airport => latLonToVector3(airport.lat, airport.lon, 0, GLOBE.AIRPORT_SURFACE_OFFSET));
  }, [airports]);
  
  const militaryFlags = useMemo(() => airports.map(a => isAirportMilitary(a.name)), [airports]);

  // Pre-computed stagger delays - sorted by distance from top-left for nth-child sprawl effect
  const staggerDelays = useMemo(() => {
    const distances = airports.map((airport, idx) => {
      const normalizedLat = (90 - airport.lat) / 180;
      const normalizedLon = (airport.lon + 180) / 360;
      const distance = Math.sqrt(normalizedLat * normalizedLat + normalizedLon * normalizedLon);
      return { idx, distance };
    });

    distances.sort((a, b) => a.distance - b.distance);

    const delays = new Array(airports.length);
    const delayPerItem = AIRPORTS.FADE_IN_STAGGER_DURATION / Math.max(1, airports.length);
    distances.forEach((item, sortedIdx) => {
      delays[item.idx] = sortedIdx * delayPerItem;
    });

    return delays;
  }, [airports]);

  const indexToIcao = useMemo(() => airports.map(a => a.icao), [airports]);

  useEffect(() => {
    instanceOpacities.current = new Array(airports.length).fill(0);
  }, [airports.length]);

  // Update colors based on hover state
  useEffect(() => {
    if (!meshRef.current) return;
    
    const color = new THREE.Color();
    const hoveredIdx = hoveredAirport ? indexToIcao.indexOf(hoveredAirport) : -1;
    
    for (let i = 0; i < airports.length; i++) {
      if (i === hoveredIdx) {
        color.set(COLORS.AIRPORT_HOVERED);
      } else if (militaryFlags[i]) {
        color.set(COLORS.MILITARY);
      } else {
        color.set(COLORS.AIRPORT_DEFAULT);
      }
      meshRef.current.setColorAt(i, color);
    }
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  }, [hoveredAirport, airports.length, indexToIcao, militaryFlags]);

  useFrame((_, delta) => {
    if (!meshRef.current || positions.length === 0) return;
    
    const { dummy, vec3_a } = allocs.current;
    
    // If intro already complete (layer toggled back on), skip sweep
    if (introPhase === 'airports' || introPhase === 'docks' || introPhase === 'maritime' || introPhase === 'aircraft' || introPhase === 'satellites' || introPhase === 'complete') {
      if (!animationStarted.current) {
        animationStarted.current = true;
        animationTime.current = introPhase === 'complete'
          ? AIRPORTS.FADE_IN_STAGGER_DURATION * 0.5
          : 0;
      }
    }

    if (animationStarted.current) {
      animationTime.current += delta;
    }

    const baseOpacity = 1;
    
    vec3_a.set(0, 0, 1);
    let maxProgress = 0;
    
    if (instanceOpacities.current.length !== positions.length) {
      instanceOpacities.current = new Array(positions.length).fill(0);
    }
    
    const smoothFactor = Math.min(delta * AIRPORTS.OPACITY_SMOOTH_FACTOR, 0.25);
    
    const hoveredIdx = hoveredAirport ? indexToIcao.indexOf(hoveredAirport) : -1;
    
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      dummy.position.copy(pos);
      
      const normal = dummy.position.clone().normalize();
      dummy.quaternion.setFromUnitVectors(vec3_a, normal);
      
      const delay = staggerDelays[i];
      const individualTime = Math.max(0, animationTime.current - delay);
      const individualProgress = Math.min(1, individualTime / AIRPORTS.RIPPLE_DURATION);
      maxProgress = Math.max(maxProgress, individualProgress);
      
      // Swoop animation: small → BIG → normal
      const swoopScale = animationStarted.current ? swoopEase(individualProgress) : 0;
      const targetVisibility = calculateViewVisibility(pos, camera);
      
      const isHovered = i === hoveredIdx;
      
      // Hovered airport gets full visibility, others use smooth transition
      if (isHovered) {
        instanceOpacities.current[i] = 1;
      } else {
        instanceOpacities.current[i] += (targetVisibility - instanceOpacities.current[i]) * smoothFactor;
      }
      const smoothVisibility = instanceOpacities.current[i];
      
      // Boost scale for hovered airport to stand out more
      const hoverBoost = isHovered ? 1.8 : 1;
      
      dummy.scale.setScalar(swoopScale * smoothVisibility * hoverBoost);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;

    // Opacity animation: low → 100% → target (factored by baseOpacity for distance fade)
    const material = meshRef.current.material as THREE.MeshBasicMaterial;
    const targetOpacity = baseOpacity * AIRPORTS.SMALL_AIRPORT_MAX_OPACITY;
    material.opacity = opacityEase(maxProgress, targetOpacity);
    meshRef.current.visible = maxProgress > 0.01;
  });
  
  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined && indexToIcao[e.instanceId]) {
      hoverEntity({ type: 'airport', id: indexToIcao[e.instanceId] });
    }
  };
  
  const handlePointerOut = () => hoverEntity(null);
  
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined && indexToIcao[e.instanceId]) {
      selectEntity({ type: 'airport', id: indexToIcao[e.instanceId] });
    }
  };
  
  if (airports.length === 0) return null;
  
  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, airports.length]}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      onClick={handleClick}
    >
      <planeGeometry args={[AIRPORTS.SMALL_AIRPORT_SIZE, AIRPORTS.SMALL_AIRPORT_SIZE]} />
      <meshBasicMaterial color={COLORS.HITBOX} transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
    </instancedMesh>
  );
}

export function AirportsLayer() {
  const airports = useRadarStore((state) => state.airports);
  const fetchAirports = useRadarStore((state) => state.fetchAirports);
  const locationReady = useRadarStore((state) => state.locationReady);
  const setLayerState = useRadarStore((state) => state.setLayerState);

  useEffect(() => {
    if (locationReady) {
      fetchAirports();
    }
  }, [locationReady, fetchAirports]);

  useEffect(() => {
    setLayerState('airports', { entityCount: airports.length });
  }, [airports.length, setLayerState]);
  
  const { largeAirports, smallAirports } = useMemo(() => {
    const large: Airport[] = [];
    const small: Airport[] = [];
    
    airports.forEach(airport => {
      if (airport.type === 'large_airport') {
        large.push(airport);
      } else {
        small.push(airport);
      }
    });
    
    return { largeAirports: large, smallAirports: small };
  }, [airports]);
  
  return (
    <group>
      <LargeAirportsInstanced airports={largeAirports} />
      <SmallAirportsInstanced airports={smallAirports} />
    </group>
  );
}
