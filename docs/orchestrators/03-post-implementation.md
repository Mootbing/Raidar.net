# Post-Implementation: 03 Satellites

**Status:** IMPLEMENTED
**Date:** 2026-03-12

## What was done

### Step 1: Install satellite.js

Added `satellite.js` npm package for client-side SGP4/SDP4 orbital propagation. Types are bundled — no separate `@types` package needed.

### Step 2: API route (`src/app/api/satellites/route.ts`)

- Fetches real **TLE (Two-Line Element)** data from **CelesTrak** (free, no API key)
- Pulls from 4 satellite groups in parallel:
  - `stations` — ISS, Tiangong, CSS (~15 sats)
  - `visual` — brightest/most visible (~170 sats)
  - `weather` — meteorological satellites (~50 sats)
  - `science` — scientific missions (~100 sats)
- Total: ~300–500 unique satellites after deduplication by NORAD ID
- TLE three-line format parsed server-side into structured objects: `{ id, name, noradId, tle1, tle2, group, intlDesignator }`
- Server-side cache with 4-hour TTL (TLE data only updates every few hours)
- `Promise.allSettled` — partial failures don't block other groups
- On fetch failure, returns stale cache if available; 502 only when no data at all
- Uses `AbortSignal.timeout(15000)` per group to prevent hung requests

### Step 3: SatelliteLayer rewrite (`src/components/layers/SatelliteLayer.tsx`)

Complete rewrite from placeholder to fully functional layer:

**SGP4 Propagation:**
- TLE strings parsed into `satrec` objects via `satellite.twoline2satrec()` — memoized with `useMemo`, only recomputes when TLE data changes from API
- Every frame: `satellite.propagate(satrec, now)` → `satellite.eciToGeodetic()` computes real lat/lon/alt
- Velocity magnitude computed from ECI velocity vector
- Satellites with bad propagation (NaN, negative altitude, >100k km) silently skipped

**Orbit classification:**
- `classifyOrbit(altKm, inclination)` categorizes each satellite:
  - `LEO` — altitude < 2,000 km
  - `SSO` — LEO with inclination 85°–105°
  - `MEO` — 2,000–35,000 km
  - `GEO` — 35,000–36,500 km
  - `HEO` — everything else
- Orbital period derived from mean motion: `1440 / meanMotion` minutes

**Rendering:**
- `InstancedMesh` with `octahedronGeometry` (size 0.004)
- Per-instance color via `vertexColors` material + `setColorAt()`:
  - Default: `#ff66aa` (layer pink)
  - Hovered: `#ffffff` (white)
  - Selected: `#00ddff` (cyan, pulsing)
- Altitude mapping: LEO near surface (r=1.05), GEO further out (r=1.5), normalized over 0–40,000 km range
- Pre-allocated `Object3D`, `Color`, `Raycaster`, `Vector2` outside component (zero GC in render loop)
- `depthWrite: false` for proper blending with globe

**Interaction:**
- Pointer move → raycasts against instanced mesh → `hoverEntity({ type: 'satellite', id })`
- Click → `selectEntity({ type: 'satellite', id })`
- Hover/select scale: hovered 2x, selected 2.5x with sine pulse
- Respects `activeMode` filter — only interactive in `all` or `satellite` modes
- Propagated data synced to Zustand store every 2s (not every frame) for search/entity lookup

### Step 4: Data source registry update (`src/lib/dataSourceRegistry.ts`)

Updated the `satellites` data source `parseResponse` to pass through TLE fields (`tle1`, `tle2`, `group`, `intlDesignator`) needed for client-side propagation. Default lat/lon of 0 since real positions are computed by satellite.js.

### Step 5: Satellite info in EntityInfoPanel (`src/components/entities/EntityInfoPanel.tsx`)

Added `SatelliteInfoContent` component with:
- **Header:** satellite name + NORAD catalog number
- **Classification row:** orbit type badge (LEO/MEO/GEO/SSO/HEO), COSPAR international designator
- **Position section:** lat, lon, altitude (km), velocity (km/s) — all from real-time propagation
- **Orbital elements section:** inclination (°), orbital period (min)

Wired into the panel's render switch — `displayedRef.type === 'satellite'` now renders the satellite panel.

## Architecture decisions

**Client-side propagation vs server-side:**
Chose client-side SGP4 for real-time smooth orbital motion. Server would only provide snapshots at poll intervals (5 min), creating jerky movement. Client propagation gives 60fps position updates from static TLE data.

**TLE format vs JSON format:**
Used CelesTrak's TLE (three-line) format rather than JSON/GP format. TLE is the native input for satellite.js `twoline2satrec()` and is more compact over the wire.

**Memoized satrec parsing:**
`twoline2satrec()` is called once per satellite when TLE data arrives, not per frame. The `satrec` objects persist across frames via `useMemo`. Only the lightweight `propagate()` call runs per frame.

**Store sync throttle:**
Propagated satellite data is synced to Zustand every 2 seconds, not every frame. This avoids triggering React re-renders at 60fps while keeping entity lookup/search reasonably fresh.

## What was NOT changed

- **Layer config** (`src/types/layers.ts`) — already correct (satellites, lazy, traffic category)
- **Entity types** (`src/types/entities.ts`) — `SatelliteEntity` already defined
- **Entity registry** (`src/lib/entityRegistry.ts`) — satellite config with search fields already present
- **Scene.tsx** — `<Layer id="satellites"><SatelliteLayer /></Layer>` already wired
- **Store** (`src/store/gameStore.ts`) — `getEntityByRef` already handles satellite via `layerEntities` map
- **useLayerData hook** — used as-is with `global: true` flag

## What was NOT implemented

- **Orbital ground tracks** (Step 4 in orchestrator) — rendering predicted ground track as a line for selected satellites. Can be added following the `FlightPath.tsx` pattern with `computeGroundTrack()` propagating positions at 1-minute intervals over ~90 minutes.
- **Starlink/large constellation toggle** — current groups don't include Starlink (~5,000 sats). Adding it would require LOD or a separate toggle to avoid overwhelming the renderer.
- **Frame skipping optimization** — propagation runs every frame for all loaded satellites. At ~300–500 sats this is fine. For 5,000+ sats, propagate every Nth frame or interpolate between keyframes.

## Files modified

| File | Change |
|------|--------|
| `src/app/api/satellites/route.ts` | Full implementation replacing placeholder |
| `src/components/layers/SatelliteLayer.tsx` | Complete rewrite with SGP4 propagation, interaction, instanced rendering |
| `src/lib/dataSourceRegistry.ts` | Updated satellite parseResponse to pass TLE data |
| `src/components/entities/EntityInfoPanel.tsx` | Added SatelliteInfoContent + wired into render |
| `package.json` | Added `satellite.js` dependency |

## Build verification

- `tsc --noEmit` — clean, no type errors
- `next build` — success, `/api/satellites` listed as dynamic route
