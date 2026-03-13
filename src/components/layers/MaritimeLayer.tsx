'use client';

import { useRef, useEffect, useMemo, useCallback } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useLayerData } from '@/hooks/useLayerData';
import { useRadarStore } from '@/store/gameStore';
import { GLOBE } from '@/config/constants';

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

/** Ship type color mapping */
const SHIP_COLORS: Record<string, THREE.Color> = {
  cargo: new THREE.Color('#4488ff'),
  tanker: new THREE.Color('#ff8844'),
  passenger: new THREE.Color('#ffffff'),
  military: new THREE.Color('#ff4444'),
  fishing: new THREE.Color('#44cc66'),
  high_speed: new THREE.Color('#ffcc00'),
  special: new THREE.Color('#cc44ff'),
  other: new THREE.Color('#88aacc'),
};

const DEFAULT_COLOR = new THREE.Color('#88aacc');
const SELECTED_COLOR = new THREE.Color('#00ff88');
const HOVERED_COLOR = new THREE.Color('#ffcc00');

const MAX_INSTANCES = 2000;

export function MaritimeLayer() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const hitboxRef = useRef<THREE.InstancedMesh>(null);

  const ships = useLayerData<Ship>('maritime');
  const setLayerEntities = useRadarStore((s) => s.setLayerEntities);
  const selectEntity = useRadarStore((s) => s.selectEntity);
  const hoverEntity = useRadarStore((s) => s.hoverEntity);
  const hoveredEntity = useRadarStore((s) => s.gameState.hoveredEntity);
  const selectedEntity = useRadarStore((s) => s.gameState.selectedEntity);

  const hoveredShipId = hoveredEntity?.type === 'ship' ? hoveredEntity.id : null;
  const selectedShipId = selectedEntity?.type === 'ship' ? selectedEntity.id : null;

  // Index mapping for pointer events
  const indexToId = useRef<string[]>([]);

  // Pre-allocate color attribute buffer
  const colorArray = useMemo(() => new Float32Array(MAX_INSTANCES * 3), []);

  // Sync visible entities into the store for search/selection
  useEffect(() => {
    setLayerEntities('maritime', ships);
  }, [ships, setLayerEntities]);

  // Initialize instance color buffer
  useEffect(() => {
    if (!meshRef.current) return;
    meshRef.current.instanceColor = new THREE.InstancedBufferAttribute(colorArray, 3);
  }, [colorArray]);

  // Update index mapping when ships change
  useEffect(() => {
    indexToId.current = ships.map((s) => s.id);
  }, [ships]);

  useFrame(() => {
    if (!meshRef.current || ships.length === 0) return;

    // Ensure hitbox bounding sphere covers globe for reliable raycasting
    if (hitboxRef.current && !hitboxRef.current.boundingSphere) {
      hitboxRef.current.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2);
    }

    const dummy = new THREE.Object3D();
    const count = Math.min(ships.length, MAX_INSTANCES);
    meshRef.current.count = count;
    if (hitboxRef.current) hitboxRef.current.count = count;

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

      // Scale: base + speed bonus + highlight pulse
      const isSelected = ship.id === selectedShipId;
      const isHovered = ship.id === hoveredShipId;
      const speedScale = 1 + Math.min(ship.speed, 25) * 0.02;
      const highlightScale = isSelected ? 1.6 : isHovered ? 1.3 : 1;
      dummy.scale.setScalar(speedScale * highlightScale);

      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      if (hitboxRef.current) {
        hitboxRef.current.setMatrixAt(i, dummy.matrix);
      }

      // Set instance color: selection > hover > ship type
      let color: THREE.Color;
      if (isSelected) {
        color = SELECTED_COLOR;
      } else if (isHovered) {
        color = HOVERED_COLOR;
      } else {
        color = SHIP_COLORS[ship.shipType] || DEFAULT_COLOR;
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
  });

  // Pointer event handlers
  const handlePointerOver = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (e.instanceId !== undefined && indexToId.current[e.instanceId]) {
        hoverEntity({ type: 'ship', id: indexToId.current[e.instanceId] });
      }
    },
    [hoverEntity]
  );

  const handlePointerOut = useCallback(() => {
    hoverEntity(null);
  }, [hoverEntity]);

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (e.instanceId !== undefined && indexToId.current[e.instanceId]) {
        selectEntity({ type: 'ship', id: indexToId.current[e.instanceId] });
      }
    },
    [selectEntity]
  );

  if (ships.length === 0) return null;

  return (
    <group>
      {/* Invisible hitbox mesh for pointer detection (larger geometry) */}
      <instancedMesh
        ref={hitboxRef}
        args={[undefined, undefined, MAX_INSTANCES]}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
        frustumCulled={false}
      >
        <coneGeometry args={[0.008, 0.02, 4]} />
        <meshBasicMaterial
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </instancedMesh>

      {/* Visible instanced mesh — raycast disabled, hitbox handles events */}
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, MAX_INSTANCES]}
        frustumCulled={false}
        raycast={() => null}
      >
        <coneGeometry args={[0.004, 0.012, 3]} />
        <meshBasicMaterial vertexColors transparent opacity={0.85} />
      </instancedMesh>
    </group>
  );
}
