'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useRadarStore, ViewportBounds, Aircraft } from '@/store/gameStore';
import { POLLING } from '@/config/constants';

// ============================================================================
// MOCK / DEBUG DATA
// ============================================================================

function generateMockData(bounds: ViewportBounds | null, count: number = 50) {
  const countries = ['United States', 'China', 'Germany', 'United Kingdom', 'France', 'Japan', 'Australia', 'Canada', 'Brazil', 'India'];
  const aircraft = [];

  const latMin = bounds?.minLat ?? -70;
  const latMax = bounds?.maxLat ?? 70;
  const lonMin = bounds?.minLon ?? -180;
  const lonMax = bounds?.maxLon ?? 180;

  for (let i = 0; i < count; i++) {
    const verticalRate = (Math.random() - 0.5) * 2000;
    aircraft.push({
      id: `mock_${i}_${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`,
      callsign: `${['UAL', 'DAL', 'AAL', 'SWA', 'JBU', 'ASA', 'BAW', 'AFR', 'DLH', 'CCA'][Math.floor(Math.random() * 10)]}${Math.floor(Math.random() * 9999)}`,
      type: ['B737', 'A320', 'B777', 'A350', 'B380', 'E190'][Math.floor(Math.random() * 6)],
      position: {
        latitude: latMin + Math.random() * (latMax - latMin),
        longitude: lonMin + Math.random() * (lonMax - lonMin),
        altitude: 25000 + Math.random() * 20000,
        heading: Math.random() * 360,
        speed: 400 + Math.random() * 200,
        verticalRate: verticalRate,
        geoAltitude: 25000 + Math.random() * 20000,
      },
      timestamp: Date.now(),
      originCountry: countries[Math.floor(Math.random() * countries.length)],
      onGround: false,
      squawk: Math.floor(Math.random() * 7777).toString().padStart(4, '0'),
      positionSource: 0,
      lastContact: Date.now() / 1000,
    });
  }
  return aircraft;
}

function createSupersonicDebugAircraft() {
  return {
    id: 'debug_supersonic_sr71',
    callsign: 'SR71DBG',
    type: 'SR-71',
    position: {
      latitude: 40.7128,
      longitude: -74.006,
      altitude: 85000,
      heading: 45,
      speed: 1900,
      verticalRate: 0,
      geoAltitude: 85000,
    },
    timestamp: Date.now(),
    originCountry: 'United States',
    onGround: false,
    squawk: '7777',
    positionSource: 0,
    lastContact: Date.now() / 1000,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function normalizeLon(lon: number): number {
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return lon;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseStateVector(s: any[]): Aircraft | null {
  if (s[5] == null || s[6] == null) return null;

  return {
    id: s[0],
    callsign: (s[1] || '').trim() || 'N/A',
    type: 'UNKNOWN',
    position: {
      longitude: s[5],
      latitude: s[6],
      altitude: (s[7] || 0) * 3.28084,
      heading: s[10] || 0,
      speed: (s[9] || 0) * 1.94384,
      verticalRate: (s[11] || 0) * 196.850,
      geoAltitude: (s[13] || 0) * 3.28084,
    },
    timestamp: Date.now(),
    originCountry: s[2] || 'Unknown',
    onGround: s[8] || false,
    squawk: s[14] || null,
    spi: s[15] || false,
    positionSource: s[16] || 0,
    lastContact: s[4] || null,
  };
}

// ============================================================================
// VIEWPORT-BASED LAZY LOADING HELPERS
// ============================================================================

interface LoadedRegion {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  fetchedAt: number;
}

// Check if loaded region covers enough of the current viewport
function isViewportCovered(
  viewport: ViewportBounds,
  region: LoadedRegion,
  threshold: number
): boolean {
  const vArea = (viewport.maxLat - viewport.minLat) * (viewport.maxLon - viewport.minLon);
  if (vArea <= 0) return true;

  const oMinLat = Math.max(viewport.minLat, region.minLat);
  const oMaxLat = Math.min(viewport.maxLat, region.maxLat);
  const oMinLon = Math.max(viewport.minLon, region.minLon);
  const oMaxLon = Math.min(viewport.maxLon, region.maxLon);

  if (oMinLat >= oMaxLat || oMinLon >= oMaxLon) return false;

  const oArea = (oMaxLat - oMinLat) * (oMaxLon - oMinLon);
  return (oArea / vArea) >= threshold;
}

// Add padding around bounds for prefetching nearby areas
function padBounds(bounds: ViewportBounds, factor: number): ViewportBounds {
  const latSpan = bounds.maxLat - bounds.minLat;
  const lonSpan = bounds.maxLon - bounds.minLon;
  const latPad = latSpan * (factor - 1) / 2;
  const lonPad = lonSpan * (factor - 1) / 2;

  return {
    ...bounds,
    minLat: Math.max(-90, bounds.minLat - latPad),
    maxLat: Math.min(90, bounds.maxLat + latPad),
    minLon: bounds.minLon - lonPad,
    maxLon: bounds.maxLon + lonPad,
  };
}

// Check if a position falls within bounds (with optional margin)
function isInBounds(lat: number, lon: number, bounds: ViewportBounds, margin: number = 0): boolean {
  return (
    lat >= bounds.minLat - margin &&
    lat <= bounds.maxLat + margin &&
    lon >= bounds.minLon - margin &&
    lon <= bounds.maxLon + margin
  );
}

// ============================================================================
// DATA POLLER - VIEWPORT-BASED LAZY LOADING
// ============================================================================

export function DataPoller() {
  const isPolling = useRadarStore((state) => state.isPolling);
  const setAircraft = useRadarStore((state) => state.setAircraft);
  const viewportBounds = useRadarStore((state) => state.viewportBounds);
  const locationReady = useRadarStore((state) => state.locationReady);

  const hasInitialized = useRef(false);
  const fetchController = useRef<AbortController | null>(null);
  const consecutiveErrors = useRef(0);

  // Spatial aircraft cache - persists across viewport changes
  const aircraftCache = useRef<Map<string, { aircraft: Aircraft; fetchedAt: number }>>(new Map());

  // The padded region we last successfully fetched
  const loadedRegion = useRef<LoadedRegion | null>(null);

  // Get visible aircraft from cache for given viewport bounds
  const getVisibleFromCache = useCallback((bounds: ViewportBounds): Aircraft[] => {
    const visible: Aircraft[] = [];
    const margin = 5; // Degrees - generous margin for rendering edge-fading

    aircraftCache.current.forEach(({ aircraft }) => {
      if (isInBounds(aircraft.position.latitude, aircraft.position.longitude, bounds, margin)) {
        visible.push(aircraft);
      }
    });

    // Always keep selected aircraft even if out of viewport
    const selectedEntity = useRadarStore.getState().gameState.selectedEntity;
    const selectedId = selectedEntity?.type === 'aircraft' ? selectedEntity.id : null;
    if (selectedId) {
      const cached = aircraftCache.current.get(selectedId);
      if (cached && !visible.find(a => a.id === selectedId)) {
        visible.push(cached.aircraft);
      }
    }

    // Always add debug aircraft
    const debugAircraft = createSupersonicDebugAircraft();
    if (!visible.find(a => a.id === debugAircraft.id)) {
      visible.push(debugAircraft);
    }

    return visible;
  }, []);

  // Update store with visible aircraft from cache
  const updateDisplay = useCallback((bounds: ViewportBounds) => {
    const visible = getVisibleFromCache(bounds);
    if (visible.length > 0) {
      setAircraft(visible);
    }
  }, [getVisibleFromCache, setAircraft]);

  // Main fetch function with lazy loading logic
  const fetchData = useCallback(async (bounds: ViewportBounds, force: boolean = false) => {
    if (!isPolling || !bounds) return;

    // Don't fetch when zoomed too far out (would return excessive data)
    if (bounds.zoomLevel > POLLING.MAX_FETCH_ZOOM) {
      console.log('[DataPoller] Zoomed too far out, showing cached data');
      if (aircraftCache.current.size > 0) {
        updateDisplay(bounds);
      }
      return;
    }

    // Check if viewport is still covered by the loaded region
    if (!force && loadedRegion.current) {
      const age = Date.now() - loadedRegion.current.fetchedAt;
      if (age < POLLING.AIRCRAFT_CACHE_TTL &&
          isViewportCovered(bounds, loadedRegion.current, POLLING.COVERAGE_THRESHOLD)) {
        // Region is fresh and covers viewport - just refresh display from cache
        updateDisplay(bounds);
        return;
      }
    }

    // Cancel any in-flight request
    if (fetchController.current) {
      fetchController.current.abort();
    }
    fetchController.current = new AbortController();

    // Pad bounds for prefetching nearby areas
    const padded = padBounds(bounds, POLLING.VIEWPORT_PADDING_FACTOR);

    try {
      const lamin = Math.max(-90, padded.minLat);
      const lamax = Math.min(90, padded.maxLat);
      const lomin = normalizeLon(padded.minLon);
      const lomax = normalizeLon(padded.maxLon);

      const url = `/api/aircraft?lamin=${lamin.toFixed(2)}&lamax=${lamax.toFixed(2)}&lomin=${lomin.toFixed(2)}&lomax=${lomax.toFixed(2)}`;

      console.log('[DataPoller] Fetching padded viewport...');

      const res = await fetch(url, {
        signal: fetchController.current.signal,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        if (res.status === 429) {
          const retryAfter = errorData.retryAfter || 10;
          console.warn(`[DataPoller] Rate limited. Retry in ${retryAfter}s`);
          consecutiveErrors.current++;
          throw new Error(`Rate limited - retry in ${retryAfter}s`);
        }
        throw new Error(errorData.message || `API error: ${res.status}`);
      }

      const data = await res.json();
      consecutiveErrors.current = 0;

      const now = Date.now();
      console.log('[DataPoller] Received', data.states?.length || 0, 'aircraft');

      if (data.states && data.states.length > 0) {
        // Merge new aircraft into cache (update existing, add new)
        for (const state of data.states) {
          const ac = parseStateVector(state);
          if (ac) {
            aircraftCache.current.set(ac.id, { aircraft: ac, fetchedAt: now });
          }
        }

        // Update loaded region to the padded fetch area
        loadedRegion.current = {
          minLat: padded.minLat,
          maxLat: padded.maxLat,
          minLon: padded.minLon,
          maxLon: padded.maxLon,
          fetchedAt: now,
        };

        // Update store with visible aircraft from cache
        updateDisplay(bounds);
        return;
      }
      throw new Error('No data');
    } catch (e: unknown) {
      const error = e as Error;
      if (error.name === 'AbortError') return;

      console.warn('[DataPoller] API failed:', error.message);
      // Fall back to cache or mock data
      if (aircraftCache.current.size > 0) {
        updateDisplay(bounds);
      } else {
        const mockData = generateMockData(bounds);
        mockData.push(createSupersonicDebugAircraft());
        setAircraft(mockData);
      }
    }
  }, [isPolling, setAircraft, updateDisplay]);

  // Initial fetch - when location and viewport are ready
  useEffect(() => {
    if (!hasInitialized.current && locationReady && viewportBounds) {
      hasInitialized.current = true;
      fetchData(viewportBounds, true);
    }
  }, [fetchData, viewportBounds, locationReady]);

  // Handle viewport changes - debounced fetch/display check
  useEffect(() => {
    if (!viewportBounds || !isPolling || !locationReady) return;

    const timeout = setTimeout(() => {
      fetchData(viewportBounds);
    }, POLLING.DEBOUNCE_VIEWPORT_CHANGE);
    return () => clearTimeout(timeout);
  }, [viewportBounds, isPolling, fetchData, locationReady]);

  // Regular polling - force refresh current viewport data
  useEffect(() => {
    if (!isPolling || !locationReady || !viewportBounds) return;

    const baseInterval = POLLING.BASE_INTERVAL;
    const backoffMultiplier = Math.min(
      Math.pow(2, consecutiveErrors.current),
      POLLING.MAX_BACKOFF_MULTIPLIER
    );
    const interval = baseInterval * backoffMultiplier;

    console.log(`[DataPoller] Polling every ${interval / 1000}s (errors: ${consecutiveErrors.current})`);

    const timer = setInterval(() => fetchData(viewportBounds, true), interval);
    return () => clearInterval(timer);
  }, [isPolling, fetchData, viewportBounds, locationReady]);

  // Cache cleanup - periodically remove stale aircraft far from viewport
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const bounds = useRadarStore.getState().viewportBounds;
      if (!bounds) return;

      let removed = 0;
      aircraftCache.current.forEach(({ fetchedAt, aircraft }, id) => {
        if (now - fetchedAt > POLLING.AIRCRAFT_CACHE_TTL &&
            !isInBounds(aircraft.position.latitude, aircraft.position.longitude, bounds, 15)) {
          aircraftCache.current.delete(id);
          removed++;
        }
      });
      if (removed > 0) {
        console.log(`[DataPoller] Cache cleanup: removed ${removed} stale aircraft`);
      }
    }, POLLING.CACHE_CLEANUP_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  return null;
}
