'use client';

import { useRef, useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Flat triangle geometry for ships — long and narrow like aircraft triangles
const SHIP_SIZE = 0.006;
let _shipGeometry: THREE.BufferGeometry | null = null;
let _shipHitboxGeometry: THREE.BufferGeometry | null = null;

function getShipGeometry(): THREE.BufferGeometry {
  if (!_shipGeometry) {
    const s = SHIP_SIZE;
    const geo = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      0, s * 1.4, 0,
      -s * 0.45, -s * 0.6, 0,
      s * 0.45, -s * 0.6, 0,
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.computeVertexNormals();
    _shipGeometry = geo;
  }
  return _shipGeometry;
}

function getShipHitboxGeometry(): THREE.BufferGeometry {
  if (!_shipHitboxGeometry) {
    const s = SHIP_SIZE * 2.5;
    const geo = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      0, s * 1.4, 0,
      -s * 0.6, -s * 0.8, 0,
      s * 0.6, -s * 0.8, 0,
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    _shipHitboxGeometry = geo;
  }
  return _shipHitboxGeometry;
}
import { useLayerData } from '@/hooks/useLayerData';
import { useEntityInteraction, ensureBoundingSphere } from '@/hooks/useEntityInteraction';
import { useRadarStore } from '@/store/gameStore';
import { GLOBE, COLORS, DOCKS } from '@/config/constants';

/**
 * Maritime Traffic Layer
 *
 * Renders ship positions as instanced meshes on the globe surface.
 * Color-coded by vessel type, oriented by heading.
 * Supports hover/select via invisible hitbox mesh (same pattern as AircraftLayerInstanced).
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
  imo?: number;
  destination?: string;
  draught?: number;
}

/** All ships render bright blue (matching docks); hover/select overrides */
const SHIP_COLOR = new THREE.Color(COLORS.MARITIME_DEFAULT);

const DEFAULT_COLOR = SHIP_COLOR;
const SELECTED_COLOR = new THREE.Color(COLORS.MARITIME_SELECTED);
const HOVERED_COLOR = new THREE.Color(COLORS.MARITIME_HOVERED);

const MAX_INSTANCES = 2000;

// Military border: red outline at 1.5x scale; non-military: no border (1x = hidden behind main)
const BORDER_COLOR_MILITARY = new THREE.Color(COLORS.MARITIME_MILITARY);
const BORDER_SCALE = 1.0;
const BORDER_SCALE_MILITARY = 1.5;

export function MaritimeLayer() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const borderMeshRef = useRef<THREE.InstancedMesh>(null);
  const hitboxRef = useRef<THREE.InstancedMesh>(null);

  const ships = useLayerData<Ship>('maritime');
  const setLayerEntities = useRadarStore((s) => s.setLayerEntities);
  const hoveredEntity = useRadarStore((s) => s.gameState.hoveredEntity);
  const selectedEntity = useRadarStore((s) => s.gameState.selectedEntity);
  const { indexToIdRef, handlers } = useEntityInteraction('ship');

  const hoveredShipId = hoveredEntity?.type === 'ship' ? hoveredEntity.id : null;
  const selectedShipId = selectedEntity?.type === 'ship' ? selectedEntity.id : null;
  const introPhase = useRadarStore((s) => s.introPhase);

  // Sweep animation state
  const animationTime = useRef(0);
  const animationStarted = useRef(false);

  // Alias for readability
  const indexToId = indexToIdRef;

  // Pre-allocate color attribute buffers (pre-filled with default color)
  const colorArray = useMemo(() => {
    const arr = new Float32Array(MAX_INSTANCES * 3);
    for (let i = 0; i < MAX_INSTANCES; i++) {
      arr[i * 3] = SHIP_COLOR.r;
      arr[i * 3 + 1] = SHIP_COLOR.g;
      arr[i * 3 + 2] = SHIP_COLOR.b;
    }
    return arr;
  }, []);
  const borderColorArray = useMemo(() => new Float32Array(MAX_INSTANCES * 3), []);

  // Sync visible entities into the store for search/selection
  useEffect(() => {
    setLayerEntities('maritime', ships);
  }, [ships, setLayerEntities]);

  // Initialize instance color buffers and force material recompile
  useEffect(() => {
    if (!meshRef.current) return;
    meshRef.current.instanceColor = new THREE.InstancedBufferAttribute(colorArray, 3);
    (meshRef.current.material as THREE.MeshBasicMaterial).needsUpdate = true;
  }, [colorArray]);

  useEffect(() => {
    if (!borderMeshRef.current) return;
    borderMeshRef.current.instanceColor = new THREE.InstancedBufferAttribute(borderColorArray, 3);
    (borderMeshRef.current.material as THREE.MeshBasicMaterial).needsUpdate = true;
  }, [borderColorArray]);

  // Update index mapping when ships change
  useEffect(() => {
    indexToId.current = ships.map((s) => s.id);
  }, [ships]);

  // Pre-computed stagger delays for diagonal sweep
  const staggerDelays = useMemo(() => {
    const distances = ships.map((ship, idx) => {
      const normalizedLat = (90 - ship.lat) / 180;
      const normalizedLon = (ship.lon + 180) / 360;
      const distance = Math.sqrt(normalizedLat * normalizedLat + normalizedLon * normalizedLon);
      return { idx, distance };
    });
    distances.sort((a, b) => a.distance - b.distance);
    const delays = new Array(ships.length);
    const delayPerItem = DOCKS.FADE_IN_STAGGER_DURATION / Math.max(1, ships.length);
    distances.forEach((item, sortedIdx) => {
      delays[item.idx] = sortedIdx * delayPerItem;
    });
    return delays;
  }, [ships]);

  useFrame((state, delta) => {
    if (!meshRef.current || ships.length === 0) return;

    // Start animation when maritime phase begins
    // If intro already complete (layer toggled back on), skip sweep
    if (introPhase === 'maritime' || introPhase === 'aircraft' || introPhase === 'satellites' || introPhase === 'complete') {
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

    // Ensure hitbox bounding sphere covers globe for reliable raycasting
    ensureBoundingSphere(hitboxRef.current);

    // Zoom-based scaling (same as aircraft)
    const cameraDistance = state.camera.position.length();
    const zoomScale = Math.max(0.2, Math.min(1.2, cameraDistance / 5));

    const dummy = new THREE.Object3D();
    const count = Math.min(ships.length, MAX_INSTANCES);
    meshRef.current.count = count;
    if (hitboxRef.current) hitboxRef.current.count = count;
    if (borderMeshRef.current) borderMeshRef.current.count = count;

    for (let i = 0; i < count; i++) {
      const ship = ships[i];
      const phi = (90 - ship.lat) * (Math.PI / 180);
      const theta = (ship.lon + 180) * (Math.PI / 180);
      const r = GLOBE.MARITIME_SURFACE_OFFSET;

      dummy.position.set(
        -r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
      );

      // Point along surface normal (away from globe center)
      dummy.lookAt(0, 0, 0);
      // Rotate to match vessel heading
      dummy.rotateZ(((ship.heading || 0) * Math.PI) / 180);

      // Sweep animation progress
      const delay = staggerDelays[i] ?? 0;
      const individualTime = Math.max(0, animationTime.current - delay);
      const individualProgress = animationStarted.current ? Math.min(1, individualTime / DOCKS.RIPPLE_DURATION) : 0;
      // Overshoot ease: small → BIG → normal
      const swoopT = individualProgress < 0.5
        ? 2 * individualProgress * individualProgress
        : 1 - Math.pow(-2 * individualProgress + 2, 2) / 2;
      const swoopScale = swoopT <= 0 ? 0 : swoopT < 1 ? DOCKS.RIPPLE_MIN_SCALE + swoopT * (DOCKS.RIPPLE_OVERSHOOT - DOCKS.RIPPLE_MIN_SCALE) * (swoopT < 0.7 ? 1 : (1 - swoopT) / 0.3) : 1;

      // Scale: base + speed bonus + highlight pulse + sweep + zoom
      const isSelected = ship.id === selectedShipId;
      const isHovered = ship.id === hoveredShipId;
      const isMilitary = ship.shipType === 'military';
      const speedScale = 1 + Math.min(ship.speed, 25) * 0.02;
      const highlightScale = isSelected ? 1.6 : isHovered ? 1.3 : 1;
      const baseScale = speedScale * highlightScale * swoopScale * zoomScale;

      dummy.scale.setScalar(baseScale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      if (hitboxRef.current) {
        hitboxRef.current.setMatrixAt(i, dummy.matrix);
      }

      // Border outline — scaled larger behind main mesh
      if (borderMeshRef.current) {
        const borderMult = isMilitary ? BORDER_SCALE_MILITARY : BORDER_SCALE;
        dummy.scale.setScalar(baseScale * borderMult);
        dummy.updateMatrix();
        borderMeshRef.current.setMatrixAt(i, dummy.matrix);

        const bc = BORDER_COLOR_MILITARY;
        borderColorArray[i * 3] = bc.r;
        borderColorArray[i * 3 + 1] = bc.g;
        borderColorArray[i * 3 + 2] = bc.b;
      }

      // Set instance color: selection > hover > blue
      let color: THREE.Color;
      if (isSelected) {
        color = SELECTED_COLOR;
      } else if (isHovered) {
        color = HOVERED_COLOR;
      } else {
        color = SHIP_COLOR;
      }
      colorArray[i * 3] = color.r;
      colorArray[i * 3 + 1] = color.g;
      colorArray[i * 3 + 2] = color.b;
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
    if (hitboxRef.current) {
      hitboxRef.current.instanceMatrix.needsUpdate = true;
    }
    if (borderMeshRef.current) {
      borderMeshRef.current.instanceMatrix.needsUpdate = true;
      if (borderMeshRef.current.instanceColor) {
        borderMeshRef.current.instanceColor.needsUpdate = true;
      }
    }
  });

  const shipGeo = useMemo(() => getShipGeometry(), []);
  const hitboxGeo = useMemo(() => getShipHitboxGeometry(), []);

  if (ships.length === 0) return null;

  return (
    <group>
      {/* Invisible hitbox mesh for pointer detection (larger geometry) */}
      <instancedMesh
        ref={hitboxRef}
        args={[hitboxGeo, undefined, MAX_INSTANCES]}
        {...handlers}
        frustumCulled={false}
      >
        <meshBasicMaterial
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </instancedMesh>

      {/* Border outline — renders behind main mesh */}
      <instancedMesh
        ref={borderMeshRef}
        args={[shipGeo, undefined, MAX_INSTANCES]}
        frustumCulled={false}
        renderOrder={0}
        raycast={() => null}
      >
        <meshBasicMaterial transparent opacity={1.0} side={THREE.DoubleSide} depthWrite={false} />
      </instancedMesh>

      {/* Visible instanced mesh — raycast disabled, hitbox handles events */}
      <instancedMesh
        ref={meshRef}
        args={[shipGeo, undefined, MAX_INSTANCES]}
        frustumCulled={false}
        renderOrder={1}
        raycast={() => null}
      >
        <meshBasicMaterial color={COLORS.MARITIME_DEFAULT} transparent opacity={1.0} side={THREE.DoubleSide} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}
