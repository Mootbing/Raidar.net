# Orchestrator: Shipping Docks / Ports

**Status:** SCAFFOLDED — needs dataset
**Layer ID:** `docks`
**Entity type:** `DockEntity`
**Component:** `src/components/layers/DocksLayer.tsx`
**API route:** `src/app/api/docks/route.ts`
**Polling:** None (static data, fetched once)

## What exists

- Layer config, entity types, registry config, data source registration all done
- `DocksLayer.tsx` calls `useLayerData('docks')` and renders instanced box markers
- Data source is `global: true`, `pollInterval: 0` (static, fetch once)
- SpatialCache returns only ports visible in the current viewport
- API route stub returns `{ docks: [] }`

## What to implement

### Step 1: Obtain port dataset

| Source | Count | Format | Notes |
|--------|-------|--------|-------|
| **World Port Index (WPI)** | ~3,700 | CSV/JSON | US NGA, most authoritative, includes lat/lon/type |
| **UN LOCODE** | ~100,000 | CSV | Many non-port entries, needs filtering |
| **OpenStreetMap** | Varies | GeoJSON | Use Overpass API to extract `amenity=port` |

Recommendation: Use **WPI** — it has exactly what we need (major ports with coordinates and types).

### Step 2: Create the port data file

Download WPI and convert to JSON. Place at `public/data/ports.json`:

```json
[
  {
    "id": "USNYK",
    "name": "New York / New Jersey",
    "portCode": "USNYK",
    "lat": 40.6892,
    "lon": -74.0445,
    "country": "United States",
    "portType": "container",
    "capacity": 7600000
  },
  ...
]
```

Conversion script (one-time, run locally):

```python
import csv, json

ports = []
with open('wpi.csv') as f:
    reader = csv.DictReader(f)
    for row in reader:
        lat = float(row['LATITUDE_DEGREES']) + float(row.get('LATITUDE_MINUTES', 0)) / 60
        lon = float(row['LONGITUDE_DEGREES']) + float(row.get('LONGITUDE_MINUTES', 0)) / 60
        if row.get('LATITUDE_HEMISPHERE') == 'S': lat = -lat
        if row.get('LONGITUDE_HEMISPHERE') == 'W': lon = -lon

        ports.append({
            'id': row['WORLD_PORT_INDEX_NUMBER'],
            'name': row['MAIN_PORT_NAME'],
            'portCode': row.get('LOCODE', ''),
            'lat': round(lat, 4),
            'lon': round(lon, 4),
            'country': row['COUNTRY_CODE'],
            'portType': classify_port(row),
            'capacity': None,
        })

with open('public/data/ports.json', 'w') as f:
    json.dump(ports, f)
```

### Step 3: Implement the API route

Edit `src/app/api/docks/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

let cache: any[] | null = null;

export async function GET(_request: NextRequest) {
  if (!cache) {
    const filePath = path.join(process.cwd(), 'public', 'data', 'ports.json');
    const raw = await readFile(filePath, 'utf-8');
    cache = JSON.parse(raw);
  }
  return NextResponse.json({ docks: cache });
}
```

Same pattern as the existing `/api/airports` route.

### Step 4: Polish the rendering

In `DocksLayer.tsx`, enhance the instanced rendering:

1. **Color by type:** container=cyan, bulk=gray, naval=red, oil=orange, mixed=white
2. **Size by capacity:** scale marker size proportional to capacity if available
3. **Spawn animation:** match the airport sweep animation (diagonal fade-in)
4. **LOD:** hide small ports when zoomed far out (same pattern as small airports)

### Step 5: Add port info to EntityInfoPanel

```typescript
case 'dock': {
  const dock = entity as any;
  return (
    <>
      <InfoRow label="PORT" value={dock.name} />
      <InfoRow label="CODE" value={dock.portCode} />
      <InfoRow label="COUNTRY" value={dock.country} />
      <InfoRow label="TYPE" value={dock.portType} />
      {dock.capacity && <InfoRow label="CAPACITY" value={`${dock.capacity.toLocaleString()} TEU`} />}
    </>
  );
}
```

### Step 6: Link with maritime layer

When both `docks` and `maritime` layers are enabled, show vessel count per port:

1. In the store or component, compute `portsWithTraffic`: for each dock, count ships within 0.5° radius
2. Display this count in the port info panel and as a badge on the marker
3. Clicking a port could filter maritime traffic to show only ships near that port

## Data flow summary

```
Layer enabled → useLayerData('docks') initial fetch
  → GET /api/docks (global, no bbox)
  → reads public/data/ports.json (static file, ~3700 ports)
  → cached server-side after first read
  → SpatialCache stores all ports
  → SpatialCache.getVisible(viewport) → ports in view
  → DocksLayer.tsx renders instanced boxes at port locations
  → user pans → different ports appear/disappear from cache
  → no polling needed (static data)
```
