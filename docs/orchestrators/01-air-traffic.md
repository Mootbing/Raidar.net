# Orchestrator: Air Traffic

**Status:** IMPLEMENTED + ENRICHED
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

## What was added (post-implementation)

### Aircraft type identification — DONE

`/api/aircraft/route.ts` now includes a server-side LRU metadata cache that enriches aircraft with type, model, operator, and registration data from the OpenSky metadata API.

**How it works:**

```
Poll 1: GET /api/aircraft → returns states + empty metadata
  → background: fires metadata lookups for up to 10 unknown icao24s
  → OpenSky responds with typecode, model, operator, registration
  → stored in server-side LRU cache (max 5000 entries, 24h TTL)

Poll 2: GET /api/aircraft → returns states + metadata for cached aircraft
  → DataPoller parses metadata, sets aircraft.type = "B738" instead of "UNKNOWN"
  → EntityInfoPanel shows IDENTIFICATION section: TYPE, MODEL, OPR, REG
```

**Files changed:**

| File | What |
|------|------|
| `src/app/api/aircraft/route.ts` | LRU metadata cache, background batch fetch (10/req, 3s timeout), negative caching (1h) |
| `src/components/DataPoller.tsx` | `parseStateVector()` accepts metadata, enriches Aircraft objects |
| `src/store/gameStore.ts` | Aircraft interface gained `typecode`, `aircraftModel`, `operator`, `registration` |
| `src/components/entities/EntityInfoPanel.tsx` | IDENTIFICATION section renders when metadata available |

**To get this working with real data:**

1. **Create an OpenSky account** at https://opensky-network.org/index.php?option=com_users&view=registration
2. **Add credentials** to `credentials.json` in project root:
   ```json
   {
     "clientId": "your_opensky_username",
     "clientSecret": "your_opensky_password"
   }
   ```
3. The metadata API requires authentication. Without credentials, the states endpoint still works (anonymous) but all aircraft will show `type: UNKNOWN`.
4. Metadata populates **gradually** — first poll returns nothing, subsequent polls fill in as the background batch fetcher warms the cache. After a few minutes of panning around, most aircraft in view will be enriched.
5. The cache persists in server memory. Restarting the dev server clears it.

**Tuning knobs** (constants at top of `route.ts`):

| Constant | Default | Purpose |
|----------|---------|---------|
| `METADATA_CACHE_MAX` | 5000 | Max cached aircraft before LRU eviction |
| `METADATA_CACHE_TTL` | 24h | How long a positive cache entry lasts |
| `METADATA_NEGATIVE_TTL` | 1h | How long a failed lookup is suppressed |
| `METADATA_BATCH_SIZE` | 10 | Max background lookups per poll cycle |
| `METADATA_FETCH_TIMEOUT` | 3s | Timeout per individual metadata request |

### Military aircraft detection — DONE

`DataPoller.tsx` now flags aircraft as military using three detection methods. Military aircraft render in orange-red (`#ff6644`) on the globe and show a **MIL** badge in the info panel.

**Detection methods** (in `detectMilitary()`):

1. **Callsign prefix** — 28 known military prefixes:
   - US: `RCH` (USAF AMC), `DUKE` (Army), `EVAC` (Aeromedical), `NAVY`, `SPAR`, `SAM`, `EXEC`, `PAT`, `HERKY`, `MOOSE`, `TOPCT`, `GOTHAM`, `CNV`
   - NATO: `RRR`/`ASCOT`/`TARTN` (RAF), `GAF` (German), `FAF` (French), `IAM` (Italian), `SHF` (Swedish), `PLF` (Polish), `BAF` (Belgian), `HAF` (Hellenic)
   - Generic: `VIPER`, `COBRA`, `HAWK`, `JAKE`, `STEEL`, `ROCKY`, `THUD`

2. **Squawk code** — 7501–7577 (military intercept range)

3. **ICAO hex range** — US military (`AE0000`–`AFFFFF`), UK military (`43C000`–`43CFFF`)

4. **Operator name** (from metadata) — matches "air force", "navy", "army", "marine", "military", "luftwaffe", etc.

**Files changed:**

| File | What |
|------|------|
| `src/components/DataPoller.tsx` | `detectMilitary()` function, applied in `parseStateVector()` and mock data generator |
| `src/store/gameStore.ts` | Aircraft interface gained `isMilitary?: boolean` |
| `src/components/AircraftLayerInstanced.tsx` | Military aircraft colored `AIRCRAFT_MILITARY` (#ff6644) |
| `src/components/entities/EntityInfoPanel.tsx` | MIL badge in status row |
| `src/config/constants.ts` | Added `COLORS.AIRCRAFT_MILITARY` |

**Mock data** generates ~10% military aircraft with callsigns like `RCH427`, `DUKE88`, `NAVY512` and military type codes (`C17`, `C130`, `KC135`, `F16`, `F35`).

## What could still be improved

### 1. Migrate to useLayerData (optional, low priority)

DataPoller has aircraft-specific logic (mock data, debug aircraft, squawk codes) that the generic system doesn't handle. It works fine as-is. If you want consistency, you could:

1. Move mock data generation into the API route's fallback
2. Move debug aircraft into a separate "debug" layer
3. Replace DataPoller with `useLayerData('aircraft')` in AircraftLayerInstanced

This is optional — the current system works and the aircraft-specific logic is valuable.

### 2. Military aircraft filter toggle

Currently military aircraft are detected and colored but there's no toggle to show **only** military. Could add:
- A `military` filter mode in `StackedModeBars` alongside ALL / AIRCRAFT / AIRPORTS
- Or a checkbox in `LayerPanel` under the aircraft layer
- Or a search filter: typing `military:true` in the search bar

### 3. Bulk metadata preloading

Current approach warms the cache 10 aircraft at a time per poll. For faster coverage:
- Download OpenSky's full aircraft database CSV (requires account) and load into a SQLite or in-memory lookup
- Or increase `METADATA_BATCH_SIZE` (watch for rate limits)
- Or cache to disk (JSON file) so the cache survives server restarts

## Data flow summary

```
User pans map → ViewportTracker updates bounds
  → DataPoller sees viewport changed (debounced 300ms)
  → checks LoadedRegion: is viewport covered? if yes, show cached
  → if not, fetches /api/aircraft?lamin=..&lamax=..&lomin=..&lomax=..
  → /api/aircraft proxies OpenSky states API with same bbox
  → response enriched with metadata from LRU cache
  → background: up to 10 unknown icao24s queued for metadata lookup
  → DataPoller parses states + metadata into Aircraft objects
  → detectMilitary() flags military aircraft
  → aircraftCache merges new aircraft, getVisibleFromCache() filters to viewport
  → AircraftLayerInstanced renders via InstancedMesh
  → military aircraft colored orange-red, civilians green
  → EntityInfoPanel shows TYPE/MODEL/OPR/REG when metadata cached
  → next poll cycle: more metadata available from background fetches
```
