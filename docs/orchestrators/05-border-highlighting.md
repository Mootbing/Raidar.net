# Orchestrator: Border Highlighting

**Status:** SCAFFOLDED — needs GeoJSON integration
**Layer ID:** `border_highlight`
**Entity type:** N/A (not entity-based, purely visual)
**Component:** `src/components/layers/BorderHighlightLayer.tsx`
**API route:** None needed (client-side, reuses existing GeoJSON)
**Polling:** None

## What exists

- Layer config in `layers.ts` with `defaultEnabled: false`
- `BorderHighlightLayer.tsx` renders a group with pulse animation
- Layer toggle in LayerPanel

## What to implement

This layer is different from entity-based layers — it doesn't use `useLayerData` or an API route. It reuses the same GeoJSON data that `CountryBorders.tsx` already loads, but renders a highlighted subset with different styling.

### Step 1: Add highlighted countries state to the store

Edit `src/store/gameStore.ts`:

```typescript
// In the Store interface:
highlightedCountries: string[];  // ISO 3166-1 alpha-3 codes
setHighlightedCountries: (codes: string[]) => void;
addHighlightedCountry: (code: string) => void;
removeHighlightedCountry: (code: string) => void;

// In the implementation:
highlightedCountries: [],
setHighlightedCountries: (codes) => set({ highlightedCountries: codes }),
addHighlightedCountry: (code) => set((s) => ({
  highlightedCountries: [...new Set([...s.highlightedCountries, code])],
})),
removeHighlightedCountry: (code) => set((s) => ({
  highlightedCountries: s.highlightedCountries.filter(c => c !== code),
})),
```

### Step 2: Load GeoJSON (share with CountryBorders)

The existing `CountryBorders.tsx` loads GeoJSON from `public/data/countries.geojson`. Extract the loading logic into a shared hook or import the same data:

```typescript
// src/hooks/useGeoJSON.ts
import { useState, useEffect } from 'react';

let cached: any = null;

export function useCountryGeoJSON() {
  const [data, setData] = useState(cached);
  useEffect(() => {
    if (cached) return;
    fetch('/data/countries.geojson')
      .then(r => r.json())
      .then(d => { cached = d; setData(d); });
  }, []);
  return data;
}
```

### Step 3: Implement BorderHighlightLayer

```typescript
import { useCountryGeoJSON } from '@/hooks/useGeoJSON';

export function BorderHighlightLayer() {
  const geojson = useCountryGeoJSON();
  const highlighted = useRadarStore((s) => s.highlightedCountries);
  const groupRef = useRef<THREE.Group>(null);

  const geometry = useMemo(() => {
    if (!geojson || highlighted.length === 0) return null;

    // Filter features to highlighted countries
    const features = geojson.features.filter(
      (f: any) => highlighted.includes(f.properties.ISO_A3)
    );

    // Build LineSegments geometry from polygon coordinates
    // Same logic as CountryBorders but only for selected countries
    const positions: number[] = [];
    for (const feature of features) {
      const coords = feature.geometry.type === 'MultiPolygon'
        ? feature.geometry.coordinates.flat()
        : feature.geometry.coordinates;

      for (const ring of coords) {
        for (let i = 0; i < ring.length - 1; i++) {
          const [lon1, lat1] = ring[i];
          const [lon2, lat2] = ring[i + 1];
          // Convert to 3D positions on globe at BORDER_HIGHLIGHT_OFFSET
          pushLineSegment(positions, lat1, lon1, lat2, lon2, GLOBE.BORDER_HIGHLIGHT_OFFSET);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, [geojson, highlighted]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    // Pulse the highlight
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 2);
    groupRef.current.children.forEach(child => {
      const mat = (child as THREE.LineSegments).material as THREE.LineBasicMaterial;
      if (mat) mat.opacity = pulse;
    });
  });

  if (!geometry || highlighted.length === 0) return null;

  return (
    <group ref={groupRef}>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial
          color="#ffaa00"
          transparent
          opacity={0.8}
          linewidth={1}
        />
      </lineSegments>
    </group>
  );
}
```

### Step 4: Triggering highlights

Multiple systems should be able to highlight countries:

1. **Manual:** Click a country border → toggle highlight. Requires raycasting against border geometry.
2. **From news layer:** When a news event is selected, auto-highlight the country it's in.
3. **From entity selection:** When an aircraft/ship is selected, highlight its origin country.
4. **Predefined sets:** "NATO countries", "conflict zones", etc. as preset highlight groups.

For manual click-to-highlight, add a raycast handler in `CameraController.tsx`:

```typescript
// On click, raycast against globe, get lat/lon, reverse-geocode to country ISO code
// Then call addHighlightedCountry(isoCode)
```

Reverse geocoding from lat/lon to country can use the GeoJSON point-in-polygon test:
```typescript
import { booleanPointInPolygon, point } from '@turf/turf';

function getCountryAtPoint(lat: number, lon: number, geojson: any): string | null {
  const pt = point([lon, lat]);
  for (const feature of geojson.features) {
    if (booleanPointInPolygon(pt, feature)) {
      return feature.properties.ISO_A3;
    }
  }
  return null;
}
```

Install turf: `npm install @turf/turf`

### Step 5: Color coding

Support different highlight colors by reason:

```typescript
interface HighlightEntry {
  code: string;          // ISO_A3
  color: string;         // hex
  reason: 'selected' | 'conflict' | 'ally' | 'news' | 'manual';
}
```

Update the store to hold `HighlightEntry[]` instead of `string[]`, and apply per-entry colors to the line material.

## Data flow summary

```
User clicks country / news event triggers highlight
  → store.addHighlightedCountry('UKR')
  → BorderHighlightLayer re-renders
  → filters GeoJSON features to highlighted ISO codes
  → builds LineSegments geometry for those borders
  → renders at BORDER_HIGHLIGHT_OFFSET (above normal borders)
  → useFrame() pulses opacity for attention
```
