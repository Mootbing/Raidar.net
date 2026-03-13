'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useRadarStore, ViewportBounds } from '@/store/gameStore';
import { LayerId } from '@/types/layers';
import { POLLING } from '@/config/constants';
import { SpatialCache } from '@/lib/spatialCache';
import { getDataSource, createCacheForSource, DataSource } from '@/lib/dataSourceRegistry';

// ============================================================================
// useLayerData
//
// Drop-in hook for any layer.  Give it a layerId that has been registered
// in dataSourceRegistry.ts and it handles everything:
//   - Viewport-based fetching (entities appear as you pan to them)
//   - Spatial caching with prefetch padding
//   - Coverage checks (skip refetch when viewport is already loaded)
//   - Polling with exponential backoff
//   - Cache cleanup of stale far-away entities
//   - Layer enabled/disabled gating
//
// Returns the array of entities currently visible in the viewport.
//
// Usage inside a layer component:
//
//   export function MaritimeLayer() {
//     const ships = useLayerData<Ship>('maritime');
//     // ships only contains entities within the current viewport
//     ...
//   }
// ============================================================================

export function useLayerData<T extends { id: string }>(layerId: LayerId): T[] {
  const source = getDataSource(layerId) as DataSource<T> | undefined;
  const layerState = useRadarStore((s) => s.layers[layerId]);
  const setLayerState = useRadarStore((s) => s.setLayerState);
  const locationReady = useRadarStore((s) => s.locationReady);

  // Force re-render when fetch completes, even if entityCount stays the same
  const [, setLastFetchTime] = useState(0);

  // Persistent spatial cache (survives re-renders)
  const cacheRef = useRef<SpatialCache<T> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const errorsRef = useRef(0);
  const initRef = useRef(false);
  // Store visible entities so we can return them synchronously
  const visibleRef = useRef<T[]>([]);

  // Lazily create the cache on first use
  if (!cacheRef.current && source) {
    cacheRef.current = createCacheForSource(source) as SpatialCache<T>;
  }

  const pollInterval = source?.pollInterval ?? POLLING.BASE_INTERVAL;
  const maxFetchZoom = source?.maxFetchZoom ?? POLLING.MAX_FETCH_ZOOM;
  const isGlobal = source?.global ?? false;

  // Global layers store all entities directly (no viewport filtering)
  const globalEntitiesRef = useRef<T[]>([]);

  // ----- core fetch ----------------------------------------------------------
  const doFetch = useCallback(
    async (bounds: ViewportBounds | null, force: boolean = false) => {
      if (!source || !cacheRef.current) return;
      if (!layerState?.enabled) return;

      // Non-global layers need valid bounds
      if (!isGlobal) {
        if (!bounds) return;
        if (bounds.zoomLevel > maxFetchZoom) {
          visibleRef.current = cacheRef.current.getVisible(bounds);
          setLayerState(layerId, { entityCount: visibleRef.current.length });
          return;
        }
        if (!force && cacheRef.current.isRegionFresh(bounds)) {
          visibleRef.current = cacheRef.current.getVisible(bounds);
          setLayerState(layerId, { entityCount: visibleRef.current.length });
          return;
        }
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLayerState(layerId, { loading: true, error: null });

      // Global layers don't need bounds for URL or cache
      const fetchBounds = isGlobal
        ? { minLat: -90, maxLat: 90, minLon: -180, maxLon: 180, centerLat: 0, centerLon: 0, zoomLevel: 0 }
        : cacheRef.current.padBounds(bounds!);
      const url = source.buildUrl(fetchBounds);

      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || `API ${res.status}`);
        }
        const json = await res.json();
        const entities = source.parseResponse(json);

        errorsRef.current = 0;

        if (isGlobal) {
          // Global layers: store all entities directly, skip spatial filtering
          globalEntitiesRef.current = entities;
          visibleRef.current = entities;
        } else {
          cacheRef.current.merge(entities, fetchBounds);
          visibleRef.current = cacheRef.current.getVisible(bounds!);
        }

        setLayerState(layerId, {
          loading: false,
          loaded: true,
          entityCount: visibleRef.current.length,
        });
        setLastFetchTime(Date.now());
      } catch (e: unknown) {
        if ((e as Error).name === 'AbortError') return;
        errorsRef.current++;

        if (isGlobal) {
          visibleRef.current = globalEntitiesRef.current;
        } else if (bounds) {
          visibleRef.current = cacheRef.current.getVisible(bounds);
        }

        setLayerState(layerId, {
          loading: false,
          error: (e as Error).message || 'Unknown error',
          entityCount: visibleRef.current.length,
        });
      }
    },
    [source, layerState?.enabled, isGlobal, maxFetchZoom, layerId, setLayerState]
  );

  // ----- initial fetch -------------------------------------------------------
  useEffect(() => {
    if (initRef.current) return;
    if (!layerState?.enabled || !locationReady || !source) return;
    const bounds = useRadarStore.getState().viewportBounds;
    if (!isGlobal && !bounds) return;

    initRef.current = true;
    doFetch(bounds, true);
  }, [layerState?.enabled, locationReady, isGlobal, source, doFetch]);

  // ----- viewport change via store subscription (avoids React re-renders) ----
  useEffect(() => {
    if (!layerState?.enabled || !locationReady || isGlobal) return;

    let timeout: ReturnType<typeof setTimeout>;
    let prevBounds = useRadarStore.getState().viewportBounds;

    const unsubscribe = useRadarStore.subscribe((state) => {
      const bounds = state.viewportBounds;
      if (bounds === prevBounds) return;
      prevBounds = bounds;
      if (!bounds) return;

      // Handle initial fetch if not yet initialized
      if (!initRef.current) {
        initRef.current = true;
        doFetch(bounds, true);
        return;
      }

      clearTimeout(timeout);
      timeout = setTimeout(() => doFetch(bounds), POLLING.DEBOUNCE_VIEWPORT_CHANGE);
    });

    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, [layerState?.enabled, locationReady, isGlobal, doFetch]);

  // ----- polling -------------------------------------------------------------
  useEffect(() => {
    if (!layerState?.enabled || !locationReady || pollInterval <= 0) return;
    if (!isGlobal && !useRadarStore.getState().viewportBounds) return;

    const backoff = Math.min(Math.pow(2, errorsRef.current), POLLING.MAX_BACKOFF_MULTIPLIER);
    const interval = pollInterval * backoff;

    const timer = setInterval(() => {
      const bounds = useRadarStore.getState().viewportBounds;
      if (bounds) doFetch(bounds, true);
    }, interval);

    return () => clearInterval(timer);
  }, [layerState?.enabled, locationReady, pollInterval, isGlobal, doFetch]);

  // ----- cache cleanup -------------------------------------------------------
  useEffect(() => {
    if (!cacheRef.current || isGlobal) return;

    const timer = setInterval(() => {
      const bounds = useRadarStore.getState().viewportBounds;
      if (!bounds || !cacheRef.current) return;
      const removed = cacheRef.current.cleanup(bounds);
      if (removed > 0) {
        console.log(`[${layerId}] Cache cleanup: removed ${removed} stale entries`);
      }
    }, POLLING.CACHE_CLEANUP_INTERVAL);

    return () => clearInterval(timer);
  }, [layerId, isGlobal]);

  // ----- cleanup on unmount --------------------------------------------------
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Reset init flag when layer is toggled off then on
  useEffect(() => {
    if (!layerState?.enabled) {
      initRef.current = false;
    }
  }, [layerState?.enabled]);

  if (!layerState?.enabled) return [];
  return visibleRef.current;
}
