import { ViewportBounds } from '@/store/gameStore';
import { LayerId } from '@/types/layers';
import { SpatialCache, SpatialCacheConfig, boundsToParams } from './spatialCache';

// ============================================================================
// DATA SOURCE REGISTRY
// Agnostic fetch-by-coords system.  Each layer registers a DataSource that
// describes how to turn viewport bounds into entities.
// ============================================================================

/**
 * A data source describes how to fetch + parse entities for a single layer.
 * This is the ONLY thing you implement per layer — the DataManager handles
 * caching, polling, backoff, and viewport visibility automatically.
 */
export interface DataSource<T extends { id: string }> {
  layerId: LayerId;

  /** Build a full URL from padded viewport bounds. */
  buildUrl: (bounds: ViewportBounds) => string;

  /**
   * Parse the JSON response body into an array of entities.
   * Each entity MUST have an `id` field.
   */
  parseResponse: (json: any) => T[]; // eslint-disable-line @typescript-eslint/no-explicit-any

  /** Extract lat/lon from an entity (used by SpatialCache for visibility). */
  getLatLon: (entity: T) => { lat: number; lon: number };

  /** Polling interval in ms.  Default 15 000. */
  pollInterval?: number;

  /** Max zoom level at which to fetch (0=close, 1=far).  Default 0.85. */
  maxFetchZoom?: number;

  /** Override spatial cache settings per source. */
  cacheConfig?: Partial<SpatialCacheConfig>;

  /** If true, data is global (e.g. satellites) — fetch once, not per-viewport. */
  global?: boolean;
}

// ============================================================================
// REGISTRY
// ============================================================================

const registry = new Map<LayerId, DataSource<any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any

/** Register a data source for a layer. */
export function registerDataSource<T extends { id: string }>(source: DataSource<T>): void {
  registry.set(source.layerId, source);
}

/** Get the data source for a layer (if registered). */
export function getDataSource(layerId: LayerId): DataSource<any> | undefined { // eslint-disable-line @typescript-eslint/no-explicit-any
  return registry.get(layerId);
}

/** Get all registered data source layer IDs. */
export function getRegisteredLayers(): LayerId[] {
  return Array.from(registry.keys());
}

// ============================================================================
// BUILT-IN DATA SOURCES
// Register real data sources here as they are implemented.
// Each one is a ~10-line object — that's the entire cost of adding a layer.
// ============================================================================

/**
 * Aircraft — OpenSky Network
 * Already handled by DataPoller.tsx (viewport-based lazy loading from Postgres)
 * Registered here so the orchestrator docs can reference the pattern,
 * but DataPoller still owns the fetch loop for aircraft.
 */
registerDataSource({
  layerId: 'aircraft',
  buildUrl: (bounds) => `/api/aircraft?${boundsToParams(bounds)}`,
  parseResponse: (json) => json.aircraft ?? [],
  getLatLon: (a: any) => ({ lat: a.position.latitude, lon: a.position.longitude }), // eslint-disable-line @typescript-eslint/no-explicit-any
  pollInterval: 15_000,
});

/**
 * Maritime — AIS vessel data
 * API route: /api/maritime?lamin=..&lamax=..&lomin=..&lomax=..
 */
registerDataSource({
  layerId: 'maritime',
  buildUrl: (bounds) => `/api/maritime?${boundsToParams(bounds)}`,
  parseResponse: (json) => json.vessels ?? [],
  getLatLon: (v: any) => ({ lat: v.lat ?? v.position?.lat, lon: v.lon ?? v.position?.lon }), // eslint-disable-line @typescript-eslint/no-explicit-any
  pollInterval: 30_000,
  cacheConfig: { cacheTTL: 180_000 },
});

/**
 * Satellites — TLE / orbital data from CelesTrak
 * Global fetch (not viewport-scoped) — positions propagated client-side via SGP4.
 * TLE data only changes every few hours, so long poll interval.
 */
registerDataSource({
  layerId: 'satellites',
  buildUrl: () => `/api/satellites`,
  parseResponse: (json) => {
    const sats = json.satellites ?? [];
    return sats.map((s: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      id: s.id || s.noradId,
      name: s.name,
      noradId: s.noradId,
      tle1: s.tle1,
      tle2: s.tle2,
      group: s.group || 'unknown',
      intlDesignator: s.intlDesignator || '',
      lat: 0,
      lon: 0,
    }));
  },
  getLatLon: (s: any) => ({ lat: s.lat ?? 0, lon: s.lon ?? 0 }), // eslint-disable-line @typescript-eslint/no-explicit-any
  pollInterval: 300_000,
  global: true,
});

/**
 * Shipping Docks / Ports — static dataset
 * Fetched once globally, no polling.
 */
registerDataSource({
  layerId: 'docks',
  buildUrl: () => `/api/docks`,
  parseResponse: (json) => json.docks ?? [],
  getLatLon: (d: any) => ({ lat: d.lat ?? d.position?.lat, lon: d.lon ?? d.position?.lon }), // eslint-disable-line @typescript-eslint/no-explicit-any
  pollInterval: 0, // Static, no polling
  global: true,
});

/**
 * News events — geolocated headlines
 */
registerDataSource({
  layerId: 'news',
  buildUrl: (bounds) => `/api/news?${boundsToParams(bounds)}&limit=100`,
  parseResponse: (json) => json.events ?? [],
  getLatLon: (e: any) => ({ lat: e.lat ?? e.position?.lat, lon: e.lon ?? e.position?.lon }), // eslint-disable-line @typescript-eslint/no-explicit-any
  pollInterval: 60_000,
  cacheConfig: { cacheTTL: 300_000 },
});

// ============================================================================
// CACHE FACTORY
// Creates a SpatialCache instance for a given data source.
// ============================================================================

export function createCacheForSource<T extends { id: string }>(
  source: DataSource<T>
): SpatialCache<T> {
  return new SpatialCache<T>(source.getLatLon, source.cacheConfig);
}
