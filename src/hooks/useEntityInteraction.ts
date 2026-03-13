import { useRef, useCallback } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useRadarStore } from '@/store/gameStore';
import { EntityType } from '@/types/entities';

/**
 * Standardized entity hover/select interaction for instanced meshes.
 *
 * Returns pointer handlers to spread onto the interactive mesh (or hitbox),
 * and an indexToIdRef to maintain instance-index → entity-ID mapping.
 *
 * Usage:
 *   const { indexToIdRef, handlers } = useEntityInteraction('satellite');
 *   // Keep indexToIdRef.current in sync with instance indices
 *   // Spread handlers onto the interactive mesh: <instancedMesh {...handlers}>
 */
export function useEntityInteraction(entityType: EntityType) {
  const indexToIdRef = useRef<string[]>([]);
  const hoverEntity = useRadarStore((s) => s.hoverEntity);
  const selectEntity = useRadarStore((s) => s.selectEntity);

  const onPointerOver = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (e.instanceId !== undefined && indexToIdRef.current[e.instanceId]) {
        hoverEntity({ type: entityType, id: indexToIdRef.current[e.instanceId] });
      }
    },
    [hoverEntity, entityType]
  );

  const onPointerOut = useCallback(() => {
    hoverEntity(null);
  }, [hoverEntity]);

  const onClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (e.instanceId !== undefined && indexToIdRef.current[e.instanceId]) {
        selectEntity({ type: entityType, id: indexToIdRef.current[e.instanceId] });
      }
    },
    [selectEntity, entityType]
  );

  return {
    indexToIdRef,
    handlers: { onPointerOver, onPointerOut, onClick },
  };
}

/**
 * Ensure an instanced mesh has a bounding sphere large enough for raycasting.
 * Call once per frame (guards against re-setting).
 */
export function ensureBoundingSphere(
  mesh: THREE.InstancedMesh | null,
  radius: number = 2
) {
  if (mesh && !mesh.boundingSphere) {
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), radius);
  }
}
