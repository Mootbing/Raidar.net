'use client';

import { useRef, useEffect, useMemo, useCallback } from 'react';
import { useThree, useFrame, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useRadarStore } from '@/store/gameStore';
import { FlightPath } from './FlightPath';
import { AIRCRAFT, COLORS } from '@/config/constants';
import { 
  getAircraftTriangleGeometry, 
  getAircraftPlaneGeometry,
  getAircraftHitboxGeometry,
  createRenderLoopAllocations 
} from '@/utils/sharedGeometry';
import { latLonToVector3Into, getOrientationAtLatLonInto, predictPosition } from '@/utils/geo';
import { calculateViewVisibility } from '@/utils/lod';

const MAX_AIRCRAFT_INSTANCES = 5000;

// ============================================================================
// INSTANCED AIRCRAFT LAYER
// Single InstancedMesh for all aircraft - massive performance improvement
// ============================================================================

// Per-aircraft state for animations and predictions
interface AircraftState {
  // Animation
  fadeInStartTime: number;
  currentOpacity: number;
  smoothVisibility: number;
  
  // Dead reckoning
  lastServerLat: number;
  lastServerLon: number;
  lastServerAlt: number;
  lastServerHeading: number;
  lastServerSpeed: number;
  lastServerTime: number;
  
  // Current interpolated state
  currentQuat: THREE.Quaternion;
}

export function AircraftLayerInstanced() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const hitboxRef = useRef<THREE.InstancedMesh>(null);
  const { camera } = useThree();
  
  // Store selectors
  const aircraft = useRadarStore((state) => state.aircraft);
  const selectEntity = useRadarStore((state) => state.selectEntity);
  const removeAircraft = useRadarStore((state) => state.removeAircraft);
  const hoverEntity = useRadarStore((state) => state.hoverEntity);
  const hoveredEntity = useRadarStore((state) => state.gameState.hoveredEntity);
  const selectedEntity = useRadarStore((state) => state.gameState.selectedEntity);
  const introPhase = useRadarStore((state) => state.introPhase);
  
  // Extract IDs
  const hoveredAircraftId = hoveredEntity?.type === 'aircraft' ? hoveredEntity.id : null;
  const selectedAircraftId = selectedEntity?.type === 'aircraft' ? selectedEntity.id : null;
  const displayPathFor = hoveredAircraftId || selectedAircraftId;
  
  // Pre-allocated objects for render loop (never recreate these)
  const allocs = useRef(createRenderLoopAllocations());
  
  // Per-aircraft state tracking
  const aircraftStates = useRef<Map<string, AircraftState>>(new Map());
  
  // ID to instance index mapping
  const idToIndex = useRef<Map<string, number>>(new Map());
  const indexToId = useRef<string[]>([]);
  
  // Visibility tracking for deloading
  const outOfViewSince = useRef<Map<string, number>>(new Map());
  
  // Animation tracking
  const animationStartTime = useRef<number | null>(null);
  
  // Determine if we should use simple LOD geometry
  const useSimpleGeometry = aircraft.length > AIRCRAFT.LOD_THRESHOLD;
  
  // Get the appropriate shared geometry
  const geometry = useMemo(() => {
    return useSimpleGeometry ? getAircraftTriangleGeometry() : getAircraftPlaneGeometry();
  }, [useSimpleGeometry]);
  
  // Hitbox geometry for easier pointer detection (larger invisible shape)
  const hitboxGeometry = useMemo(() => getAircraftHitboxGeometry(), []);
  
  // Update aircraft state when data changes
  useEffect(() => {
    const now = Date.now();
    
    // Build new mappings
    const newIdToIndex = new Map<string, number>();
    const newIndexToId: string[] = [];
    
    aircraft.forEach((ac, index) => {
      newIdToIndex.set(ac.id, index);
      newIndexToId.push(ac.id);
      
      // Get or create state
      let state = aircraftStates.current.get(ac.id);
      if (!state) {
        // New aircraft - initialize state with correct heading immediately
        const initialQuat = new THREE.Quaternion();
        // Compute the correct orientation right away so there's no north-facing lerp
        const tempAllocs = allocs.current;
        getOrientationAtLatLonInto(
          ac.position.latitude,
          ac.position.longitude,
          ac.position.heading,
          initialQuat,
          tempAllocs
        );
        
        state = {
          fadeInStartTime: -1,
          currentOpacity: 0,
          smoothVisibility: 0,
          lastServerLat: ac.position.latitude,
          lastServerLon: ac.position.longitude,
          lastServerAlt: ac.position.altitude,
          lastServerHeading: ac.position.heading,
          lastServerSpeed: ac.position.speed,
          lastServerTime: now,
          currentQuat: initialQuat,
        };
        aircraftStates.current.set(ac.id, state);
      } else {
        // Existing aircraft - update server data if position changed
        if (state.lastServerLat !== ac.position.latitude || 
            state.lastServerLon !== ac.position.longitude) {
          state.lastServerLat = ac.position.latitude;
          state.lastServerLon = ac.position.longitude;
          state.lastServerAlt = ac.position.altitude;
          state.lastServerHeading = ac.position.heading;
          state.lastServerSpeed = ac.position.speed;
          state.lastServerTime = now;
        }
      }
    });
    
    idToIndex.current = newIdToIndex;
    indexToId.current = newIndexToId;
    
    // Clean up states for removed aircraft
    const currentIds = new Set(aircraft.map(a => a.id));
    aircraftStates.current.forEach((_, id) => {
      if (!currentIds.has(id)) {
        aircraftStates.current.delete(id);
      }
    });
  }, [aircraft]);
  
  // Deload out-of-view aircraft periodically
  useEffect(() => {
    const checkDeload = () => {
      const nowMs = Date.now();
      const toRemove: string[] = [];
      
      outOfViewSince.current.forEach((exitTime, id) => {
        // Don't remove selected or hovered
        if (id === selectedAircraftId || id === hoveredAircraftId) {
          outOfViewSince.current.delete(id);
          return;
        }
        
        if (nowMs - exitTime > AIRCRAFT.DELOAD_GRACE_PERIOD) {
          toRemove.push(id);
          outOfViewSince.current.delete(id);
        }
      });
      
      if (toRemove.length > 0) {
        console.log(`[AircraftLayer] Deloading ${toRemove.length} out-of-view aircraft`);
        removeAircraft(toRemove);
      }
    };
    
    const interval = setInterval(checkDeload, AIRCRAFT.DELOAD_CHECK_INTERVAL);
    return () => clearInterval(interval);
  }, [removeAircraft, selectedAircraftId, hoveredAircraftId]);
  
  // Main render loop - update all instance transforms
  useFrame((state, delta) => {
    if (!meshRef.current || aircraft.length === 0) return;
    
    const mesh = meshRef.current;

    // Set actual instance count (args uses fixed MAX for stable mesh identity)
    mesh.count = aircraft.length;
    if (hitboxRef.current) {
      hitboxRef.current.count = aircraft.length;
      // Ensure bounding sphere covers globe for reliable raycasting
      if (!hitboxRef.current.boundingSphere) {
        hitboxRef.current.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2);
      }
    }

    const { dummy, color, frustum, projScreenMatrix, vec3_a } = allocs.current;
    const now = Date.now();
    const elapsedTime = state.clock.elapsedTime;
    
    // Check if animation can start
    const canAnimate = introPhase === 'aircraft' || introPhase === 'complete';
    if (canAnimate && animationStartTime.current === null) {
      animationStartTime.current = elapsedTime;
    }
    const animTime = animationStartTime.current !== null 
      ? elapsedTime - animationStartTime.current 
      : 0;
    
    // Update frustum for visibility checks
    projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreenMatrix);
    
    // Camera info for visibility
    vec3_a.set(0, 0, -1).applyQuaternion(camera.quaternion); // camera forward
    const cameraDistance = camera.position.length();
    
    // Zoom-based scale
    const zoomScale = Math.max(AIRCRAFT.ZOOM_SCALE_MIN, Math.min(AIRCRAFT.ZOOM_SCALE_MAX, cameraDistance / AIRCRAFT.ZOOM_SCALE_FACTOR));
    
    let needsColorUpdate = false;
    
    // Update each aircraft instance
    for (let i = 0; i < aircraft.length; i++) {
      const ac = aircraft[i];
      const acState = aircraftStates.current.get(ac.id);
      if (!acState) continue;
      
      const isSelected = ac.id === selectedAircraftId;
      const isHovered = ac.id === hoveredAircraftId;
      const isHighlighted = isSelected || isHovered;
      
      // Calculate stagger delay based on longitude
      const normalizedLon = (ac.position.longitude + 180) / 360;
      const staggerDelay = normalizedLon * AIRCRAFT.FADE_IN_STAGGER_DURATION;
      
      // Initialize fade-in start time
      if (canAnimate && acState.fadeInStartTime < 0) {
        acState.fadeInStartTime = animTime;
      }
      
      // Calculate fade-in progress
      const timeSinceFadeStart = acState.fadeInStartTime >= 0 
        ? animTime - acState.fadeInStartTime - staggerDelay 
        : -1;
      const fadeProgress = timeSinceFadeStart < 0 
        ? 0 
        : Math.min(1, timeSinceFadeStart / AIRCRAFT.FADE_IN_INDIVIDUAL_DURATION);
      
      // Before fade starts, hide aircraft
      if (fadeProgress <= 0) {
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      
      // Dead reckoning prediction
      const elapsedSeconds = (now - acState.lastServerTime) / 1000;
      let finalLat = acState.lastServerLat;
      let finalLon = acState.lastServerLon;
      
      if (acState.lastServerSpeed > AIRCRAFT.MIN_SPEED_FOR_PREDICTION && elapsedSeconds < AIRCRAFT.PREDICTION_MAX_SECONDS) {
        const predicted = predictPosition(
          acState.lastServerLat,
          acState.lastServerLon,
          acState.lastServerHeading,
          acState.lastServerSpeed,
          elapsedSeconds
        );
        finalLat = predicted.lat;
        finalLon = predicted.lon;
      }
      
      // Get position
      latLonToVector3Into(finalLat, finalLon, acState.lastServerAlt, 1, dummy.position);
      
      // Get orientation - instant, no lerp (heading is correct at spawn)
      getOrientationAtLatLonInto(
        finalLat, 
        finalLon, 
        acState.lastServerHeading, 
        acState.currentQuat,
        allocs.current
      );
      dummy.quaternion.copy(acState.currentQuat);
      
      // Calculate visibility
      const targetVisibility = isHighlighted ? 1 : calculateViewVisibility(dummy.position, camera);
      
      // Track out-of-view for deloading
      if (targetVisibility < 0.01) {
        if (!outOfViewSince.current.has(ac.id)) {
          outOfViewSince.current.set(ac.id, now);
        }
      } else {
        outOfViewSince.current.delete(ac.id);
      }
      
      // Smooth visibility transition
      const visSmoothFactor = Math.min(delta * AIRCRAFT.VISIBILITY_SMOOTH_FACTOR, AIRCRAFT.VISIBILITY_SMOOTH_MAX);
      acState.smoothVisibility += (targetVisibility - acState.smoothVisibility) * visSmoothFactor;
      
      // Calculate final scale
      const baseScale = isSelected ? AIRCRAFT.SCALE_SELECTED : isHovered ? AIRCRAFT.SCALE_HOVERED : 1;
      const pulse = isHighlighted ? 1 + Math.sin(elapsedTime * AIRCRAFT.PULSE_SPEED) * AIRCRAFT.PULSE_AMPLITUDE : 1;
      const finalScale = baseScale * pulse * zoomScale * acState.smoothVisibility * fadeProgress;
      
      dummy.scale.setScalar(finalScale);
      
      // Update opacity
      const opacitySmoothFactor = Math.min(delta * AIRCRAFT.OPACITY_SMOOTH_FACTOR, AIRCRAFT.OPACITY_SMOOTH_MAX);
      const targetOpacity = isHighlighted ? 1 : acState.smoothVisibility;
      acState.currentOpacity += (targetOpacity - acState.currentOpacity) * opacitySmoothFactor;
      
      // Apply transform
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      
      // Also update hitbox mesh with same transform
      if (hitboxRef.current) {
        hitboxRef.current.setMatrixAt(i, dummy.matrix);
      }
      
      // Update color based on selection/hover/military state
      if (isSelected) {
        color.set(COLORS.AIRCRAFT_SELECTED);
      } else if (isHovered) {
        color.set(COLORS.AIRCRAFT_HOVERED);
      } else if (ac.isMilitary) {
        color.set(COLORS.AIRCRAFT_MILITARY);
      } else {
        color.set(COLORS.AIRCRAFT_DEFAULT);
      }
      mesh.setColorAt(i, color);
      needsColorUpdate = true;
    }
    
    // Mark instance attributes as needing update
    mesh.instanceMatrix.needsUpdate = true;
    if (hitboxRef.current) {
      hitboxRef.current.instanceMatrix.needsUpdate = true;
    }
    if (needsColorUpdate && mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  });
  
  // Pointer event handlers
  const handlePointerOver = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined && indexToId.current[e.instanceId]) {
      hoverEntity({ type: 'aircraft', id: indexToId.current[e.instanceId] });
    }
  }, [hoverEntity]);
  
  const handlePointerOut = useCallback(() => {
    hoverEntity(null);
  }, [hoverEntity]);
  
  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined && indexToId.current[e.instanceId]) {
      selectEntity({ type: 'aircraft', id: indexToId.current[e.instanceId] });
    }
  }, [selectEntity]);
  
  if (aircraft.length === 0) return null;
  
  return (
    <group>
      {/* Flight path for hovered/selected aircraft */}
      {displayPathFor && <FlightPath icao24={displayPathFor} />}
      
      {/* Invisible hitbox mesh for pointer detection (larger geometry) */}
      <instancedMesh
        ref={hitboxRef}
        args={[hitboxGeometry, undefined, MAX_AIRCRAFT_INSTANCES]}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
        frustumCulled={false}
      >
        <meshBasicMaterial 
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </instancedMesh>
      
      {/* Visible instanced mesh for all aircraft - raycast disabled, hitbox handles events */}
      <instancedMesh
        ref={meshRef}
        args={[geometry, undefined, MAX_AIRCRAFT_INSTANCES]}
        frustumCulled={false}
        raycast={() => null}
      >
        <meshBasicMaterial 
          color={COLORS.AIRCRAFT_DEFAULT}
          side={THREE.DoubleSide}
          transparent
          opacity={0.9}
          depthWrite={false}
        />
      </instancedMesh>
    </group>
  );
}

