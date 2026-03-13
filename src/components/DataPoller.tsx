'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useRadarStore, ViewportBounds, Aircraft } from '@/store/gameStore';
import { POLLING } from '@/config/constants';

// ============================================================================
// HELPERS
// ============================================================================

function normalizeLon(lon: number): number {
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return lon;
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
  const locationReady = useRadarStore((state) => state.locationReady);
  const aircraftEnabled = useRadarStore((state) => state.layers.aircraft?.enabled);

  const hasInitialized = useRef(false);
  const fetchController = useRef<AbortController | null>(null);
  const consecutiveErrors = useRef(0);

  // Track visible aircraft IDs to avoid unnecessary setAircraft calls
  const lastVisibleIdsRef = useRef<Set<string>>(new Set());

  // Spatial aircraft cache - persists across viewport changes
  const aircraftCache = useRef<Map<string, { aircraft: Aircraft; fetchedAt: number }>>(new Map());

  // The padded region we last successfully fetched
  const loadedRegion = useRef<LoadedRegion | null>(null);

  // Get visible aircraft from cache for given viewport bounds
  const getVisibleFromCache = useCallback((bounds: ViewportBounds): Aircraft[] => {
    const visible: Aircraft[] = [];
    const margin = 5;

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

    return visible;
  }, []);

  // Update store with visible aircraft from cache (skips if set unchanged)
  const updateDisplay = useCallback((bounds: ViewportBounds) => {
    const visible = getVisibleFromCache(bounds);
    if (visible.length === 0) return;

    // Skip setAircraft if the visible set is identical (prevents unnecessary re-renders)
    const prev = lastVisibleIdsRef.current;
    if (visible.length === prev.size && visible.every(a => prev.has(a.id))) {
      return;
    }

    lastVisibleIdsRef.current = new Set(visible.map(a => a.id));
    setAircraft(visible);
  }, [getVisibleFromCache, setAircraft]);

  // Main fetch function with lazy loading logic
  const fetchData = useCallback(async (bounds: ViewportBounds, force: boolean = false) => {
    if (!isPolling || !bounds || !aircraftEnabled) return;

    // Don't fetch when zoomed too far out
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
        throw new Error(`API error: ${res.status}`);
      }

      const data = await res.json();
      consecutiveErrors.current = 0;

      const now = Date.now();
      const aircraftList: Aircraft[] = data.aircraft || [];
      console.log('[DataPoller] Received', aircraftList.length, 'aircraft');

      // Merge into cache — API returns clean Aircraft objects directly
      for (const ac of aircraftList) {
        aircraftCache.current.set(ac.id, { aircraft: ac, fetchedAt: now });
      }

      // Update loaded region
      loadedRegion.current = {
        minLat: padded.minLat,
        maxLat: padded.maxLat,
        minLon: padded.minLon,
        maxLon: padded.maxLon,
        fetchedAt: now,
      };

      updateDisplay(bounds);
    } catch (e: unknown) {
      const error = e as Error;
      if (error.name === 'AbortError') return;

      console.warn('[DataPoller] API failed:', error.message);
      consecutiveErrors.current++;
      // Fall back to cached data if available
      if (aircraftCache.current.size > 0) {
        updateDisplay(bounds);
      }
    }
  }, [isPolling, aircraftEnabled, updateDisplay]);

  // Reset init flag when aircraft layer is toggled off
  useEffect(() => {
    if (!aircraftEnabled) {
      hasInitialized.current = false;
    }
  }, [aircraftEnabled]);

  // Initial fetch - when location and viewport are ready
  useEffect(() => {
    if (!hasInitialized.current && locationReady && aircraftEnabled) {
      const bounds = useRadarStore.getState().viewportBounds;
      if (bounds) {
        hasInitialized.current = true;
        fetchData(bounds, true);
      }
    }
  }, [fetchData, locationReady, aircraftEnabled]);

  // Handle viewport changes via store subscription (avoids React re-renders)
  useEffect(() => {
    if (!isPolling || !locationReady || !aircraftEnabled) return;

    let timeout: ReturnType<typeof setTimeout>;
    let prevBounds = useRadarStore.getState().viewportBounds;

    const unsubscribe = useRadarStore.subscribe((state) => {
      const bounds = state.viewportBounds;
      if (bounds === prevBounds) return;
      prevBounds = bounds;
      if (!bounds) return;

      // Initial fetch if not yet initialized
      if (!hasInitialized.current) {
        hasInitialized.current = true;
        fetchData(bounds, true);
        return;
      }

      clearTimeout(timeout);
      timeout = setTimeout(() => fetchData(bounds), POLLING.DEBOUNCE_VIEWPORT_CHANGE);
    });

    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, [isPolling, locationReady, aircraftEnabled, fetchData]);

  // Regular polling - force refresh current viewport data
  useEffect(() => {
    if (!isPolling || !locationReady || !aircraftEnabled) return;

    const baseInterval = POLLING.BASE_INTERVAL;
    const backoffMultiplier = Math.min(
      Math.pow(2, consecutiveErrors.current),
      POLLING.MAX_BACKOFF_MULTIPLIER
    );
    const interval = baseInterval * backoffMultiplier;

    console.log(`[DataPoller] Polling every ${interval / 1000}s (errors: ${consecutiveErrors.current})`);

    const timer = setInterval(() => {
      const bounds = useRadarStore.getState().viewportBounds;
      if (bounds) fetchData(bounds, true);
    }, interval);
    return () => clearInterval(timer);
  }, [isPolling, fetchData, locationReady, aircraftEnabled]);

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
