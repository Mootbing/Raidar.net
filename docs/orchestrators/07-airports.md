# Orchestrator: Airports

**Status:** IMPLEMENTED
**Layer ID:** `airports`
**Entity type:** `AirportEntity`
**Component:** `src/components/AirportsLayer.tsx`
**API route:** `src/app/api/airports/route.ts`
**Polling:** None (static data, fetched once)

## What exists

Airports are fully implemented:

- `fetchAirports()` in the store loads from `/api/airports` once
- `/api/airports/route.ts` serves from a static JSON dataset (`public/data/airports.json`)
- `AirportsLayer.tsx` renders via InstancedMesh with:
  - Large vs small airport sizing
  - Small airport fade at far zoom
  - Diagonal sweep spawn animation
  - Hover/select interaction
- Full search and info panel support

## What could be improved

### 1. Migrate to useLayerData (optional, consistency)

Currently airports use a dedicated `fetchAirports()` in the store. To unify:

1. Register a data source in `dataSourceRegistry.ts`:
   ```typescript
   registerDataSource({
     layerId: 'airports',
     buildUrl: () => '/api/airports',
     parseResponse: (json) => json.airports ?? [],
     getLatLon: (a: any) => ({ lat: a.lat, lon: a.lon }),
     pollInterval: 0,
     global: true,
   });
   ```

2. In `AirportsLayer.tsx`, replace the store-based fetch with:
   ```typescript
   const airports = useLayerData<Airport>('airports');
   ```

This is optional — the current system works fine.

### 2. Military airport filter

Add an `isMilitary` flag to airport data and allow filtering. Military airports can be identified by:
- ICAO prefixes (e.g., `K` prefix US military bases have specific patterns)
- Cross-reference with known military base databases
- Airport type field in the dataset

### 3. Connect to docks layer

When both airports and docks are enabled, show proximity lines between nearby airports and ports (logistics corridors).
