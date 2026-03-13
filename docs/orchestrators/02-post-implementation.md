# Post-Implementation: 02 Maritime Traffic

**Status:** IMPLEMENTED
**Date:** 2026-03-12

## What was done

### Step 2: API route (`src/app/api/maritime/route.ts`)

- Integrated **AISHub** as the primary AIS data source
- Accepts viewport bounds via `lamin`, `lamax`, `lomin`, `lomax` query params
- Rate limiting: 5s minimum interval, 10 requests/minute max
- AISHub response parsed into normalized vessel format: `{ id, name, lat, lon, heading, speed, shipType, flag, imo, destination, draught }`
- Returns `{ vessels: [...], source: 'aishub' | 'mock' | 'mock-fallback' }`
- **Mock data fallback:** when `AIS_API_KEY` is not set, generates deterministic mock vessels within the viewport bounds. Uses a seed derived from bounds so vessels remain stable between polls. Count scales with viewport area (5–60 vessels). Covers all ship types and realistic flags/names/destinations.
- On AISHub fetch error, falls back to mock data automatically

### Step 3: Vessel type mapping (`mapAISType`)

Added in the API route. Converts AIS numeric type codes:

| Code range | Category |
|------------|----------|
| 70–79 | cargo |
| 80–89 | tanker |
| 60–69 | passenger |
| 40–49 | high_speed |
| 30–39 | fishing |
| 50–59 | special |
| 35 | military |
| other | other |

### Step 4: MaritimeLayer rendering (`src/components/layers/MaritimeLayer.tsx`)

- **Color by type:** Per-instance coloring via `InstancedBufferAttribute`. Each ship type gets a distinct color:
  - cargo → blue (`#4488ff`)
  - tanker → orange (`#ff8844`)
  - passenger → white (`#ffffff`)
  - military → red (`#ff4444`)
  - fishing → green (`#44cc66`)
  - high_speed → yellow (`#ffcc00`)
  - special → purple (`#cc44ff`)
  - other → grey-blue (`#88aacc`)
- **Speed-based scaling:** Faster vessels render slightly larger (1.0–1.5x scale based on SOG, capped at 25kn)
- **Heading rotation:** Cone geometry rotated to match vessel heading via `rotateZ`
- Material changed to `vertexColors` mode with 0.85 opacity
- Cone geometry slightly elongated (`0.004` radius, `0.012` height) for better directionality

### Step 5: Ship info in EntityInfoPanel (`src/components/entities/EntityInfoPanel.tsx`)

Added `ShipInfoContent` component with:
- **Header:** vessel name + MMSI identifier
- **Status row:** UNDERWAY/AT_ANCHOR indicator (based on speed > 0.5kn), flag display
- **Navigation section:** speed (kn), heading (°), lat/lon coordinates
- **Voyage section:** destination, draught (m), IMO number (when available)

Wired into the panel's render switch — `displayedRef.type === 'ship'` now renders the ship panel instead of the generic "not yet implemented" fallback.

### Step 6: Environment variable

`AIS_API_KEY` read from `process.env.AIS_API_KEY`. Add to `.env.local`:
```
AIS_API_KEY=your_aishub_username_here
```
Without this key, the layer works immediately using mock data.

### Additional: ShipEntity type (`src/types/entities.ts`)

Extended with optional fields to match the API response:
- `imo?: number`
- `destination?: string`
- `draught?: number`

## What was NOT changed

- **Layer config, data source registration, entity registry, store integration** — all were already scaffolded and correct. No modifications needed.
- **useLayerData hook, SpatialCache, LayerPanel** — used as-is. Maritime layer plugs into the generic system without changes.
- **Wake trails / dead reckoning** (Step 4 optional items) — not implemented. Can be added later following the `AircraftLayerInstanced.tsx` pattern.

## Files modified

| File | Change |
|------|--------|
| `src/app/api/maritime/route.ts` | Full implementation replacing placeholder |
| `src/components/layers/MaritimeLayer.tsx` | Color-by-type, speed scaling, heading rotation |
| `src/components/entities/EntityInfoPanel.tsx` | Added ShipInfoContent + wired into render |
| `src/types/entities.ts` | Added imo, destination, draught to ShipEntity |

## Build verification

- `tsc --noEmit` — clean, no type errors
- `next build` — success, `/api/maritime` listed as dynamic route
