# Orchestrator: Satellites Overhead & Routes

**Status:** SCAFFOLDED — needs API + SGP4 implementation
**Layer ID:** `satellites`
**Entity type:** `SatelliteEntity`
**Component:** `src/components/layers/SatelliteLayer.tsx`
**API route:** `src/app/api/satellites/route.ts`
**Polling:** 300s (TLE data refreshes slowly)

## What exists

- Layer config, entity types, registry config, data source registration all done
- `SatelliteLayer.tsx` calls `useLayerData('satellites')` and renders instanced octahedrons
- Data source is registered as `global: true` (fetched once, not per-viewport)
- SpatialCache returns only satellites above the current viewport
- API route stub returns `{ satellites: [] }`

## What to implement

### Step 1: Fetch TLE data server-side

Edit `src/app/api/satellites/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';

// CelesTrak provides free TLE data — no API key needed
const TLE_URLS = {
  active: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json',
  starlink: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=json',
  military: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=military&FORMAT=json',
  stations: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json',
};

// Server-side cache (TLE updates every few hours)
let cache: { data: any; fetchedAt: number } | null = null;
const CACHE_TTL = 3600_000; // 1 hour

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const group = searchParams.get('group') || 'active';

  // Return cached if fresh
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  const url = TLE_URLS[group as keyof typeof TLE_URLS] || TLE_URLS.active;
  const res = await fetch(url);
  const tleData = await res.json();

  // CelesTrak JSON format: [{ OBJECT_NAME, NORAD_CAT_ID, TLE_LINE1, TLE_LINE2, ... }]
  const satellites = tleData.map((sat: any) => ({
    id: sat.NORAD_CAT_ID.toString(),
    name: sat.OBJECT_NAME,
    noradId: sat.NORAD_CAT_ID.toString(),
    tle1: sat.TLE_LINE1,
    tle2: sat.TLE_LINE2,
    // lat/lon/alt will be computed CLIENT-SIDE via SGP4
    lat: 0,
    lon: 0,
    alt: 0,
    orbitType: classifyOrbit(sat.PERIOD),
    operator: sat.OBJECT_NAME.split(' ')[0], // rough heuristic
  }));

  cache = { data: { satellites }, fetchedAt: Date.now() };
  return NextResponse.json({ satellites });
}

function classifyOrbit(periodMinutes: number): string {
  if (!periodMinutes) return 'LEO';
  if (periodMinutes < 128) return 'LEO';
  if (periodMinutes < 720) return 'MEO';
  if (periodMinutes > 1400) return 'GEO';
  return 'HEO';
}
```

### Step 2: Install satellite.js for client-side SGP4

```bash
npm install satellite.js
npm install -D @types/satellite.js  # if needed
```

This library takes TLE strings and propagates satellite positions to any timestamp.

### Step 3: Update SatelliteLayer with SGP4 propagation

Edit `src/components/layers/SatelliteLayer.tsx`:

```typescript
import * as satellite from 'satellite.js';

// In useFrame(), propagate each satellite's position:
useFrame(() => {
  const now = new Date();
  for (let i = 0; i < sats.length; i++) {
    const sat = sats[i];
    if (!sat.tle1 || !sat.tle2) continue;

    const satrec = satellite.twoline2satrec(sat.tle1, sat.tle2);
    const posVel = satellite.propagate(satrec, now);
    if (!posVel.position || typeof posVel.position === 'boolean') continue;

    const gmst = satellite.gstime(now);
    const geo = satellite.eciToGeodetic(posVel.position, gmst);

    const lat = satellite.degreesLat(geo.latitude);
    const lon = satellite.degreesLong(geo.longitude);
    const altKm = geo.height;

    // Position on globe
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    const r = GLOBE.SATELLITE_MIN_ALTITUDE +
      Math.min(altKm / 35786, 1) * (GLOBE.SATELLITE_MAX_ALTITUDE - GLOBE.SATELLITE_MIN_ALTITUDE);

    dummy.position.set(
      -r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta)
    );
    dummy.lookAt(0, 0, 0);
    dummy.updateMatrix();
    meshRef.current.setMatrixAt(i, dummy.matrix);
  }
  meshRef.current.instanceMatrix.needsUpdate = true;
});
```

### Step 4: Render orbital ground tracks

For a selected satellite, compute the ground track (next ~90 minutes):

```typescript
function computeGroundTrack(tle1: string, tle2: string, minutes: number = 90): { lat: number; lon: number }[] {
  const satrec = satellite.twoline2satrec(tle1, tle2);
  const points: { lat: number; lon: number }[] = [];
  const now = Date.now();

  for (let m = 0; m <= minutes; m += 1) {
    const time = new Date(now + m * 60_000);
    const posVel = satellite.propagate(satrec, time);
    if (!posVel.position || typeof posVel.position === 'boolean') continue;

    const gmst = satellite.gstime(time);
    const geo = satellite.eciToGeodetic(posVel.position, gmst);
    points.push({
      lat: satellite.degreesLat(geo.latitude),
      lon: satellite.degreesLong(geo.longitude),
    });
  }
  return points;
}
```

Render as a `<Line>` from `@react-three/drei` on the globe surface (same as FlightPath).

### Step 5: Add satellite info to EntityInfoPanel

```typescript
case 'satellite': {
  const sat = entity as any;
  return (
    <>
      <InfoRow label="NAME" value={sat.name} />
      <InfoRow label="NORAD" value={sat.noradId} />
      <InfoRow label="ORBIT" value={sat.orbitType} />
      <InfoRow label="ALT" value={`${Math.round(sat.alt)} km`} />
      <InfoRow label="OPERATOR" value={sat.operator} />
    </>
  );
}
```

### Step 6: Performance considerations

- **Active satellites catalog has ~9,000 entries.** InstancedMesh handles this fine.
- **SGP4 propagation per frame** for 9k sats is expensive. Optimization:
  - Only propagate satellites in/near the viewport (SpatialCache handles this)
  - Propagate every 5th frame instead of every frame (`if (frameCount % 5 !== 0) return`)
  - Pre-compute positions for the next 10 seconds, interpolate between
- **Starlink alone is ~5,000 satellites.** Consider a separate "Starlink" toggle or LOD to hide at far zoom.

## Data flow summary

```
Layer enabled → useLayerData('satellites') initial fetch
  → GET /api/satellites (global, no bbox)
  → CelesTrak returns TLE data for ~9000 satellites
  → API caches for 1 hour, returns { satellites: [...] }
  → SpatialCache stores all (global mode)
  → SpatialCache.getVisible(viewport) returns overhead subset
  → SatelliteLayer.tsx gets array of satellites with TLE strings
  → useFrame() runs SGP4 propagation per visible satellite
  → positions updated at real-time orbital speed
  → user pans → different satellites become visible from cache
```
