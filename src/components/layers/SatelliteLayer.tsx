'use client';

import { useRef, useEffect, useMemo, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import * as satellite from 'satellite.js';
import { useLayerData } from '@/hooks/useLayerData';
import { useRadarStore } from '@/store/gameStore';
import { GLOBE, COLORS } from '@/config/constants';

/**
 * Satellite Overhead Layer
 *
 * Fetches TLE data from /api/satellites, propagates real-time positions
 * client-side using SGP4 (satellite.js), renders with instanced meshes.
 * Supports hover/selection and displays orbital metadata.
 */

// Raw satellite data from API
interface RawSatellite {
  id: string;
  name: string;
  noradId: string;
  tle1: string;
  tle2: string;
  group: string;
  intlDesignator: string;
}

// Propagated satellite with computed position
interface PropagatedSatellite {
  id: string;
  name: string;
  noradId: string;
  group: string;
  intlDesignator: string;
  lat: number;
  lon: number;
  alt: number; // km
  velocity: number; // km/s
  satrec: satellite.SatRec;
  // Orbital elements
  inclination: number;
  period: number; // minutes
  orbitType: string;
  entityType: 'satellite';
}

// Pre-allocated objects for render loop (avoid GC)
const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _raycaster = new THREE.Raycaster();
const _mouse = new THREE.Vector2();

const MAX_SATELLITE_INSTANCES = 5000;
const SATELLITE_SIZE = 0.004;
const HOVER_SCALE = 2.0;
const SELECTED_SCALE = 2.5;
const PULSE_SPEED = 4;
const SATELLITE_COLOR = COLORS.LAYER_SATELLITE;
const SATELLITE_HOVER_COLOR = '#ffffff';
const SATELLITE_SELECTED_COLOR = '#00ddff';

/** Classify orbit type from altitude (km) */
function classifyOrbit(altKm: number, inclination: number): string {
  if (altKm < 2000) {
    if (inclination > 85 && inclination < 105) return 'SSO';
    return 'LEO';
  }
  if (altKm < 35000) return 'MEO';
  if (altKm > 35000 && altKm < 36500) return 'GEO';
  return 'HEO';
}

/** Compute orbital period from mean motion (revs/day) */
function periodFromMeanMotion(meanMotion: number): number {
  if (meanMotion <= 0) return 0;
  return 1440 / meanMotion; // minutes
}

export function SatelliteLayer() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const rawSatellites = useLayerData<RawSatellite>('satellites');
  const setLayerEntities = useRadarStore((s) => s.setLayerEntities);
  const hoverEntity = useRadarStore((s) => s.hoverEntity);
  const selectEntity = useRadarStore((s) => s.selectEntity);
  const hoveredEntity = useRadarStore((s) => s.gameState.hoveredEntity);
  const selectedEntity = useRadarStore((s) => s.gameState.selectedEntity);
  const activeMode = useRadarStore((s) => s.gameState.activeMode);
  const { camera, gl } = useThree();

  // Parse TLE data into satrec objects (memoized — only recomputes when TLE data changes)
  const satRecords = useMemo(() => {
    if (!rawSatellites || rawSatellites.length === 0) return [];

    const records: { raw: RawSatellite; satrec: satellite.SatRec; inclination: number; period: number }[] = [];

    for (const raw of rawSatellites) {
      if (!raw.tle1 || !raw.tle2) continue;
      try {
        const satrec = satellite.twoline2satrec(raw.tle1, raw.tle2);
        // Extract inclination (radians) from satrec
        const inclinationDeg = satrec.inclo * (180 / Math.PI);
        const period = periodFromMeanMotion(satrec.no * (1440 / (2 * Math.PI))); // satrec.no is rad/min
        records.push({ raw, satrec, inclination: inclinationDeg, period });
      } catch {
        // Skip satellites with invalid TLE data
      }
    }

    return records;
  }, [rawSatellites]);

  // Store propagated satellites for entity lookups
  const propagatedRef = useRef<PropagatedSatellite[]>([]);

  // Update layer entities in store for search/selection
  const updateStoreEntities = useCallback(() => {
    setLayerEntities('satellites', propagatedRef.current);
  }, [setLayerEntities]);

  // Mouse interaction
  const hoveredIndexRef = useRef<number>(-1);

  useEffect(() => {
    const canvas = gl.domElement;

    const onPointerMove = (event: PointerEvent) => {
      if (activeMode !== 'all' && activeMode !== 'satellite') return;
      if (!meshRef.current || propagatedRef.current.length === 0) return;

      const rect = canvas.getBoundingClientRect();
      _mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      _mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      _raycaster.setFromCamera(_mouse, camera);
      const intersects = _raycaster.intersectObject(meshRef.current, false);

      if (intersects.length > 0 && intersects[0].instanceId !== undefined) {
        const idx = intersects[0].instanceId;
        if (idx < propagatedRef.current.length) {
          hoveredIndexRef.current = idx;
          const sat = propagatedRef.current[idx];
          hoverEntity({ type: 'satellite', id: sat.id });
          return;
        }
      }

      // Only clear hover if currently hovering a satellite
      if (hoveredEntity?.type === 'satellite') {
        hoveredIndexRef.current = -1;
        hoverEntity(null);
      }
    };

    const onClick = (event: MouseEvent) => {
      if (activeMode !== 'all' && activeMode !== 'satellite') return;
      if (!meshRef.current || propagatedRef.current.length === 0) return;

      const rect = canvas.getBoundingClientRect();
      _mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      _mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      _raycaster.setFromCamera(_mouse, camera);
      const intersects = _raycaster.intersectObject(meshRef.current, false);

      if (intersects.length > 0 && intersects[0].instanceId !== undefined) {
        const idx = intersects[0].instanceId;
        if (idx < propagatedRef.current.length) {
          const sat = propagatedRef.current[idx];
          selectEntity({ type: 'satellite', id: sat.id });
        }
      }
    };

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('click', onClick);
    return () => {
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('click', onClick);
    };
  }, [camera, gl, hoverEntity, selectEntity, hoveredEntity, activeMode]);

  // Propagate all satellites and render per frame
  useFrame(({ clock }) => {
    if (!meshRef.current || satRecords.length === 0) return;

    // Ensure bounding sphere covers globe + orbit altitudes for reliable raycasting
    if (!meshRef.current.boundingSphere) {
      meshRef.current.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2);
    }

    const now = new Date();
    const gmst = satellite.gstime(now);
    const t = clock.getElapsedTime();

    const propagated: PropagatedSatellite[] = [];
    let visibleCount = 0;

    for (let i = 0; i < satRecords.length; i++) {
      const { raw, satrec, inclination, period } = satRecords[i];

      try {
        const posVel = satellite.propagate(satrec, now);
        if (!posVel || !posVel.position || typeof posVel.position === 'boolean') continue;

        const positionEci = posVel.position;
        const velocityEci = posVel.velocity;

        const geodetic = satellite.eciToGeodetic(positionEci, gmst);
        const lat = satellite.degreesLat(geodetic.latitude);
        const lon = satellite.degreesLong(geodetic.longitude);
        const alt = geodetic.height; // km above earth surface

        // Skip satellites with clearly bad propagation
        if (isNaN(lat) || isNaN(lon) || isNaN(alt) || alt < 0 || alt > 100000) continue;

        // Compute velocity magnitude
        let velocity = 0;
        if (velocityEci && typeof velocityEci !== 'boolean') {
          velocity = Math.sqrt(
            velocityEci.x ** 2 + velocityEci.y ** 2 + velocityEci.z ** 2
          );
        }

        const orbitType = classifyOrbit(alt, inclination);

        const sat: PropagatedSatellite = {
          id: raw.id,
          name: raw.name,
          noradId: raw.noradId,
          group: raw.group,
          intlDesignator: raw.intlDesignator,
          lat,
          lon,
          alt,
          velocity,
          satrec,
          inclination,
          period,
          orbitType,
          entityType: 'satellite',
        };

        propagated.push(sat);

        // Position on globe
        const phi = (90 - lat) * (Math.PI / 180);
        const theta = (lon + 180) * (Math.PI / 180);

        // Scale altitude: LEO ~200-2000km, GEO ~35786km
        const altNorm = Math.min(alt / 40000, 1);
        const r =
          GLOBE.SATELLITE_MIN_ALTITUDE +
          altNorm * (GLOBE.SATELLITE_MAX_ALTITUDE - GLOBE.SATELLITE_MIN_ALTITUDE);

        _dummy.position.set(
          -r * Math.sin(phi) * Math.cos(theta),
          r * Math.cos(phi),
          r * Math.sin(phi) * Math.sin(theta)
        );

        // Point toward Earth center
        _dummy.lookAt(0, 0, 0);

        // Determine scale based on hover/selection state
        const isHovered = hoveredEntity?.type === 'satellite' && hoveredEntity.id === raw.id;
        const isSelected = selectedEntity?.type === 'satellite' && selectedEntity.id === raw.id;

        let scale = 1;
        if (isSelected) {
          scale = SELECTED_SCALE + Math.sin(t * PULSE_SPEED) * 0.3;
        } else if (isHovered) {
          scale = HOVER_SCALE;
        }

        _dummy.scale.setScalar(scale);
        _dummy.updateMatrix();
        meshRef.current.setMatrixAt(visibleCount, _dummy.matrix);

        // Color based on state
        if (isSelected) {
          _color.set(SATELLITE_SELECTED_COLOR);
        } else if (isHovered) {
          _color.set(SATELLITE_HOVER_COLOR);
        } else {
          _color.set(SATELLITE_COLOR);
        }
        meshRef.current.setColorAt(visibleCount, _color);

        visibleCount++;
      } catch {
        // Skip satellites with propagation errors
      }
    }

    meshRef.current.count = visibleCount;
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }

    // Update propagated reference for entity lookups & mouse interaction
    propagatedRef.current = propagated;
  });

  // Periodically sync propagated data to store (not every frame — every 2s)
  useEffect(() => {
    const interval = setInterval(() => {
      updateStoreEntities();
    }, 2000);
    updateStoreEntities();
    return () => clearInterval(interval);
  }, [updateStoreEntities]);

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, MAX_SATELLITE_INSTANCES]}
        frustumCulled={false}
      >
        <octahedronGeometry args={[SATELLITE_SIZE, 0]} />
        <meshBasicMaterial
          vertexColors
          transparent
          opacity={0.9}
          depthWrite={false}
        />
      </instancedMesh>
    </group>
  );
}
