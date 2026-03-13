# Orchestrator: Maritime Traffic

**Status:** SCAFFOLDED — needs API implementation
**Layer ID:** `maritime`
**Entity type:** `ShipEntity`
**Component:** `src/components/layers/MaritimeLayer.tsx`
**API route:** `src/app/api/maritime/route.ts`
**Polling:** 30s

## What exists

- Layer config, entity types, registry config, data source registration all done
- `MaritimeLayer.tsx` calls `useLayerData('maritime')` and renders ships as instanced cones
- API route stub returns `{ vessels: [] }`
- Layer toggle in LayerPanel works
- Viewport-based spatial caching is automatic

## What to implement

### Step 1: Choose an AIS data source

| Source | Cost | Coverage | Rate limit |
|--------|------|----------|------------|
| **AISHub** | Free (contribute data) | Community | Varies |
| **MarineTraffic** | Paid, from $100/mo | Best | Per plan |
| **VesselFinder** | Paid, from $50/mo | Good | Per plan |
| **BarentsWatch** | Free (Nordic) | Nordic waters | Generous |

Recommendation: Start with **AISHub** (free, community-sourced) or **BarentsWatch** for a demo.

### Step 2: Implement the API route

Edit `src/app/api/maritime/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';

const AIS_API_KEY = process.env.AIS_API_KEY;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lamin = searchParams.get('lamin');
  const lamax = searchParams.get('lamax');
  const lomin = searchParams.get('lomin');
  const lomax = searchParams.get('lomax');

  // Example: AISHub API
  const url = `https://data.aishub.net/ws.php?username=${AIS_API_KEY}&format=1&output=json&compress=0&latmin=${lamin}&latmax=${lamax}&lonmin=${lomin}&lonmax=${lomax}`;

  const res = await fetch(url);
  const data = await res.json();

  // Parse AIS response into our vessel format
  const vessels = data.map((v: any) => ({
    id: v.MMSI.toString(),
    name: v.NAME?.trim() || `MMSI ${v.MMSI}`,
    lat: v.LATITUDE,
    lon: v.LONGITUDE,
    heading: v.HEADING ?? v.COG ?? 0,
    speed: v.SOG ?? 0,
    shipType: mapAISType(v.TYPE),
    flag: v.FLAG || 'Unknown',
    imo: v.IMO,
    destination: v.DESTINATION,
    draught: v.DRAUGHT,
  }));

  return NextResponse.json({ vessels });
}
```

### Step 3: Add vessel type mapping

AIS ship type codes need mapping to human-readable categories. Add to the route:

```typescript
function mapAISType(code: number): string {
  if (code >= 70 && code <= 79) return 'cargo';
  if (code >= 80 && code <= 89) return 'tanker';
  if (code >= 60 && code <= 69) return 'passenger';
  if (code >= 40 && code <= 49) return 'high_speed';
  if (code >= 30 && code <= 39) return 'fishing';
  if (code >= 50 && code <= 59) return 'special';
  if (code === 35) return 'military';
  return 'other';
}
```

### Step 4: Update MaritimeLayer rendering (optional)

The current stub renders blue cones. For a polished version:

1. **Color by type:** cargo=blue, tanker=orange, military=red, passenger=white, fishing=green
2. **Size by vessel size:** use DWT or length if available
3. **Heading arrow:** rotate cone to match heading
4. **Wake trail:** for fast vessels (SOG > 10kn), render a short fading trail
5. **Dead reckoning:** predict position between updates using SOG + COG

All of this happens inside `MaritimeLayer.tsx`'s `useFrame()` callback — same pattern as `AircraftLayerInstanced.tsx`.

### Step 5: Add ship info to EntityInfoPanel

Edit `src/components/entities/EntityInfoPanel.tsx` and add a case for `ship`:

```typescript
case 'ship': {
  const ship = entity as any;
  return (
    <>
      <InfoRow label="NAME" value={ship.name} />
      <InfoRow label="MMSI" value={ship.id} />
      <InfoRow label="TYPE" value={ship.shipType} />
      <InfoRow label="FLAG" value={ship.flag} />
      <InfoRow label="SPEED" value={`${ship.speed} kn`} />
      <InfoRow label="HEADING" value={`${ship.heading}°`} />
      <InfoRow label="DEST" value={ship.destination || 'N/A'} />
    </>
  );
}
```

### Step 6: Environment variable

Add to `.env.local`:
```
AIS_API_KEY=your_key_here
```

## Data flow summary

```
User pans map → ViewportTracker updates bounds
  → useLayerData('maritime') sees viewport changed
  → checks SpatialCache: is region fresh? if yes, return cached visible subset
  → if not, fetches /api/maritime?lamin=..&lamax=..&lomin=..&lomax=..
  → /api/maritime proxies AIS API with same bbox params
  → response parsed into { vessels: [...] }
  → SpatialCache.merge(vessels, paddedBounds)
  → SpatialCache.getVisible(viewportBounds) → only ships in view
  → MaritimeLayer.tsx gets ships array
  → useFrame() positions instanced cones on globe
  → user sees ships appear as they pan
```
