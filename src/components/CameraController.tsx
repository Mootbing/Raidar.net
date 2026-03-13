'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useRadarStore } from '@/store/gameStore';
import { CAMERA, LOCATIONS, INPUT, AIRPORTS } from '@/config/constants';
import { useCanvasInput, useInputState } from '@/hooks/useInputManager';
import { InputAction } from '@/lib/inputManager';
import { latLonToVector3, predictPosition } from '@/utils/geo';

/** Compute local tangent frame at a lat/lon with heading on globe surface */
function getLocalFrame(lat: number, lon: number, heading: number) {
  const pos = latLonToVector3(lat, lon, 0);
  const up = pos.clone().normalize();

  const latRad = lat * (Math.PI / 180);
  const lonRad = lon * (Math.PI / 180);

  const north = new THREE.Vector3(
    Math.sin(latRad) * Math.cos(lonRad + Math.PI),
    Math.cos(latRad),
    -Math.sin(latRad) * Math.sin(lonRad + Math.PI)
  ).normalize();

  north.sub(up.clone().multiplyScalar(north.dot(up))).normalize();
  const east = new THREE.Vector3().crossVectors(up, north).normalize();
  north.crossVectors(east, up).normalize();

  const headingRad = heading * (Math.PI / 180);
  const forward = new THREE.Vector3()
    .addScaledVector(north, Math.cos(headingRad))
    .addScaledVector(east, Math.sin(headingRad))
    .normalize();

  const right = new THREE.Vector3().crossVectors(forward, up).normalize();

  return { pos, up, forward, right };
}

export function CameraController() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();
  
  const selectedEntity = useRadarStore((state) => state.gameState.selectedEntity);
  const focusLocation = useRadarStore((state) => state.gameState.focusLocation);
  const restoreCameraFlag = useRadarStore((state) => state.gameState.restoreCameraFlag);
  // activeMode is accessed via getState() in findNearestEntity/findEntityInDirection to avoid stale closures
  const aircraft = useRadarStore((state) => state.aircraft);
  const airports = useRadarStore((state) => state.airports);
  const hoverEntity = useRadarStore((state) => state.hoverEntity);
  const setFocusLocation = useRadarStore((state) => state.setFocusLocation);
  
  // Get selected IDs by type
  const selectedAircraftId = selectedEntity?.type === 'aircraft' ? selectedEntity.id : null;
  const selectedAirportId = selectedEntity?.type === 'airport' ? selectedEntity.id : null;
  
  // Backward compat alias
  const selectedId = selectedAircraftId;
  
  const isAnimating = useRef(false);
  const animationProgress = useRef(0);
  const startPosition = useRef(new THREE.Vector3());
  const startTarget = useRef(new THREE.Vector3());
  const targetCameraPos = useRef(new THREE.Vector3());
  const targetLookAt = useRef(new THREE.Vector3());
  
  // Multi-phase animation for fly-over effect
  const animationPhase = useRef<'direct' | 'flyover'>('direct');
  const midpointCameraPos = useRef(new THREE.Vector3());
  const FLYOVER_ZOOM_OUT_DISTANCE = CAMERA.FLYOVER_ZOOM_OUT;
  
  const currentTarget = useRef(new THREE.Vector3(0, 0, 0));
  const currentCameraOffset = useRef(new THREE.Vector3());
  
  const prevSelectedId = useRef<string | null>(null);
  
  // Track last server update for selected aircraft prediction
  const lastServerData = useRef<{
    lat: number;
    lon: number;
    alt: number;
    heading: number;
    speed: number;
    time: number;
  } | null>(null);
  const isReturningToEarth = useRef(false);
  const hasInitializedLocation = useRef(false);
  const [controlsReady, setControlsReady] = useState(false);

  // Mark controls as ready when ref is set (check on each frame until ready)
  useFrame(() => {
    if (!controlsReady && controlsRef.current) {
      setControlsReady(true);
    }
  });
  
  // Save camera state before selecting an aircraft so we can return to it
  const savedCameraPosition = useRef(new THREE.Vector3());
  const savedCameraTarget = useRef(new THREE.Vector3());
  
  // Track if we were moving with arrows (for clearing hover on movement)
  const wasMovingWithArrows = useRef(false);
  
  // Snap mode toggle (Shift to toggle, arrows to navigate when on)
  const snapMode = useRadarStore((s) => s.gameState.snapMode);
  const toggleSnapMode = useRadarStore((s) => s.toggleSnapMode);
  
  // View mode cycling (Q/E when aircraft selected)
  const cycleViewMode = useRadarStore((s) => s.cycleViewMode);
  const viewMode = useRadarStore((s) => s.gameState.viewMode);
  const prevViewMode = useRef(viewMode);

  // Helper to find nearest entity to camera center (respects activeMode)
  // Helper to check if a small airport is visible (based on camera distance)
  const isSmallAirportVisible = () => {
    const cameraDistance = camera.position.length();
    const opacity = Math.max(0, Math.min(1, (AIRPORTS.SMALL_AIRPORT_FADE_DISTANCE - cameraDistance) * AIRPORTS.SMALL_AIRPORT_FADE_SPEED));
    return opacity > 0.1; // Consider visible if opacity > 10%
  };
  
  const findNearestEntity = () => {
    // Get current mode from store (avoids stale closure)
    const currentMode = useRadarStore.getState().gameState.activeMode;
    const currentAirports = useRadarStore.getState().airports;
    const currentAircraft = useRadarStore.getState().aircraft;
    
    // Check if small airports are visible at current zoom level
    const smallAirportsVisible = isSmallAirportVisible();
    
    // Get viewport center using ray-sphere intersection
    const camPos = camera.position.clone();
    const viewDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    
    // Ray-sphere intersection with unit sphere
    const a = viewDir.dot(viewDir);
    const b = 2 * camPos.dot(viewDir);
    const c = camPos.dot(camPos) - 1;
    const discriminant = b * b - 4 * a * c;
    
    let lookPoint: THREE.Vector3;
    if (discriminant >= 0) {
      const t = (-b - Math.sqrt(discriminant)) / (2 * a);
      lookPoint = camPos.clone().add(viewDir.clone().multiplyScalar(t));
    } else {
      lookPoint = camPos.clone().normalize();
    }
    
    // Convert to lat/lon
    const lookLat = 90 - Math.acos(Math.max(-1, Math.min(1, lookPoint.y))) * (180 / Math.PI);
    const lookLon = Math.atan2(lookPoint.z, -lookPoint.x) * (180 / Math.PI) - 180;
    
    let bestEntity: { type: 'airport' | 'aircraft'; lat: number; lon: number; id: string } | null = null;
    let bestDist = Infinity;
    
    // Check airports if mode allows
    if (currentMode === 'all' || currentMode === 'airport') {
      for (const airport of currentAirports) {
        // Skip small airports if they're not visible (zoomed out too far)
        const isLargeAirport = airport.type === 'large_airport';
        if (!isLargeAirport && !smallAirportsVisible) continue;
        
        const latDiff = airport.lat - lookLat;
        const lonDiff = airport.lon - lookLon;
        const dist = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
        
        if (dist < bestDist && dist < 15) { // Within 15 degrees
          bestDist = dist;
          bestEntity = { type: 'airport', lat: airport.lat, lon: airport.lon, id: airport.icao };
        }
      }
    }
    
    // Check aircraft if mode allows
    if (currentMode === 'all' || currentMode === 'aircraft') {
      for (const ac of currentAircraft) {
        const latDiff = ac.position.latitude - lookLat;
        const lonDiff = ac.position.longitude - lookLon;
        const dist = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
        
        if (dist < bestDist && dist < 15) { // Within 15 degrees
          bestDist = dist;
          bestEntity = { type: 'aircraft', lat: ac.position.latitude, lon: ac.position.longitude, id: ac.id };
        }
      }
    }
    
    return bestEntity;
  };
  
  // Helper to find nearest entity in a direction (respects activeMode)
  const findEntityInDirection = (direction: 'up' | 'down' | 'left' | 'right') => {
    // Get current mode from store (avoids stale closure)
    const currentMode = useRadarStore.getState().gameState.activeMode;
    const currentAirports = useRadarStore.getState().airports;
    const currentAircraft = useRadarStore.getState().aircraft;
    const currentHovered = useRadarStore.getState().gameState.hoveredEntity;
    
    // Check if small airports are visible at current zoom level
    const smallAirportsVisible = isSmallAirportVisible();
    
    // Get viewport center - where camera is looking at on the globe surface
    // Cast a ray from camera in the view direction and intersect with unit sphere
    const camPos = camera.position.clone();
    const viewDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    
    // Ray-sphere intersection: find where view ray hits unit sphere
    // Sphere at origin with radius 1
    const a = viewDir.dot(viewDir);
    const b = 2 * camPos.dot(viewDir);
    const c = camPos.dot(camPos) - 1;
    const discriminant = b * b - 4 * a * c;
    
    let viewportCenter: THREE.Vector3;
    if (discriminant >= 0) {
      // Ray hits sphere - use the closer intersection point
      const t = (-b - Math.sqrt(discriminant)) / (2 * a);
      viewportCenter = camPos.clone().add(viewDir.clone().multiplyScalar(t));
    } else {
      // Fallback: project camera position onto sphere
      viewportCenter = camPos.clone().normalize();
    }
    
    // Convert viewport center to lat/lon (2D, ignore altitude)
    const centerLat = 90 - Math.acos(Math.max(-1, Math.min(1, viewportCenter.y))) * (180 / Math.PI);
    const centerLon = Math.atan2(viewportCenter.z, -viewportCenter.x) * (180 / Math.PI) - 180;
    
    // If we have a hovered entity, use its position as the reference point
    let refLat = centerLat;
    let refLon = centerLon;
    
    if (currentHovered) {
      if (currentHovered.type === 'airport') {
        const ap = currentAirports.find(a => a.icao === currentHovered.id);
        if (ap) {
          refLat = ap.lat;
          refLon = ap.lon;
        }
      } else if (currentHovered.type === 'aircraft') {
        const ac = currentAircraft.find(a => a.id === currentHovered.id);
        if (ac) {
          refLat = ac.position.latitude;
          refLon = ac.position.longitude;
        }
      }
    }
    
    let bestEntity: { type: 'airport' | 'aircraft'; lat: number; lon: number; id: string } | null = null;
    let bestDist = Infinity;
    
    // Direction angle (degrees from north, clockwise)
    // up = north (0°), right = east (90°), down = south (180°), left = west (270°)
    const dirAngles: Record<string, number> = {
      up: 0,
      right: 90,
      down: 180,
      left: 270,
    };
    const targetAngle = dirAngles[direction];
    const tolerance = 75; // Degrees - how wide the search cone is
    
    // Check airports if mode allows
    if (currentMode === 'all' || currentMode === 'airport') {
      for (const airport of currentAirports) {
        // Skip currently hovered
        if (currentHovered?.type === 'airport' && currentHovered.id === airport.icao) continue;
        
        // Skip small airports if they're not visible (zoomed out too far)
        const isLargeAirport = airport.type === 'large_airport';
        if (!isLargeAirport && !smallAirportsVisible) continue;
        
        // 2D distance (ignore altitude)
        const latDiff = airport.lat - refLat;
        const lonDiff = airport.lon - refLon;
        const dist = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
        
        // Skip if too close (same position) or too far
        if (dist < 0.1 || dist > 50) continue;
        
        // Calculate angle from reference to this entity (degrees from north)
        const angle = (Math.atan2(lonDiff, latDiff) * (180 / Math.PI) + 360) % 360;
        
        // Check if within direction cone
        let angleDiff = Math.abs(angle - targetAngle);
        if (angleDiff > 180) angleDiff = 360 - angleDiff;
        
        if (angleDiff > tolerance) continue;
        
        // Find the closest entity in the direction
        if (dist < bestDist) {
          bestDist = dist;
          bestEntity = { type: 'airport', lat: airport.lat, lon: airport.lon, id: airport.icao };
        }
      }
    }
    
    // Check aircraft if mode allows
    if (currentMode === 'all' || currentMode === 'aircraft') {
      for (const ac of currentAircraft) {
        // Skip currently hovered
        if (currentHovered?.type === 'aircraft' && currentHovered.id === ac.id) continue;
        
        // 2D distance (ignore altitude)
        const latDiff = ac.position.latitude - refLat;
        const lonDiff = ac.position.longitude - refLon;
        const dist = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
        
        // Skip if too close or too far
        if (dist < 0.1 || dist > 50) continue;
        
        // Calculate angle from reference to this entity
        const angle = (Math.atan2(lonDiff, latDiff) * (180 / Math.PI) + 360) % 360;
        
        // Check if within direction cone
        let angleDiff = Math.abs(angle - targetAngle);
        if (angleDiff > 180) angleDiff = 360 - angleDiff;
        
        if (angleDiff > tolerance) continue;
        
        // Find the closest entity in the direction
        if (dist < bestDist) {
          bestDist = dist;
          bestEntity = { type: 'aircraft', lat: ac.position.latitude, lon: ac.position.longitude, id: ac.id };
        }
      }
    }
    
    return bestEntity;
  };
  
  // Track previous snap mode to detect when it turns ON
  const prevSnapMode = useRef(snapMode);
  
  // When snap mode is toggled ON, find and hover nearest entity
  useEffect(() => {
    if (snapMode && !prevSnapMode.current) {
      // Snap mode just turned ON - find nearest entity
      const nearest = findNearestEntity();
      if (nearest) {
        hoverEntity({ type: nearest.type, id: nearest.id });
      }
    }
    prevSnapMode.current = snapMode;
  }, [snapMode, hoverEntity]);
  
  // Get input state from centralized input manager
  const getInputState = useInputState();
  
  // Handle canvas input actions from centralized input manager
  const handleCanvasAction = useCallback((action: InputAction) => {
    const currentSelectedEntity = useRadarStore.getState().gameState.selectedEntity;
    const currentSnapMode = useRadarStore.getState().gameState.snapMode;
    
    switch (action) {
      case 'view_prev':
        if (currentSelectedEntity?.type === 'aircraft') {
          cycleViewMode('prev');
        }
        break;
      case 'view_next':
        if (currentSelectedEntity?.type === 'aircraft') {
          cycleViewMode('next');
        }
        break;
      case 'snap_up':
      case 'snap_down':
      case 'snap_left':
      case 'snap_right':
        if (currentSnapMode) {
          const direction = action.replace('snap_', '') as 'up' | 'down' | 'left' | 'right';
          const entity = findEntityInDirection(direction);
          if (entity) {
            setFocusLocation({ lat: entity.lat, lon: entity.lon });
            hoverEntity({ type: entity.type, id: entity.id });
          }
        } else {
          // Clear hover when starting freecam movement
          if (!wasMovingWithArrows.current) {
            hoverEntity(null);
          }
          wasMovingWithArrows.current = true;
        }
        break;
      case 'deselect':
        hoverEntity(null);
        if (currentSnapMode) {
          toggleSnapMode();
        }
        break;
      case 'snap_toggle':
        toggleSnapMode();
        break;
    }
  }, [cycleViewMode, findEntityInDirection, setFocusLocation, hoverEntity, toggleSnapMode]);
  
  useCanvasInput(handleCanvasAction);
  
  // Set initial camera position to default location (Middle East) immediately — no geolocation
  useEffect(() => {
    if (hasInitializedLocation.current) return;
    if (!controlsReady || !controlsRef.current) return;
    hasInitializedLocation.current = true;

    const targetPoint = latLonToVector3(LOCATIONS.DEFAULT.lat, LOCATIONS.DEFAULT.lon, 0);
    const cameraDirection = targetPoint.clone().normalize();
    const finalCameraPos = cameraDirection.clone().multiplyScalar(CAMERA.DEFAULT_DISTANCE);

    // Teleport camera immediately — no animation
    camera.position.copy(finalCameraPos);
    controlsRef.current.target.set(0, 0, 0);
    currentTarget.current.set(0, 0, 0);
    controlsRef.current.update();
  }, [controlsReady, camera]);
  
  // Focus on a specific location (from search, etc.) - flyover animation
  const prevFocusLocation = useRef<{ lat: number; lon: number } | null>(null);
  const hasSavedForFocus = useRef(false);
  useEffect(() => {
    if (!focusLocation || !controlsRef.current) return;
    
    // Skip if same location
    if (prevFocusLocation.current && 
        Math.abs(prevFocusLocation.current.lat - focusLocation.lat) < 0.0001 &&
        Math.abs(prevFocusLocation.current.lon - focusLocation.lon) < 0.0001) {
      return;
    }
    
    // Save camera position on FIRST focus (before any search navigation)
    if (!hasSavedForFocus.current && !selectedId) {
      savedCameraPosition.current.copy(camera.position);
      savedCameraTarget.current.copy(controlsRef.current.target);
      hasSavedForFocus.current = true;
    }
    
    const hadPrevLocation = prevFocusLocation.current !== null;
    prevFocusLocation.current = { lat: focusLocation.lat, lon: focusLocation.lon };
    
    // Don't override if we're tracking a selected entity
    if (selectedId) return;
    
    const currentDistance = camera.position.length();
    const targetPoint = latLonToVector3(focusLocation.lat, focusLocation.lon, focusLocation.alt || 0);
    const cameraDirection = targetPoint.clone().normalize();
    const finalCameraPos = cameraDirection.clone().multiplyScalar(currentDistance);
    
    // Calculate distance between current and target positions
    const travelDistance = camera.position.distanceTo(finalCameraPos);
    
    // Use flyover animation if moving a significant distance (and not first focus)
    const useFlyover = hadPrevLocation && travelDistance > INPUT.ANIMATION.FLYOVER_TRAVEL_THRESHOLD;
    
    isAnimating.current = true;
    isReturningToEarth.current = false;
    animationProgress.current = 0;
    
    startPosition.current.copy(camera.position);
    startTarget.current.copy(controlsRef.current.target);
    targetCameraPos.current.copy(finalCameraPos);
    targetLookAt.current.set(0, 0, 0);
    
    if (useFlyover) {
      // Calculate midpoint for flyover (zoom out, then zoom in)
      const startDir = camera.position.clone().normalize();
      const endDir = cameraDirection;
      const midDir = startDir.clone().add(endDir).normalize();
      
      // Midpoint camera position - zoomed out
      midpointCameraPos.current.copy(midDir.multiplyScalar(FLYOVER_ZOOM_OUT_DISTANCE));
      animationPhase.current = 'flyover';
    } else {
      animationPhase.current = 'direct';
    }
  }, [focusLocation, camera, selectedId]);
  
  // Restore camera to saved position (triggered by ESC during search, etc.)
  const prevRestoreFlag = useRef(0);
  useEffect(() => {
    if (restoreCameraFlag > 0 && restoreCameraFlag !== prevRestoreFlag.current && controlsRef.current) {
      prevRestoreFlag.current = restoreCameraFlag;
      
      // Reset focus state
      prevFocusLocation.current = null;
      hasSavedForFocus.current = false;
      
      // Don't restore if we're tracking something
      if (selectedId || selectedAirportId) return;
      
      // Animate back to saved position
      if (savedCameraPosition.current.lengthSq() > 0) {
        isAnimating.current = true;
        isReturningToEarth.current = true;
        animationProgress.current = 0;
        
        startPosition.current.copy(camera.position);
        startTarget.current.copy(controlsRef.current.target);
        
        targetCameraPos.current.copy(savedCameraPosition.current);
        targetLookAt.current.copy(savedCameraTarget.current);
      }
    }
  }, [restoreCameraFlag, camera, selectedId, selectedAirportId]);
  
  // Handle airport selection - zoom to airport
  const prevSelectedAirportId = useRef<string | null>(null);
  useEffect(() => {
    if (selectedAirportId && selectedAirportId !== prevSelectedAirportId.current) {
      const airport = airports.find(a => a.icao === selectedAirportId);
      if (airport && controlsRef.current) {
        // Save camera state if not already tracking something
        if (!prevSelectedId.current && !prevSelectedAirportId.current) {
          savedCameraPosition.current.copy(camera.position);
          savedCameraTarget.current.copy(controlsRef.current.target);
        }
        
        isAnimating.current = true;
        isReturningToEarth.current = false;
        animationProgress.current = 0;
        
        startPosition.current.copy(camera.position);
        startTarget.current.copy(controlsRef.current.target);
        
        const targetPoint = latLonToVector3(airport.lat, airport.lon, 0);
        const cameraDirection = targetPoint.clone().normalize();
        
        // Zoom in close to the airport
        targetCameraPos.current.copy(cameraDirection.multiplyScalar(CAMERA.CITY_ZOOM_DISTANCE));
        targetLookAt.current.set(0, 0, 0);
      }
    }
    
    // Handle deselection - return to previous position
    if (!selectedAirportId && prevSelectedAirportId.current && !selectedId && controlsRef.current) {
      isAnimating.current = true;
      isReturningToEarth.current = true;
      animationProgress.current = 0;
      
      startPosition.current.copy(camera.position);
      startTarget.current.copy(controlsRef.current.target);
      
      if (savedCameraPosition.current.lengthSq() > 0) {
        targetCameraPos.current.copy(savedCameraPosition.current);
        targetLookAt.current.copy(savedCameraTarget.current);
      }
    }
    
    prevSelectedAirportId.current = selectedAirportId;
  }, [selectedAirportId, airports, camera, selectedId]);
  
  useEffect(() => {
    if (selectedId && selectedId !== prevSelectedId.current) {
      const selectedAircraft = aircraft.find(a => a.id === selectedId);
      if (selectedAircraft && controlsRef.current) {
        // Save the current camera state BEFORE animating to the aircraft
        // Only save if we weren't already tracking something (prevSelectedId is null)
        if (!prevSelectedId.current && !prevSelectedAirportId.current) {
          savedCameraPosition.current.copy(camera.position);
          savedCameraTarget.current.copy(controlsRef.current.target);
        }
        
        isAnimating.current = true;
        isReturningToEarth.current = false;
        animationProgress.current = 0;
        
        startPosition.current.copy(camera.position);
        startTarget.current.copy(controlsRef.current.target);
        
        const { latitude, longitude, altitude, heading, speed } = selectedAircraft.position;
        
        // Store server data for prediction
        lastServerData.current = {
          lat: latitude,
          lon: longitude,
          alt: altitude,
          heading,
          speed,
          time: Date.now(),
        };
        currentCameraOffset.current.set(0, 0, 0);
        
        // Focus view (like airports) - just zoom to the location, not a close follow view
        const targetPoint = latLonToVector3(latitude, longitude, 0);
        const cameraDirection = targetPoint.clone().normalize();
        
        // Zoom in to city-level distance, same as airports
        targetCameraPos.current.copy(cameraDirection.multiplyScalar(CAMERA.CITY_ZOOM_DISTANCE));
        targetLookAt.current.set(0, 0, 0);
      }
    }
    
    // Update server data when aircraft data updates
    if (selectedId) {
      const selectedAircraft = aircraft.find(a => a.id === selectedId);
      if (selectedAircraft) {
        const { latitude, longitude, altitude, heading, speed } = selectedAircraft.position;
        // Only update if position actually changed (new server data)
        if (lastServerData.current &&
            (lastServerData.current.lat !== latitude ||
             lastServerData.current.lon !== longitude)) {
          lastServerData.current = {
            lat: latitude,
            lon: longitude,
            alt: altitude,
            heading,
            speed,
            time: Date.now(),
          };
        }
      }
    }
    
    if (!selectedId && prevSelectedId.current && controlsRef.current) {
      // Deselected - animate back to the saved camera position
      isAnimating.current = true;
      isReturningToEarth.current = true;
      animationProgress.current = 0;

      // Clear chase view data and restore normal camera state
      lastServerData.current = null;
      currentCameraOffset.current.set(0, 0, 0);
      camera.up.set(0, 1, 0);
      controlsRef.current.enabled = true;
      
      startPosition.current.copy(camera.position);
      startTarget.current.copy(controlsRef.current.target);
      
      // Return to the saved camera position
      if (savedCameraPosition.current.lengthSq() > 0) {
        targetCameraPos.current.copy(savedCameraPosition.current);
        targetLookAt.current.copy(savedCameraTarget.current);
      } else {
        const currentDir = camera.position.clone().normalize();
        targetCameraPos.current.copy(currentDir.multiplyScalar(CAMERA.CITY_ZOOM_DISTANCE));
        targetLookAt.current.set(0, 0, 0);
      }
    }
    
    prevSelectedId.current = selectedId;
  }, [selectedId, aircraft, camera]);

  // Handle view mode changes for selected aircraft
  useEffect(() => {
    if (viewMode === prevViewMode.current) return;
    prevViewMode.current = viewMode;

    if (!selectedId || !controlsRef.current) return;

    if (viewMode === 'focus') {
      // Returning to focus view — animate camera back to overhead position
      camera.up.set(0, 1, 0);
      controlsRef.current.enabled = true;

      const ac = aircraft.find(a => a.id === selectedId);
      if (ac) {
        isAnimating.current = true;
        animationProgress.current = 0;
        animationPhase.current = 'direct';

        startPosition.current.copy(camera.position);
        startTarget.current.copy(currentTarget.current);

        const targetPoint = latLonToVector3(ac.position.latitude, ac.position.longitude, 0);
        const cameraDirection = targetPoint.clone().normalize();
        targetCameraPos.current.copy(cameraDirection.multiplyScalar(CAMERA.CITY_ZOOM_DISTANCE));
        targetLookAt.current.set(0, 0, 0);
      }
    }
  }, [viewMode, selectedId, aircraft, camera]);

  useFrame((state, delta) => {
    if (!controlsRef.current) return;
    
    // Determine if in view-mode tracking (chase, cockpit, orbit, top)
    const currentViewMode = selectedId ? useRadarStore.getState().gameState.viewMode : 'focus';
    const isTrackingView = selectedId && currentViewMode !== 'focus' && !isAnimating.current && lastServerData.current !== null;

    if (isAnimating.current) {
      if (animationPhase.current === 'direct') {
        // Direct animation (no flyover)
        animationProgress.current += delta * INPUT.ANIMATION.CAMERA_DIRECT_SPEED;
        const t = Math.min(animationProgress.current, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        
        camera.position.lerpVectors(startPosition.current, targetCameraPos.current, eased);
        currentTarget.current.lerpVectors(startTarget.current, targetLookAt.current, eased);
        controlsRef.current.target.copy(currentTarget.current);
        
        if (t >= 1) {
          isAnimating.current = false;
          isReturningToEarth.current = false;
        }
      } else if (animationPhase.current === 'flyover') {
        // Seamless flyover: single animation through start → midpoint → target
        animationProgress.current += delta * INPUT.ANIMATION.CAMERA_FLYOVER_SPEED;
        const t = Math.min(animationProgress.current, 1);
        
        // Use smooth step for seamless acceleration/deceleration
        // t < 0.5: accelerate out (fast start, slow at midpoint)
        // t > 0.5: accelerate in (slow at midpoint, fast end)
        let eased: number;
        if (t < 0.5) {
          // First half: ease-out (fast to slow)
          const t2 = t * 2; // 0 to 1 for first half
          eased = (1 - Math.pow(1 - t2, 2)) * 0.5; // 0 to 0.5
        } else {
          // Second half: ease-in (slow to fast)
          const t2 = (t - 0.5) * 2; // 0 to 1 for second half
          eased = 0.5 + (t2 * t2) * 0.5; // 0.5 to 1
        }
        
        // Quadratic bezier through start, midpoint, target
        const oneMinusT = 1 - eased;
        const p0 = startPosition.current.clone().multiplyScalar(oneMinusT * oneMinusT);
        const p1 = midpointCameraPos.current.clone().multiplyScalar(2 * oneMinusT * eased);
        const p2 = targetCameraPos.current.clone().multiplyScalar(eased * eased);
        camera.position.copy(p0.add(p1).add(p2));
        
        currentTarget.current.set(0, 0, 0);
        controlsRef.current.target.copy(currentTarget.current);
        
        if (t >= 1) {
          isAnimating.current = false;
          isReturningToEarth.current = false;
          animationPhase.current = 'direct';
        }
      }
    } else if (isTrackingView) {
      // View mode tracking — continuously follow selected aircraft
      controlsRef.current.enabled = false;

      const data = lastServerData.current!;
      const elapsed = (Date.now() - data.time) / 1000;
      const predicted = predictPosition(data.lat, data.lon, data.heading, data.speed, Math.min(elapsed, 120));
      const { pos, up, forward, right } = getLocalFrame(predicted.lat, predicted.lon, data.heading);

      let desiredCamPos: THREE.Vector3;
      let desiredLookAt: THREE.Vector3;

      switch (currentViewMode) {
        case 'chase':
          desiredCamPos = pos.clone()
            .addScaledVector(up, CAMERA.VIEW_CHASE_HEIGHT)
            .addScaledVector(forward, -CAMERA.VIEW_CHASE_DISTANCE);
          desiredLookAt = pos;
          break;
        case 'cockpit':
          desiredCamPos = pos.clone()
            .addScaledVector(up, CAMERA.VIEW_COCKPIT_HEIGHT);
          desiredLookAt = pos.clone()
            .addScaledVector(forward, CAMERA.VIEW_COCKPIT_LOOK_AHEAD)
            .addScaledVector(up, CAMERA.VIEW_COCKPIT_HEIGHT * 0.5);
          break;
        case 'orbit': {
          const angle = state.clock.elapsedTime * CAMERA.VIEW_ORBIT_SPEED;
          desiredCamPos = pos.clone()
            .addScaledVector(up, CAMERA.VIEW_ORBIT_HEIGHT)
            .addScaledVector(right, Math.cos(angle) * CAMERA.VIEW_ORBIT_DISTANCE)
            .addScaledVector(forward, Math.sin(angle) * CAMERA.VIEW_ORBIT_DISTANCE);
          desiredLookAt = pos;
          break;
        }
        case 'top':
        default:
          desiredCamPos = pos.clone()
            .addScaledVector(up, CAMERA.VIEW_TOP_HEIGHT);
          desiredLookAt = pos;
      }

      const lerpFactor = Math.min(1, CAMERA.VIEW_LERP_SPEED * delta);
      camera.position.lerp(desiredCamPos, lerpFactor);
      currentTarget.current.lerp(desiredLookAt, lerpFactor);
      camera.up.copy(up);
      camera.lookAt(currentTarget.current);
    } else {
      // Normal view - enable standard controls
      controlsRef.current.enabled = true;
      controlsRef.current.enableRotate = true;
      controlsRef.current.enableDamping = true;
    }

    // Skip input handling and controls update during view-mode tracking
    if (isTrackingView) return;

    // Adjust rotation sensitivity based on zoom level
    const cameraDistance = camera.position.length();
    const zoomBasedRotateSpeed = Math.max(CAMERA.ROTATE_SPEED_MIN, Math.min(CAMERA.ROTATE_SPEED_MAX, (cameraDistance - 1) * INPUT.KEYBOARD.ROTATE_ZOOM_SCALE));
    controlsRef.current.rotateSpeed = zoomBasedRotateSpeed;
    
    // Get input state from centralized input manager
    const inputState = getInputState();
    
    // Shift+Up/Down for keyboard zoom
    if (inputState.zoomIn || inputState.zoomOut) {
      const zoomSpeed = CAMERA.ZOOM_SPEED_KEYBOARD * delta;
      const currentDist = camera.position.length();
      
      if (inputState.zoomIn && currentDist > CAMERA.MIN_DISTANCE) {
        // Zoom in: move closer
        const newDist = Math.max(CAMERA.MIN_DISTANCE, currentDist - zoomSpeed);
        camera.position.normalize().multiplyScalar(newDist);
      } else if (inputState.zoomOut && currentDist < CAMERA.MAX_DISTANCE) {
        // Zoom out: move farther
        const newDist = Math.min(CAMERA.MAX_DISTANCE, currentDist + zoomSpeed);
        camera.position.normalize().multiplyScalar(newDist);
      }
    }
    
    // Q/E for camera yaw - adjust viewing angle relative to earth
    // Q = flatter view (look along earth's surface, towards horizon)
    // E = steeper view (look more towards earth's center, top-down)
    if ((inputState.yawFlatten || inputState.yawSteepen) && !selectedEntity && controlsRef.current) {
      const yawSpeed = 0.4 * delta; // How fast to adjust the view angle
      
      // Get the point on the globe directly below the camera (nadir)
      const cameraPosNorm = camera.position.clone().normalize();
      
      // Current target position
      const currentTarget = controlsRef.current.target.clone();
      
      // Calculate how far the target is from center (0 = center, 1 = on globe surface)
      const targetDistance = currentTarget.length();
      
      if (inputState.yawFlatten) {
        // Q: Move target towards the globe surface in camera's view direction
        // This creates a flatter, more horizon-like view
        const maxTargetDist = 0.85; // Max distance from center (closer to surface = flatter view)
        const newDist = Math.min(maxTargetDist, targetDistance + yawSpeed);
        
        // Target should be on the globe surface in front of camera
        const targetOnSurface = cameraPosNorm.clone().multiplyScalar(newDist);
        controlsRef.current.target.lerp(targetOnSurface, 0.15);
      } else if (inputState.yawSteepen) {
        // E: Move target back towards center (0,0,0)
        // This creates a more top-down view
        const newDist = Math.max(0, targetDistance - yawSpeed);
        
        if (newDist < 0.01) {
          controlsRef.current.target.set(0, 0, 0);
        } else {
          const targetOnSurface = cameraPosNorm.clone().multiplyScalar(newDist);
          controlsRef.current.target.lerp(targetOnSurface, 0.15);
        }
      }
    }
    
    // Arrow/WASD keys for freecam movement (only when not in snap mode)
    const anyMovementHeld = inputState.moveUp || inputState.moveDown || inputState.moveLeft || inputState.moveRight;
    
    if (!inputState.shiftHeld && anyMovementHeld && !snapMode) {
      const panSpeed = CAMERA.PAN_SPEED * delta;
      
      // Get camera's right and up vectors for screen-space movement
      const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      
      // Calculate movement direction
      const movement = new THREE.Vector3();
      if (inputState.moveRight) movement.add(cameraRight.clone().multiplyScalar(panSpeed));
      if (inputState.moveLeft) movement.add(cameraRight.clone().multiplyScalar(-panSpeed));
      if (inputState.moveUp) movement.add(cameraUp.clone().multiplyScalar(panSpeed));
      if (inputState.moveDown) movement.add(cameraUp.clone().multiplyScalar(-panSpeed));
      
      // Apply movement to camera position
      camera.position.add(movement);
      
      // Keep camera at consistent distance from globe center
      const targetDist = cameraDistance;
      camera.position.normalize().multiplyScalar(targetDist);
      
      // Update controls target to stay centered on globe
      controlsRef.current.target.set(0, 0, 0);
    }
    
    controlsRef.current.update();
  });
  
  const handleControlsChange = () => {
    if (selectedId && !isAnimating.current) {
      const selectedAircraft = aircraft.find(a => a.id === selectedId);
      if (selectedAircraft) {
        const aircraftPos = latLonToVector3(
          selectedAircraft.position.latitude,
          selectedAircraft.position.longitude,
          selectedAircraft.position.altitude
        );
        currentCameraOffset.current.copy(camera.position).sub(aircraftPos);
      }
    }
  };
  
  return (
    <OrbitControls
      ref={controlsRef}
      enablePan={true}
      panSpeed={INPUT.MOUSE.PAN_SPEED}
      minDistance={CAMERA.MIN_DISTANCE}
      maxDistance={CAMERA.MAX_DISTANCE}
      rotateSpeed={INPUT.MOUSE.ROTATE_SPEED}
      zoomSpeed={CAMERA.ZOOM_SPEED_TRACKPAD}
      dampingFactor={INPUT.MOUSE.DAMPING_FACTOR}
      enableDamping
      onChange={handleControlsChange}
      // Mouse: left-drag = rotate, right-drag = pan, scroll = zoom
      mouseButtons={{
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      }}
      // Touch: 1-finger = rotate, 2-finger = pinch zoom + pan
      touches={{
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN,
      }}
    />
  );
}
