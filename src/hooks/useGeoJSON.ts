import { useState, useEffect } from 'react';

// ============================================================================
// SHARED GeoJSON HOOK
// Caches the country borders GeoJSON so multiple components can reuse it
// without duplicate fetches (CountryBorders + BorderHighlightLayer)
// ============================================================================

export interface GeoJSONFeature {
  type: string;
  id?: string; // ISO 3166-1 alpha-3 code (e.g. "USA", "UKR")
  properties: { name: string; [key: string]: unknown };
  geometry: {
    type: string;
    coordinates: number[][][] | number[][][][];
  };
}

export interface GeoJSONData {
  type: string;
  features: GeoJSONFeature[];
}

let cached: GeoJSONData | null = null;
let fetchPromise: Promise<GeoJSONData> | null = null;

export function useCountryGeoJSON() {
  const [data, setData] = useState<GeoJSONData | null>(cached);

  useEffect(() => {
    if (cached) {
      setData(cached);
      return;
    }

    if (!fetchPromise) {
      fetchPromise = fetch('/countries.geo.json')
        .then(r => {
          if (!r.ok) throw new Error('Failed to fetch GeoJSON');
          return r.json();
        })
        .then((d: GeoJSONData) => {
          cached = d;
          return d;
        })
        .catch(err => {
          console.error('Failed to load country GeoJSON:', err);
          fetchPromise = null;
          throw err;
        });
    }

    fetchPromise.then(d => setData(d));
  }, []);

  return data;
}
