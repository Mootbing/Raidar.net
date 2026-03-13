# Orchestrator: Air Traffic

**Status:** IMPLEMENTED
**Layer ID:** `aircraft`
**Entity type:** `AircraftEntity`
**Component:** `src/components/AircraftLayerInstanced.tsx`
**Data source:** OpenSky Network
**Polling:** 15s

## What exists

Air traffic is fully implemented and is the reference pattern for all other layers.

- `DataPoller.tsx` fetches aircraft for the visible viewport from `/api/aircraft`
- `/api/aircraft/route.ts` proxies OpenSky Network (`opensky-network.org/api/states/all`)
- `AircraftLayerInstanced.tsx` renders up to thousands of aircraft via `InstancedMesh`
- Dead reckoning predicts positions between server updates
- Flight track history via `/api/flight-route`
- Full entity info panel, search, hover/select, view modes

## What could be improved

### 1. Migrate to useLayerData (optional, low priority)

DataPoller has aircraft-specific logic (mock data, debug aircraft, squawk codes) that the generic system doesn't handle. It works fine as-is. If you want consistency, you could:

1. Move mock data generation into the API route's fallback
2. Move debug aircraft into a separate "debug" layer
3. Replace DataPoller with `useLayerData('aircraft')` in AircraftLayerInstanced

This is optional — the current system works and the aircraft-specific logic is valuable.

### 2. Aircraft type identification

Currently all aircraft show as `type: 'UNKNOWN'` because OpenSky doesn't include aircraft type in state vectors. To fix:

1. Fetch aircraft database from OpenSky: `https://opensky-network.org/api/metadata/aircraft/icao/{icao24}`
2. Cache the mapping `icao24 → { typecode, model, operator }` in a server-side LRU cache
3. Enrich aircraft entities in `/api/aircraft/route.ts` before returning

### 3. Military aircraft filter

Add a filter in `StackedModeBars` or `LayerPanel` for military-only aircraft:
- Squawk codes 7501-7577 (military intercept)
- Known military callsign prefixes (RCH, DUKE, EVAC, etc.)
- Known military ICAO hex ranges per country
