'use client';

import { useRef, useEffect, useMemo, useCallback } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as satellite from 'satellite.js';
import { useLayerData } from '@/hooks/useLayerData';
import { useRadarStore } from '@/store/gameStore';
import { GLOBE, COLORS, DOCKS } from '@/config/constants';

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

const MAX_SATELLITE_INSTANCES = 5000;
const SATELLITE_SIZE = 0.004;
const SATELLITE_HITBOX_SIZE = 0.02; // Larger invisible hitbox for easier clicking
const HOVER_SCALE = 2.0;
const SELECTED_SCALE = 2.5;
const SATELLITE_COLOR = COLORS.SATELLITE_DEFAULT;
const SATELLITE_HOVER_COLOR = COLORS.SATELLITE_HOVERED;
const SATELLITE_SELECTED_COLOR = COLORS.SATELLITE_SELECTED;

/** Two overlapping rectangles rotated 45° to form a star/cross shape */
function createSatelliteStarGeometry(size: number): THREE.BufferGeometry {
  const w = size;
  const h = size * 2.5;
  const rect1 = new THREE.PlaneGeometry(w, h);
  const rect2 = new THREE.PlaneGeometry(w, h);
  rect2.rotateZ(Math.PI / 4);
  rect1.rotateZ(-Math.PI / 4);
  return mergeGeometries([rect1, rect2])!;
}

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
  const hitboxRef = useRef<THREE.InstancedMesh>(null);
  const starGeometry = useMemo(() => createSatelliteStarGeometry(SATELLITE_SIZE), []);
  const rawSatellites = useLayerData<RawSatellite>('satellites');
  const setLayerEntities = useRadarStore((s) => s.setLayerEntities);
  const hoverEntity = useRadarStore((s) => s.hoverEntity);
  const selectEntity = useRadarStore((s) => s.selectEntity);
  const hoveredEntity = useRadarStore((s) => s.gameState.hoveredEntity);
  const selectedEntity = useRadarStore((s) => s.gameState.selectedEntity);
  const introPhase = useRadarStore((s) => s.introPhase);

  // Sweep animation state
  const satAnimationTime = useRef(0);
  const satAnimationStarted = useRef(false);

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
  const materialNeedsRecompile = useRef(true);

  // Index-to-ID mapping for hitbox events
  const indexToIdRef = useRef<string[]>([]);

  // Update layer entities in store for search/selection
  const updateStoreEntities = useCallback(() => {
    setLayerEntities('satellites', propagatedRef.current);
  }, [setLayerEntities]);

  // Pointer event handlers (R3F events on hitbox mesh)
  const handlePointerOver = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined && e.instanceId < indexToIdRef.current.length) {
      hoverEntity({ type: 'satellite', id: indexToIdRef.current[e.instanceId] });
    }
  }, [hoverEntity]);

  const handlePointerOut = useCallback(() => {
    hoverEntity(null);
  }, [hoverEntity]);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined && e.instanceId < indexToIdRef.current.length) {
      selectEntity({ type: 'satellite', id: indexToIdRef.current[e.instanceId] });
    }
  }, [selectEntity]);

  // Propagate all satellites and render per frame
  useFrame((_, delta) => {
    if (!meshRef.current || satRecords.length === 0) return;

    // Ensure hitbox bounding sphere covers orbital range for reliable raycasting
    if (hitboxRef.current && !hitboxRef.current.boundingSphere) {
      hitboxRef.current.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), GLOBE.SATELLITE_MAX_ALTITUDE + 0.1);
    }

    // Start sweep animation when satellites phase begins
    // If intro is already complete (re-toggle), skip animation entirely
    if (introPhase === 'satellites' || introPhase === 'complete') {
      if (!satAnimationStarted.current) {
        satAnimationStarted.current = true;
        // Skip sweep if intro already done (layer was toggled off/on)
        satAnimationTime.current = introPhase === 'complete'
          ? DOCKS.FADE_IN_STAGGER_DURATION * 0.5
          : 0;
      }
    }
    if (satAnimationStarted.current) {
      satAnimationTime.current += delta;
    }

    const now = new Date();
    const gmst = satellite.gstime(now);

    const propagated: PropagatedSatellite[] = [];
    const ids: string[] = [];
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
        ids.push(raw.id);

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

        // Sweep animation: stagger by index
        const staggerDelay = (i / Math.max(1, satRecords.length)) * DOCKS.FADE_IN_STAGGER_DURATION;
        const individualTime = Math.max(0, satAnimationTime.current - staggerDelay);
        const sweepProgress = satAnimationStarted.current ? Math.min(1, individualTime / DOCKS.RIPPLE_DURATION) : 0;
        // Ease-out for smooth pop-in
        const sweepEased = sweepProgress < 1 ? 1 - Math.pow(1 - sweepProgress, 3) : 1;
        const sweepScale = satAnimationStarted.current ? (sweepProgress <= 0 ? 0 : sweepEased) : 0;

        // Determine scale based on hover/selection state
        const isHovered = hoveredEntity?.type === 'satellite' && hoveredEntity.id === raw.id;
        const isSelected = selectedEntity?.type === 'satellite' && selectedEntity.id === raw.id;

        let scale = sweepScale;
        if (isSelected) {
          scale *= SELECTED_SCALE;
        } else if (isHovered) {
          scale *= HOVER_SCALE;
        }

        // Update visible mesh
        _dummy.scale.setScalar(scale);
        _dummy.updateMatrix();
        meshRef.current.setMatrixAt(visibleCount, _dummy.matrix);

        // Update hitbox mesh with same position but fixed larger scale
        if (hitboxRef.current) {
          _dummy.scale.setScalar(sweepScale > 0 ? 1 : 0);
          _dummy.updateMatrix();
          hitboxRef.current.setMatrixAt(visibleCount, _dummy.matrix);
        }

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
      // Force shader recompile after instanceColor is first created
      if (materialNeedsRecompile.current) {
        (meshRef.current.material as THREE.MeshBasicMaterial).needsUpdate = true;
        materialNeedsRecompile.current = false;
      }
    }

    // Update hitbox mesh count
    if (hitboxRef.current) {
      hitboxRef.current.count = visibleCount;
      hitboxRef.current.instanceMatrix.needsUpdate = true;
    }

    // Update propagated reference for entity lookups
    propagatedRef.current = propagated;
    indexToIdRef.current = ids;
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
      {/* Invisible hitbox mesh for pointer detection (larger geometry) */}
      <instancedMesh
        ref={hitboxRef}
        args={[undefined, undefined, MAX_SATELLITE_INSTANCES]}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
        frustumCulled={false}
      >
        <sphereGeometry args={[SATELLITE_HITBOX_SIZE, 6, 4]} />
        <meshBasicMaterial
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </instancedMesh>

      {/* Visible instanced mesh - raycast disabled, hitbox handles events */}
      <instancedMesh
        ref={meshRef}
        args={[starGeometry, undefined, MAX_SATELLITE_INSTANCES]}
        frustumCulled={false}
        raycast={() => null}
      >
        <meshBasicMaterial
          transparent
          opacity={1.0}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </instancedMesh>
    </group>
  );
}
