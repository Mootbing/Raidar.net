'use client';

import { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useRadarStore, ViewportBounds } from '@/store/gameStore';
import { GLOBE } from '@/config/constants';

// ============================================================================
// SATELLITE IMAGERY LAYER
//
// Three-tier adaptive tile system with progressive rendering:
//   1. Base texture  (z=4, 4096×4096, 256 tiles)  — full globe (ESRI)
//   2. Detail texture (z=5–19, viewport-only)      — adaptive resolution (ESRI)
//   3. Street overlay (z=10–19, close zoom only)   — OSM dark tiles on top
//
// At close zoom, the detail region narrows to the center of the viewport
// so higher-zoom tiles can be loaded (like Google Earth's LOD system).
// The OSM street overlay fades in at close zoom with a "lighten" blend,
// making roads, labels, and building outlines visible over the satellite.
// ============================================================================

// — Configuration ————————————————————————————————————————————————————————————

const ESRI_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const OSM_TILE_URL =
  'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';

const BASE_ZOOM = 4;              // 16×16 = 256 tiles → 4096×4096
const DETAIL_MIN_ZOOM = 5;        // Lowest detail tier
const DETAIL_MAX_ZOOM = 19;       // ESRI serves up to ~19 in populated areas
const DETAIL_MAX_TILES = 512;     // Hard cap (~22×22)
const DETAIL_TILES_PER_DIM = 12;  // Target tiles per viewport dimension
const DETAIL_ZOOM_THRESHOLD = 0.55; // zoomLevel < this triggers detail (0=close,1=far)
const DETAIL_DEBOUNCE_MS = 350;   // Fast response
const DETAIL_VIEWPORT_PAD = 0.25; // 25 % prefetch padding
const MAX_CONCURRENT = 16;
const TILE_SIZE = 256;

// Center-crop: when close, narrow detail region to center for higher-res tiles
const CLOSE_ZOOM_THRESHOLD = 0.25;  // Below this zoomLevel, start center-cropping
const CLOSE_CROP_MIN = 0.12;        // At closest zoom, use 12% of viewport span

// OSM street overlay
const OSM_ZOOM_THRESHOLD = 0.18;    // zoomLevel < this shows OSM overlay (0=close,1=far)
const OSM_MIN_ZOOM = 10;
const OSM_MAX_ZOOM = 19;
const OSM_MAX_TILES = 256;
const OSM_TILES_PER_DIM = 10;
const OSM_DEBOUNCE_MS = 400;
const OSM_VIEWPORT_PAD = 0.15;

// How many tiles loaded before we start showing the new detail (progressive)
const PROGRESSIVE_SHOW_AFTER = 4;

// — Tile config type ————————————————————————————————————————————————————————

interface TileConfig {
  tileUrl: string;
  minZoom: number;
  maxZoom: number;
  tilesPerDim: number;
  maxTiles: number;
  viewportPad: number;
}

const ESRI_CONFIG: TileConfig = {
  tileUrl: ESRI_TILE_URL,
  minZoom: DETAIL_MIN_ZOOM,
  maxZoom: DETAIL_MAX_ZOOM,
  tilesPerDim: DETAIL_TILES_PER_DIM,
  maxTiles: DETAIL_MAX_TILES,
  viewportPad: DETAIL_VIEWPORT_PAD,
};

const OSM_CONFIG: TileConfig = {
  tileUrl: OSM_TILE_URL,
  minZoom: OSM_MIN_ZOOM,
  maxZoom: OSM_MAX_ZOOM,
  tilesPerDim: OSM_TILES_PER_DIM,
  maxTiles: OSM_MAX_TILES,
  viewportPad: OSM_VIEWPORT_PAD,
};

// — Tile cache ———————————————————————————————————————————————————————————————

const tileImageCache = new Map<string, HTMLImageElement>();
const tileFetchPromises = new Map<string, Promise<HTMLImageElement | null>>();

function fetchTileImage(tileUrl: string, z: number, x: number, y: number): Promise<HTMLImageElement | null> {
  const url = tileUrl.replace('{z}', String(z)).replace('{y}', String(y)).replace('{x}', String(x));
  const cached = tileImageCache.get(url);
  if (cached) return Promise.resolve(cached);
  const inflight = tileFetchPromises.get(url);
  if (inflight) return inflight;

  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { tileImageCache.set(url, img); tileFetchPromises.delete(url); resolve(img); };
    img.onerror = () => { tileFetchPromises.delete(url); resolve(null); };
    img.src = url;
  });
  tileFetchPromises.set(url, promise);
  return promise;
}

async function fetchTilesBatch(
  tileUrl: string,
  tiles: Array<{ z: number; x: number; y: number }>,
  onTile?: (img: HTMLImageElement | null, t: { z: number; x: number; y: number }, idx: number) => void,
  signal?: { aborted: boolean },
): Promise<void> {
  let idx = 0;
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT, tiles.length) }, async () => {
    while (idx < tiles.length) {
      if (signal?.aborted) return;
      const i = idx++;
      const tile = tiles[i];
      const img = await fetchTileImage(tileUrl, tile.z, tile.x, tile.y);
      if (!signal?.aborted) onTile?.(img, tile, i);
    }
  });
  await Promise.all(workers);
}

// — Mercator helpers —————————————————————————————————————————————————————————

function latToMercY(lat: number): number {
  const r = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(Math.PI / 4 + r / 2)) / Math.PI) / 2;
}

// — Base texture (z=4, full globe, 4096×4096) ————————————————————————————————

let baseTexture: THREE.CanvasTexture | null = null;
let basePromise: Promise<THREE.CanvasTexture> | null = null;

function loadBaseTexture(
  onProgress?: (loaded: number, total: number) => void,
): Promise<THREE.CanvasTexture> {
  if (baseTexture) return Promise.resolve(baseTexture);
  if (basePromise) return basePromise;

  basePromise = (async () => {
    const n = 1 << BASE_ZOOM;
    const size = n * TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#080810';
    ctx.fillRect(0, 0, size, size);

    const tiles: Array<{ z: number; x: number; y: number }> = [];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        tiles.push({ z: BASE_ZOOM, x, y });

    let loaded = 0;
    await fetchTilesBatch(ESRI_TILE_URL, tiles, (img, tile) => {
      if (img) ctx.drawImage(img, tile.x * TILE_SIZE, tile.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      loaded++;
      onProgress?.(loaded, tiles.length);
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;

    baseTexture = tex;
    return tex;
  })();

  return basePromise;
}

// — Detail texture (viewport-adaptive, progressive) ——————————————————————————

interface DetailRegion {
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  xMin: number; xMax: number;
  yMin: number; yMax: number;
  tilesLoaded: number;
  tilesTotal: number;
  zoom: number;
}

/**
 * When zoomed close, narrow the detail region to the center of the viewport.
 * This lets pickDetailZoom select higher-zoom tiles for the area the user
 * is actually focused on (like Google Earth's LOD system).
 */
function focusDetailBounds(vp: ViewportBounds): ViewportBounds {
  if (vp.zoomLevel >= CLOSE_ZOOM_THRESHOLD) return vp;

  // Linear interpolation: at zoomLevel=0 → CLOSE_CROP_MIN, at threshold → 1.0
  const t = vp.zoomLevel / CLOSE_ZOOM_THRESHOLD;
  const fraction = CLOSE_CROP_MIN + t * (1 - CLOSE_CROP_MIN);

  const latSpan = (vp.maxLat - vp.minLat) * fraction;
  const lonSpan = (vp.maxLon - vp.minLon) * fraction;

  return {
    ...vp,
    minLat: Math.max(-85, vp.centerLat - latSpan / 2),
    maxLat: Math.min(85, vp.centerLat + latSpan / 2),
    minLon: Math.max(-180, vp.centerLon - lonSpan / 2),
    maxLon: Math.min(180, vp.centerLon + lonSpan / 2),
  };
}

/** Pick a zoom level that puts ~tilesPerDim tiles across the viewport. */
function pickZoom(vp: ViewportBounds, cfg: TileConfig): number {
  const lonSpan = Math.max(0.001, vp.maxLon - vp.minLon);
  const z = Math.ceil(Math.log2((360 / lonSpan) * cfg.tilesPerDim));
  return Math.max(cfg.minZoom, Math.min(cfg.maxZoom, z));
}

/** Build a debounce key with precision adaptive to the current zoom. */
function detailBoundsKey(vp: ViewportBounds, prefix: string): string {
  const latSpan = vp.maxLat - vp.minLat;
  const p = latSpan > 40 ? 0 : latSpan > 10 ? 1 : latSpan > 2 ? 2 : latSpan > 0.5 ? 3 : 4;
  return `${prefix}:${vp.minLat.toFixed(p)},${vp.maxLat.toFixed(p)},${vp.minLon.toFixed(p)},${vp.maxLon.toFixed(p)}`;
}

/**
 * Load tiles for a viewport region. Returns a DetailRegion whose texture
 * updates progressively as tiles stream in. Works with any tile provider.
 */
async function loadRegionTiles(
  vp: ViewportBounds,
  cfg: TileConfig,
  signal: { aborted: boolean },
  onEarlyReady?: (region: DetailRegion) => void,
): Promise<DetailRegion | null> {
  let zoom = pickZoom(vp, cfg);

  const latPad = (vp.maxLat - vp.minLat) * cfg.viewportPad;
  const lonPad = (vp.maxLon - vp.minLon) * cfg.viewportPad;
  const padded = {
    minLat: Math.max(-85, vp.minLat - latPad),
    maxLat: Math.min(85, vp.maxLat + latPad),
    minLon: Math.max(-180, vp.minLon - lonPad),
    maxLon: Math.min(180, vp.maxLon + lonPad),
  };

  // Find the highest zoom that fits under the tile budget
  let n = 1 << zoom;
  let xMin = Math.max(0, Math.floor(((padded.minLon + 180) / 360) * n));
  let xMax = Math.min(n - 1, Math.floor(((padded.maxLon + 180) / 360) * n));
  let yMin = Math.max(0, Math.floor(latToMercY(padded.maxLat) * n));
  let yMax = Math.min(n - 1, Math.floor(latToMercY(padded.minLat) * n));
  let cols = xMax - xMin + 1;
  let rows = yMax - yMin + 1;

  // Reduce zoom if tiles exceed budget
  while ((cols <= 0 || rows <= 0 || cols * rows > cfg.maxTiles) && zoom > cfg.minZoom) {
    zoom--;
    n = 1 << zoom;
    xMin = Math.max(0, Math.floor(((padded.minLon + 180) / 360) * n));
    xMax = Math.min(n - 1, Math.floor(((padded.maxLon + 180) / 360) * n));
    yMin = Math.max(0, Math.floor(latToMercY(padded.maxLat) * n));
    yMax = Math.min(n - 1, Math.floor(latToMercY(padded.minLat) * n));
    cols = xMax - xMin + 1;
    rows = yMax - yMin + 1;
  }

  if (cols <= 0 || rows <= 0 || cols * rows > cfg.maxTiles) return null;

  const canvas = document.createElement('canvas');
  canvas.width = cols * TILE_SIZE;
  canvas.height = rows * TILE_SIZE;
  const ctx = canvas.getContext('2d')!;

  // Start transparent so base shows through until tiles arrive
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.premultiplyAlpha = false;

  const region: DetailRegion = {
    texture: tex,
    canvas,
    xMin: xMin / n,
    xMax: (xMax + 1) / n,
    yMin: yMin / n,
    yMax: (yMax + 1) / n,
    tilesLoaded: 0,
    tilesTotal: cols * rows,
    zoom,
  };

  // Build ordered tile list — centre-out so the middle sharpens first.
  const tiles: Array<{ z: number; x: number; y: number }> = [];
  for (let y = yMin; y <= yMax; y++)
    for (let x = xMin; x <= xMax; x++)
      tiles.push({ z: zoom, x, y });

  const cx = (xMin + xMax) / 2;
  const cy = (yMin + yMax) / 2;
  tiles.sort((a, b) => {
    const da = (a.x - cx) ** 2 + (a.y - cy) ** 2;
    const db = (b.x - cx) ** 2 + (b.y - cy) ** 2;
    return da - db;
  });

  let notifiedEarly = false;

  await fetchTilesBatch(cfg.tileUrl, tiles, (img, tile, _idx) => {
    if (img) {
      ctx.drawImage(
        img,
        (tile.x - xMin) * TILE_SIZE,
        (tile.y - yMin) * TILE_SIZE,
        TILE_SIZE,
        TILE_SIZE,
      );
    }
    region.tilesLoaded++;
    tex.needsUpdate = true;

    if (!notifiedEarly && region.tilesLoaded >= Math.min(PROGRESSIVE_SHOW_AFTER, region.tilesTotal)) {
      notifiedEarly = true;
      onEarlyReady?.(region);
    }
  }, signal);

  if (signal.aborted) {
    tex.dispose();
    return null;
  }

  tex.needsUpdate = true;
  return region;
}

// — Shaders ——————————————————————————————————————————————————————————————————

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Fragment shader composites three layers:
//   1. Base satellite texture (full globe, low res)
//   2. Detail satellite texture (viewport region, higher res)
//   3. OSM street overlay (close zoom, lighten blend)
const fragmentShader = /* glsl */ `
uniform sampler2D baseTexture;
uniform sampler2D detailTexture;
uniform vec4  detailBounds;   // xMin, xMax, yMin, yMax  (Mercator 0-1)
uniform float detailMix;      // 0 = base only, 1 = full detail blend
uniform sampler2D osmTexture;
uniform vec4  osmBounds;      // xMin, xMax, yMin, yMax  (Mercator 0-1)
uniform float osmMix;         // 0 = no OSM, 1 = full OSM overlay
uniform float opacity;
varying vec2 vUv;

#define PI 3.141592653589793

void main() {
  float lat = (vUv.y - 0.5) * PI;
  if (abs(lat) > 1.4835) discard;
  float mercY = (1.0 - log(tan(PI / 4.0 + lat / 2.0)) / PI) / 2.0;
  vec2 mercUV = vec2(vUv.x, mercY);

  vec4 color = texture2D(baseTexture, mercUV);

  // --- Satellite detail overlay ---
  if (detailMix > 0.01) {
    float inX = step(detailBounds.x, mercUV.x) * step(mercUV.x, detailBounds.y);
    float inY = step(detailBounds.z, mercUV.y) * step(mercUV.y, detailBounds.w);
    if (inX * inY > 0.5) {
      vec2 dUV = vec2(
        (mercUV.x - detailBounds.x) / (detailBounds.y - detailBounds.x),
        (mercUV.y - detailBounds.z) / (detailBounds.w - detailBounds.z)
      );
      vec4 det = texture2D(detailTexture, dUV);
      float a = det.a * detailMix;
      color = mix(color, vec4(det.rgb, 1.0), a);
    }
  }

  // --- OSM street overlay (lighten blend) ---
  if (osmMix > 0.01) {
    float inX = step(osmBounds.x, mercUV.x) * step(mercUV.x, osmBounds.y);
    float inY = step(osmBounds.z, mercUV.y) * step(mercUV.y, osmBounds.w);
    if (inX * inY > 0.5) {
      vec2 oUV = vec2(
        (mercUV.x - osmBounds.x) / (osmBounds.y - osmBounds.x),
        (mercUV.y - osmBounds.z) / (osmBounds.w - osmBounds.z)
      );
      vec4 osm = texture2D(osmTexture, oUV);
      if (osm.a > 0.01) {
        // Lighten blend: show OSM features where they're brighter than satellite.
        // Dark OSM background naturally lets satellite show through.
        vec3 lightened = max(color.rgb, osm.rgb);
        color = vec4(mix(color.rgb, lightened, osmMix), 1.0);
      }
    }
  }

  gl_FragColor = vec4(color.rgb, opacity);
}
`;

// — Component ————————————————————————————————————————————————————————————————

export function SatelliteImageryLayer() {
  const [base, setBase] = useState<THREE.CanvasTexture | null>(baseTexture);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const currentOpacity = useRef(0);
  const currentDetailMix = useRef(0);
  const currentOsmMix = useRef(0);
  const setLayerState = useRadarStore((s) => s.setLayerState);
  const viewportBounds = useRadarStore((s) => s.viewportBounds);

  // Satellite detail state
  const detailRef = useRef<DetailRegion | null>(null);
  const prevDetailRef = useRef<DetailRegion | null>(null);
  const detailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailAbortRef = useRef<{ aborted: boolean }>({ aborted: false });
  const lastDetailKeyRef = useRef('');

  // OSM overlay state
  const osmRef = useRef<DetailRegion | null>(null);
  const prevOsmRef = useRef<DetailRegion | null>(null);
  const osmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const osmAbortRef = useRef<{ aborted: boolean }>({ aborted: false });
  const lastOsmKeyRef = useRef('');

  // ---- Helpers: push a region into shader uniforms ---------------------------

  const applyDetail = (region: DetailRegion | null) => {
    if (!materialRef.current) return;
    if (region) {
      materialRef.current.uniforms.detailTexture.value = region.texture;
      materialRef.current.uniforms.detailBounds.value.set(
        region.xMin, region.xMax, region.yMin, region.yMax,
      );
    }
  };

  const applyOsm = (region: DetailRegion | null) => {
    if (!materialRef.current) return;
    if (region) {
      materialRef.current.uniforms.osmTexture.value = region.texture;
      materialRef.current.uniforms.osmBounds.value.set(
        region.xMin, region.xMax, region.yMin, region.yMax,
      );
    }
  };

  // ---- Base texture ----------------------------------------------------------

  useEffect(() => {
    if (baseTexture) {
      setBase(baseTexture);
      setLayerState('satellite_imagery', { loaded: true, loading: false });
      return;
    }

    setLayerState('satellite_imagery', { loading: true });

    loadBaseTexture((loaded, total) => {
      setLayerState('satellite_imagery', { entityCount: Math.round((loaded / total) * 100) });
    }).then((t) => {
      setBase(t);
      setLayerState('satellite_imagery', { loaded: true, loading: false, entityCount: 0, error: null });
    }).catch((err) => {
      setLayerState('satellite_imagery', { loading: false, error: err?.message ?? 'load failed' });
    });
  }, [setLayerState]);

  // ---- Satellite detail texture (viewport-reactive, progressive) -------------

  useEffect(() => {
    if (!base || !viewportBounds) return;
    if (viewportBounds.zoomLevel > DETAIL_ZOOM_THRESHOLD) return;

    if (detailTimerRef.current) clearTimeout(detailTimerRef.current);

    detailTimerRef.current = setTimeout(() => {
      const detailVp = focusDetailBounds(viewportBounds);
      const key = detailBoundsKey(detailVp, 'sat');
      if (key === lastDetailKeyRef.current) return;
      lastDetailKeyRef.current = key;

      detailAbortRef.current.aborted = true;
      const signal = { aborted: false };
      detailAbortRef.current = signal;

      if (detailRef.current) {
        prevDetailRef.current?.texture.dispose();
        prevDetailRef.current = detailRef.current;
        detailRef.current = null;
      }

      loadRegionTiles(
        detailVp,
        ESRI_CONFIG,
        signal,
        (region) => {
          if (signal.aborted) return;
          prevDetailRef.current?.texture.dispose();
          prevDetailRef.current = null;
          detailRef.current = region;
          applyDetail(region);
        },
      ).then((region) => {
        if (signal.aborted) return;
        if (!region) return;
        if (detailRef.current !== region) {
          detailRef.current?.texture.dispose();
          prevDetailRef.current?.texture.dispose();
          prevDetailRef.current = null;
          detailRef.current = region;
          applyDetail(region);
        }
      });
    }, DETAIL_DEBOUNCE_MS);

    return () => {
      if (detailTimerRef.current) clearTimeout(detailTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, viewportBounds]);

  // ---- OSM street overlay (close zoom only) ---------------------------------

  useEffect(() => {
    if (!base || !viewportBounds) return;
    if (viewportBounds.zoomLevel > OSM_ZOOM_THRESHOLD) return;

    if (osmTimerRef.current) clearTimeout(osmTimerRef.current);

    osmTimerRef.current = setTimeout(() => {
      const key = detailBoundsKey(viewportBounds, 'osm');
      if (key === lastOsmKeyRef.current) return;
      lastOsmKeyRef.current = key;

      osmAbortRef.current.aborted = true;
      const signal = { aborted: false };
      osmAbortRef.current = signal;

      if (osmRef.current) {
        prevOsmRef.current?.texture.dispose();
        prevOsmRef.current = osmRef.current;
        osmRef.current = null;
      }

      loadRegionTiles(
        viewportBounds,
        OSM_CONFIG,
        signal,
        (region) => {
          if (signal.aborted) return;
          prevOsmRef.current?.texture.dispose();
          prevOsmRef.current = null;
          osmRef.current = region;
          applyOsm(region);
        },
      ).then((region) => {
        if (signal.aborted) return;
        if (!region) return;
        if (osmRef.current !== region) {
          osmRef.current?.texture.dispose();
          prevOsmRef.current?.texture.dispose();
          prevOsmRef.current = null;
          osmRef.current = region;
          applyOsm(region);
        }
      });
    }, OSM_DEBOUNCE_MS);

    return () => {
      if (osmTimerRef.current) clearTimeout(osmTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, viewportBounds]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      detailAbortRef.current.aborted = true;
      detailRef.current?.texture.dispose();
      prevDetailRef.current?.texture.dispose();
      detailRef.current = null;
      prevDetailRef.current = null;

      osmAbortRef.current.aborted = true;
      osmRef.current?.texture.dispose();
      prevOsmRef.current?.texture.dispose();
      osmRef.current = null;
      prevOsmRef.current = null;
    };
  }, []);

  // ---- Uniforms --------------------------------------------------------------

  const uniforms = useMemo(
    () => ({
      baseTexture: { value: base },
      detailTexture: { value: null as THREE.Texture | null },
      detailBounds: { value: new THREE.Vector4(0, 0, 0, 0) },
      detailMix: { value: 0 },
      osmTexture: { value: null as THREE.Texture | null },
      osmBounds: { value: new THREE.Vector4(0, 0, 0, 0) },
      osmMix: { value: 0 },
      opacity: { value: 0 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base],
  );

  // ---- Per-frame animation ---------------------------------------------------

  useFrame((_, delta) => {
    if (!materialRef.current) return;
    const u = materialRef.current.uniforms;

    // Globe opacity
    const opTarget = base ? 0.85 : 0;
    currentOpacity.current += (opTarget - currentOpacity.current) * Math.min(1, delta * 3);
    u.opacity.value = currentOpacity.current;

    const vp = useRadarStore.getState().viewportBounds;

    // Satellite detail mix
    const hasDetail = detailRef.current || prevDetailRef.current;
    const wantDetail = hasDetail && vp && vp.zoomLevel <= DETAIL_ZOOM_THRESHOLD;
    const dmTarget = wantDetail ? 1 : 0;
    currentDetailMix.current += (dmTarget - currentDetailMix.current) * Math.min(1, delta * 5);
    u.detailMix.value = currentDetailMix.current;

    // OSM overlay mix — smooth fade in/out
    const hasOsm = osmRef.current || prevOsmRef.current;
    const wantOsm = hasOsm && vp && vp.zoomLevel <= OSM_ZOOM_THRESHOLD;
    const osmTarget = wantOsm ? 1 : 0;
    currentOsmMix.current += (osmTarget - currentOsmMix.current) * Math.min(1, delta * 4);
    u.osmMix.value = currentOsmMix.current;
  });

  if (!base) return null;

  return (
    <mesh raycast={() => null}>
      <sphereGeometry args={[GLOBE.SATELLITE_IMAGERY_OFFSET, 256, 256]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}
