import { ViewportBounds } from '@/store/gameStore';
import { POLLING } from '@/config/constants';

// ============================================================================
// SPATIAL CACHE
// Generic viewport-based spatial cache for any entity type.
// Extracts the caching logic from DataPoller so every layer can reuse it.
// ============================================================================

export interface CachedEntity<T> {
  entity: T;
  fetchedAt: number;
}

export interface LoadedRegion {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  fetchedAt: number;
}

export interface SpatialCacheConfig {
  /** How long entities stay in cache before becoming stale (ms) */
  cacheTTL: number;
  /** How far outside viewport (degrees) before stale entries are cleaned */
  cleanupMargin: number;
  /** Padding factor for prefetching (1.5 = fetch 50% extra around viewport) */
  paddingFactor: number;
  /** Re-fetch when coverage drops below this ratio (0-1) */
  coverageThreshold: number;
  /** How often to run cache cleanup (ms) */
  cleanupInterval: number;
}

const DEFAULT_CONFIG: SpatialCacheConfig = {
  cacheTTL: POLLING.AIRCRAFT_CACHE_TTL,
  cleanupMargin: 15,
  paddingFactor: POLLING.VIEWPORT_PADDING_FACTOR,
  coverageThreshold: POLLING.COVERAGE_THRESHOLD,
  cleanupInterval: POLLING.CACHE_CLEANUP_INTERVAL,
};

/**
 * Reusable spatial cache that stores entities by ID, tracks the loaded region,
 * and returns only entities visible in the current viewport.
 *
 * Usage:
 *   const cache = new SpatialCache<Ship>(getLatLon);
 *   cache.merge(newShips, paddedBounds);
 *   const visible = cache.getVisible(viewportBounds);
 */
export class SpatialCache<T extends { id: string }> {
  private entries = new Map<string, CachedEntity<T>>();
  private loadedRegion: LoadedRegion | null = null;
  private config: SpatialCacheConfig;
  private getLatLon: (entity: T) => { lat: number; lon: number };

  constructor(
    getLatLon: (entity: T) => { lat: number; lon: number },
    config?: Partial<SpatialCacheConfig>
  ) {
    this.getLatLon = getLatLon;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Merge freshly fetched entities into the cache and update the loaded region. */
  merge(entities: T[], fetchedBounds: ViewportBounds): void {
    const now = Date.now();
    for (const entity of entities) {
      this.entries.set(entity.id, { entity, fetchedAt: now });
    }
    this.loadedRegion = {
      minLat: fetchedBounds.minLat,
      maxLat: fetchedBounds.maxLat,
      minLon: fetchedBounds.minLon,
      maxLon: fetchedBounds.maxLon,
      fetchedAt: now,
    };
  }

  /** Get all entities visible in the given viewport (plus a small margin). */
  getVisible(bounds: ViewportBounds, margin: number = 5): T[] {
    const visible: T[] = [];
    this.entries.forEach(({ entity }) => {
      const { lat, lon } = this.getLatLon(entity);
      if (isInBounds(lat, lon, bounds, margin)) {
        visible.push(entity);
      }
    });
    return visible;
  }

  /** Check whether the loaded region still covers enough of the viewport. */
  isRegionFresh(viewport: ViewportBounds): boolean {
    if (!this.loadedRegion) return false;
    const age = Date.now() - this.loadedRegion.fetchedAt;
    if (age > this.config.cacheTTL) return false;
    return isViewportCovered(viewport, this.loadedRegion, this.config.coverageThreshold);
  }

  /** Pad bounds for prefetching. */
  padBounds(bounds: ViewportBounds): ViewportBounds {
    return padBounds(bounds, this.config.paddingFactor);
  }

  /** Remove stale entries far from the current viewport. */
  cleanup(currentBounds: ViewportBounds): number {
    const now = Date.now();
    let removed = 0;
    this.entries.forEach(({ fetchedAt, entity }, id) => {
      if (now - fetchedAt > this.config.cacheTTL) {
        const { lat, lon } = this.getLatLon(entity);
        if (!isInBounds(lat, lon, currentBounds, this.config.cleanupMargin)) {
          this.entries.delete(id);
          removed++;
        }
      }
    });
    return removed;
  }

  /** Keep a specific entity in cache regardless of cleanup rules. */
  pin(id: string): void {
    const entry = this.entries.get(id);
    if (entry) {
      entry.fetchedAt = Date.now();
    }
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.loadedRegion = null;
  }
}

// ============================================================================
// SHARED GEOMETRY HELPERS
// ============================================================================

export function normalizeLon(lon: number): number {
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return lon;
}

export function isInBounds(
  lat: number,
  lon: number,
  bounds: ViewportBounds,
  margin: number = 0
): boolean {
  return (
    lat >= bounds.minLat - margin &&
    lat <= bounds.maxLat + margin &&
    lon >= bounds.minLon - margin &&
    lon <= bounds.maxLon + margin
  );
}

export function isViewportCovered(
  viewport: ViewportBounds,
  region: LoadedRegion,
  threshold: number
): boolean {
  const vArea =
    (viewport.maxLat - viewport.minLat) * (viewport.maxLon - viewport.minLon);
  if (vArea <= 0) return true;

  const oMinLat = Math.max(viewport.minLat, region.minLat);
  const oMaxLat = Math.min(viewport.maxLat, region.maxLat);
  const oMinLon = Math.max(viewport.minLon, region.minLon);
  const oMaxLon = Math.min(viewport.maxLon, region.maxLon);

  if (oMinLat >= oMaxLat || oMinLon >= oMaxLon) return false;

  const oArea = (oMaxLat - oMinLat) * (oMaxLon - oMinLon);
  return oArea / vArea >= threshold;
}

export function padBounds(
  bounds: ViewportBounds,
  factor: number
): ViewportBounds {
  const latSpan = bounds.maxLat - bounds.minLat;
  const lonSpan = bounds.maxLon - bounds.minLon;
  const latPad = (latSpan * (factor - 1)) / 2;
  const lonPad = (lonSpan * (factor - 1)) / 2;

  return {
    ...bounds,
    minLat: Math.max(-90, bounds.minLat - latPad),
    maxLat: Math.min(90, bounds.maxLat + latPad),
    minLon: bounds.minLon - lonPad,
    maxLon: bounds.maxLon + lonPad,
  };
}

/**
 * Build a standard bounding-box query string.
 * Every API route uses the same param names so fetch logic stays generic.
 */
export function boundsToParams(bounds: ViewportBounds): string {
  const lamin = Math.max(-90, bounds.minLat).toFixed(2);
  const lamax = Math.min(90, bounds.maxLat).toFixed(2);
  const lomin = normalizeLon(bounds.minLon).toFixed(2);
  const lomax = normalizeLon(bounds.maxLon).toFixed(2);
  return `lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`;
}
