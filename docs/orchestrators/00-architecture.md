# Architecture Overview — Data Layer System

## How the system works

Every data layer follows the same pipeline:

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│ ViewportTracker│──▶│ useLayerData │──▶│ SpatialCache  │──▶│ LayerComponent│
│ (camera→bounds)│    │ (fetch+poll) │    │ (merge+cull)  │    │ (InstancedMesh│
└─────────────┘     └──────────────┘     └──────────────┘     └─────────────┘
        │                   │                    │                     │
        ▼                   ▼                    ▼                     ▼
  store.viewportBounds   /api/<layer>       only entities         useFrame()
  updated 5x/sec        ?lamin&lamax       in viewport           updates matrices
                         &lomin&lomax       are returned          60fps
```

### Key files

| File | Role |
|------|------|
| `src/lib/spatialCache.ts` | Reusable spatial cache: merge, getVisible, isRegionFresh, cleanup |
| `src/lib/dataSourceRegistry.ts` | Registry of data sources — one ~10-line config per layer |
| `src/hooks/useLayerData.ts` | Drop-in hook — give it a layerId, get back visible entities |
| `src/types/layers.ts` | Layer configs (id, color, icon, category, defaultEnabled) |
| `src/types/entities.ts` | Entity type definitions (per entity shape) |
| `src/lib/entityRegistry.ts` | Search/display config per entity type |
| `src/store/gameStore.ts` | Layer state (enabled/loaded/loading/error/entityCount) + layerEntities storage |
| `src/components/layers/*.tsx` | Rendering components (InstancedMesh per layer) |
| `src/app/api/*/route.ts` | Server-side API routes (proxy external APIs) |

### Adding a new layer — complete checklist

1. **Add LayerId** to `src/types/layers.ts` → `LayerId` union + `LAYER_CONFIGS`
2. **Add EntityType** to `src/types/entities.ts` → type union + interface
3. **Add entity config** to `src/lib/entityRegistry.ts` → search fields, display helpers
4. **Register data source** in `src/lib/dataSourceRegistry.ts` → `registerDataSource({ ... })`
5. **Create API route** in `src/app/api/<layer>/route.ts` → proxy external data
6. **Create layer component** in `src/components/layers/<Layer>.tsx` → `useLayerData(id)` + InstancedMesh
7. **Add to Scene** in `src/components/Scene.tsx` → `<Layer id="..."><Component /></Layer>`
8. Done — layer toggle, viewport visibility, caching, search, selection all work automatically.

### Viewport-based visibility (lazy loading)

"Lazy loading" in this system means: **entities only appear when you pan the map to their area.**

- `ViewportTracker` raycasts from the camera to the globe 5x/sec and writes `viewportBounds` (lat/lon box) to the store.
- `useLayerData` compares the viewport against its `SpatialCache.loadedRegion`.
  - If the cache already covers the viewport → skip fetch, return cached entities in viewport.
  - If not → fetch with padded bounds (1.5x), merge into cache, return visible subset.
- On pan/zoom, `useLayerData` debounces (300ms) then re-checks coverage.
- Cache cleanup runs every 30s: removes entities >2min old and >15° from viewport.

### Polling

Each data source specifies its `pollInterval`. The hook polls at that interval, with exponential backoff on errors (2x per error, max 8x). Static data sources set `pollInterval: 0` (fetch once).

### Global vs viewport-scoped

Most layers are **viewport-scoped** (maritime, news, aircraft): fetched with bounding box params.
Some are **global** (satellites, docks): fetched once in full, then the SpatialCache returns only the viewport-visible subset.

Set `global: true` in the data source config to skip bounding-box params in the URL.
