'use client';

import { Canvas } from '@react-three/fiber';
import { PerspectiveCamera, AdaptiveDpr } from '@react-three/drei';
import { Globe } from './Globe';
import { CountryBorders } from './CountryBorders';
import { AircraftLayerInstanced } from './AircraftLayerInstanced';
import { AirportsLayer } from './AirportsLayer';
import { CameraController } from './CameraController';
import { ViewportTracker } from './ViewportTracker';
import { MaritimeLayer } from './layers/MaritimeLayer';
import { SatelliteLayer } from './layers/SatelliteLayer';
import { DocksLayer } from './layers/DocksLayer';
import { BorderHighlightLayer } from './layers/BorderHighlightLayer';
import { NewsLayer } from './layers/NewsLayer';
import { Suspense } from 'react';
import { COLORS, CAMERA } from '@/config/constants';
import { useRadarStore } from '@/store/gameStore';
import { LayerId } from '@/types/layers';

function LoadingFallback() {
  return (
    <mesh>
      <sphereGeometry args={[1, 16, 16]} />
      <meshBasicMaterial color={COLORS.GLOBE_SURFACE} wireframe />
    </mesh>
  );
}

/**
 * Renders children only when the given layer is enabled.
 * Entities inside each layer self-manage viewport visibility via useLayerData.
 */
function Layer({ id, children }: { id: LayerId; children: React.ReactNode }) {
  const enabled = useRadarStore((s) => s.layers[id]?.enabled);
  if (!enabled) return null;
  return <>{children}</>;
}

export function Scene() {
  return (
    <div className="w-screen h-screen absolute inset-0 overflow-hidden" style={{ touchAction: 'none' }}>
      <Canvas
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 2]}
        resize={{ scroll: false, debounce: { scroll: 50, resize: 50 } }}
        style={{ width: '100%', height: '100%', touchAction: 'none' }}
      >
        <color attach="background" args={[COLORS.BG_DARK]} />
        <PerspectiveCamera makeDefault position={[0, 0, CAMERA.DEFAULT_DISTANCE]} fov={60} />
        <AdaptiveDpr pixelated />
        <Suspense fallback={<LoadingFallback />}>
          {/* Base layers */}
          <Globe />
          <CountryBorders />
          <Layer id="border_highlight">
            <BorderHighlightLayer />
          </Layer>

          {/* Infrastructure layers */}
          <AirportsLayer />
          <Layer id="docks">
            <DocksLayer />
          </Layer>

          {/* Traffic layers — entities only render in viewport via useLayerData */}
          <AircraftLayerInstanced />
          <Layer id="maritime">
            <MaritimeLayer />
          </Layer>
          <Layer id="satellites">
            <SatelliteLayer />
          </Layer>

          {/* Intel layers */}
          <Layer id="news">
            <NewsLayer />
          </Layer>
        </Suspense>
        <CameraController />
        <ViewportTracker />
      </Canvas>
    </div>
  );
}
