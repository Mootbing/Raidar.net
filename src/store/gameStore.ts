import { create } from 'zustand';
import { EntityRef } from '@/types/entities';
import { UI } from '@/config/constants';
import { LayerId, LayerState, getInitialLayerStates } from '@/types/layers';

// ============================================================================
// DATA INTERFACES
// ============================================================================

interface Position {
  latitude: number;
  longitude: number;
  altitude: number;
  heading: number;
  speed: number;
  verticalRate?: number;
  geoAltitude?: number;
}

interface Aircraft {
  id: string;
  callsign: string;
  type: string;
  position: Position;
  timestamp: number;
  isPlayerControlled?: boolean;
  originCountry?: string;
  onGround?: boolean;
  squawk?: string | null;
  spi?: boolean;
  positionSource?: number;
  lastContact?: number;
}

interface TrackWaypoint {
  time: number;
  latitude: number;
  longitude: number;
  altitude: number;
  heading: number;
}

interface FlightTrack {
  icao24: string;
  callsign: string;
  startTime: number;
  endTime: number;
  waypoints: TrackWaypoint[];
  fetchedAt: number;
  isLoading?: boolean;
  error?: string;
}

interface ViewportBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  centerLat: number;
  centerLon: number;
  zoomLevel: number;
}

interface Airport {
  icao: string;
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  elevation: number;
  type: 'large_airport' | 'medium_airport' | 'small_airport' | 'heliport' | 'seaplane_base' | 'closed';
  scheduled_service: boolean;
}

// ============================================================================
// INTERACTION STATE
// ============================================================================

interface FocusLocation {
  lat: number;
  lon: number;
  alt?: number;
}

// View modes for selected aircraft
type ViewMode = 'focus' | 'chase' | 'cockpit' | 'orbit' | 'top';

interface GameState {
  hoveredEntity: EntityRef | null;
  selectedEntity: EntityRef | null;
  focusLocation: FocusLocation | null;
  restoreCameraFlag: number; // Increment to trigger camera restore
  activeMode: 'all' | 'aircraft' | 'airport' | 'missile' | 'ship' | 'satellite' | 'dock';
  snapMode: boolean; // Snap mode for arrow key entity navigation
  viewMode: ViewMode; // Current view mode for selected aircraft
  isPlaying: boolean;
  isPaused: boolean;
  controlledAircraft: Set<string>;
  score: number;
  landedAircraft: string[];
  crashedAircraft: string[];
}

interface Toast {
  id: string;
  message: string;
  exiting: boolean;
}

// ============================================================================
// STORE INTERFACE
// ============================================================================

interface Store {
  // Entity data
  aircraft: Aircraft[];
  airports: Airport[];
  
  // Entity data actions
  setAircraft: (a: Aircraft[]) => void;
  removeAircraft: (ids: string[]) => void;
  fetchAirports: () => Promise<void>;
  airportsLoading: boolean;
  airportsError: string | null;
  
  // Interaction state
  gameState: GameState;
  
  // Entity actions
  hoverEntity: (ref: EntityRef | null) => void;
  selectEntity: (ref: EntityRef | null) => void;
  setFocusLocation: (loc: FocusLocation | null) => void;
  restoreCamera: () => void;
  setActiveMode: (mode: GameState['activeMode']) => void;
  toggleSnapMode: () => void;
  setViewMode: (mode: ViewMode) => void;
  cycleViewMode: (direction: 'next' | 'prev') => void;
  
  // Toast state
  toasts: Toast[];
  showToast: (message: string) => void;
  dismissToast: (id: string) => void;
  
  // Entity lookup
  getAircraftById: (id: string) => Aircraft | undefined;
  getAirportById: (icao: string) => Airport | undefined;
  getEntityByRef: (ref: EntityRef | null) => Aircraft | Airport | undefined;
  
  // Game actions
  startGame: () => void;
  endGame: () => void;
  takeControlOfAircraft: (id: string) => void;
  
  // Other state
  isPolling: boolean;
  setPolling: (p: boolean) => void;
  flightTracks: Map<string, FlightTrack>;
  fetchFlightTrack: (icao24: string) => Promise<void>;
  clearFlightTrack: (icao24: string) => void;
  viewportBounds: ViewportBounds | null;
  setViewportBounds: (bounds: ViewportBounds) => void;
  locationReady: boolean;
  setLocationReady: (ready: boolean) => void;
  
  // Intro animation phases: 'loading' -> 'borders' -> 'airports' -> 'aircraft' -> 'complete'
  introPhase: 'loading' | 'borders' | 'airports' | 'aircraft' | 'complete';
  setIntroPhase: (phase: 'loading' | 'borders' | 'airports' | 'aircraft' | 'complete') => void;

  // Loading progress (0-100) for syncing animations
  loadingProgress: number;
  setLoadingProgress: (progress: number) => void;

  // Layer management
  layers: Record<LayerId, LayerState>;
  toggleLayer: (id: LayerId) => void;
  setLayerEnabled: (id: LayerId, enabled: boolean) => void;
  setLayerState: (id: LayerId, state: Partial<LayerState>) => void;
  isLayerEnabled: (id: LayerId) => boolean;

  // Generic layer entity storage (for layers that don't have dedicated arrays)
  layerEntities: Record<string, any[]>; // eslint-disable-line @typescript-eslint/no-explicit-any
  setLayerEntities: (layerId: LayerId, entities: any[]) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  getLayerEntities: (layerId: LayerId) => any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export type { Aircraft, Position, TrackWaypoint, FlightTrack, ViewportBounds, Airport, ViewMode };
export type { LayerId, LayerState };

// ============================================================================
// STORE IMPLEMENTATION
// ============================================================================

export const useRadarStore = create<Store>((set, get) => ({
  // Entity data
  aircraft: [],
  airports: [],
  airportsLoading: false,
  airportsError: null,
  
  setAircraft: (aircraft) => set({ aircraft }),
  
  removeAircraft: (ids) => set((state) => ({
    aircraft: state.aircraft.filter((a) => !ids.includes(a.id)),
  })),
  
  // Interaction state
  gameState: {
    hoveredEntity: null,
    selectedEntity: null,
    focusLocation: null,
    restoreCameraFlag: 0,
    activeMode: 'all',
    snapMode: false,
    viewMode: 'focus',
    isPlaying: false,
    isPaused: false,
    controlledAircraft: new Set(),
    score: 0,
    landedAircraft: [],
    crashedAircraft: [],
  },
  
  // Toast state
  toasts: [],
  
  // Entity actions
  hoverEntity: (ref) => set((s) => ({
    gameState: { ...s.gameState, hoveredEntity: ref },
  })),
  
  selectEntity: (ref) => set((s) => ({
    gameState: { ...s.gameState, selectedEntity: ref },
  })),
  
  setFocusLocation: (loc) => set((s) => ({
    gameState: { ...s.gameState, focusLocation: loc },
  })),
  
  restoreCamera: () => set((s) => ({
    gameState: { ...s.gameState, restoreCameraFlag: s.gameState.restoreCameraFlag + 1, focusLocation: null },
  })),
  
  setActiveMode: (mode) => set((s) => ({
    gameState: { ...s.gameState, activeMode: mode },
  })),
  
  toggleSnapMode: () => {
    const newSnapMode = !get().gameState.snapMode;
    set((s) => ({
      gameState: { ...s.gameState, snapMode: newSnapMode },
    }));
    // Show toast when toggling
    get().showToast(newSnapMode ? 'SNAP MODE ON' : 'SNAP MODE OFF');
  },
  
  setViewMode: (mode) => {
    set((s) => ({
      gameState: { ...s.gameState, viewMode: mode },
    }));
  },
  
  cycleViewMode: (direction) => {
    const viewModes: ViewMode[] = ['focus', 'chase', 'cockpit', 'orbit', 'top'];
    const currentMode = get().gameState.viewMode;
    const currentIndex = viewModes.indexOf(currentMode);
    
    let newIndex: number;
    if (direction === 'next') {
      newIndex = (currentIndex + 1) % viewModes.length;
    } else {
      newIndex = (currentIndex - 1 + viewModes.length) % viewModes.length;
    }
    
    const newMode = viewModes[newIndex];
    set((s) => ({
      gameState: { ...s.gameState, viewMode: newMode },
    }));
    
    // Show toast with view mode name
    const modeLabels: Record<ViewMode, string> = {
      focus: 'FOCUS VIEW',
      chase: 'CHASE VIEW',
      cockpit: 'COCKPIT VIEW',
      orbit: 'ORBIT VIEW',
      top: 'TOP VIEW',
    };
    get().showToast(modeLabels[newMode]);
  },
  
  showToast: (message) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newToast: Toast = { id, message, exiting: false };
    
    set((s) => ({ toasts: [...s.toasts, newToast] }));
    
    // Start exit animation after display duration
    setTimeout(() => {
      set((s) => ({
        toasts: s.toasts.map(t => t.id === id ? { ...t, exiting: true } : t)
      }));
    }, UI.TOAST.DISPLAY_DURATION);
    
    // Remove from DOM after exit animation completes
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter(t => t.id !== id) }));
    }, UI.TOAST.DISPLAY_DURATION + UI.TOAST.EXIT_ANIM_DURATION);
  },
  
  dismissToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter(t => t.id !== id) }));
  },
  
  // Entity lookup
  getAircraftById: (id) => get().aircraft.find(a => a.id === id),
  
  getAirportById: (icao) => get().airports.find(a => a.icao === icao),
  
  getEntityByRef: (ref) => {
    if (!ref) return undefined;
    switch (ref.type) {
      case 'aircraft':
        return get().getAircraftById(ref.id);
      case 'airport':
        return get().getAirportById(ref.id);
      default: {
        // Check generic layer entities
        const layerMap: Record<string, string> = {
          ship: 'maritime',
          satellite: 'satellites',
          dock: 'docks',
          news_event: 'news',
        };
        const layerId = layerMap[ref.type];
        if (layerId) {
          const entities = get().layerEntities[layerId] ?? [];
          return entities.find((e: any) => e.id === ref.id); // eslint-disable-line @typescript-eslint/no-explicit-any
        }
        return undefined;
      }
    }
  },
  
  // Game actions
  startGame: () => set((s) => ({ 
    gameState: { ...s.gameState, isPlaying: true, score: 0 } 
  })),
  
  endGame: () => set((s) => ({ 
    gameState: { ...s.gameState, isPlaying: false } 
  })),
  
  takeControlOfAircraft: (id) =>
    set((s) => {
      const c = new Set(s.gameState.controlledAircraft);
      c.add(id);
      return {
        gameState: { ...s.gameState, controlledAircraft: c },
        aircraft: s.aircraft.map((a) => (a.id === id ? { ...a, isPlayerControlled: true } : a)),
      };
    }),
  
  // Other state
  isPolling: true,
  setPolling: (isPolling) => set({ isPolling }),
  
  flightTracks: new Map(),
  
  fetchFlightTrack: async (icao24: string) => {
    const { flightTracks, aircraft } = get();
    
    const existing = flightTracks.get(icao24);
    if (existing && !existing.error && Date.now() - existing.fetchedAt < 60000) {
      return;
    }
    
    if (existing?.isLoading) {
      return;
    }
    
    const isMockAircraft = icao24.startsWith('mock_');
    
    const newTracks = new Map(flightTracks);
    newTracks.set(icao24, {
      icao24,
      callsign: '',
      startTime: 0,
      endTime: 0,
      waypoints: [],
      fetchedAt: Date.now(),
      isLoading: true,
    });
    set({ flightTracks: newTracks });
    
    if (isMockAircraft) {
      const mockAircraft = aircraft.find(a => a.id === icao24);
      if (mockAircraft) {
        const waypoints: TrackWaypoint[] = [];
        const { latitude, longitude, altitude, heading, speed } = mockAircraft.position;
        
        const now = Date.now();
        const waypointCount = 20;
        const totalMinutes = 30;
        
        for (let i = waypointCount; i >= 0; i--) {
          const minutesAgo = (i / waypointCount) * totalMinutes;
          const time = now - minutesAgo * 60 * 1000;
          
          const speedDegPerMin = (speed / 60) / 60;
          const distance = speedDegPerMin * minutesAgo;
          
          const reverseHeadingRad = ((heading + 180) % 360) * (Math.PI / 180);
          
          const jitter = (Math.random() - 0.5) * 0.02;
          const pastLat = latitude + distance * Math.cos(reverseHeadingRad) + jitter;
          const pastLon = longitude + distance * Math.sin(reverseHeadingRad) + jitter;
          
          const altVariation = (Math.random() - 0.5) * 2000;
          const pastAlt = Math.max(5000, altitude + altVariation * (minutesAgo / totalMinutes));
          
          waypoints.push({
            time: Math.floor(time / 1000),
            latitude: Math.max(-90, Math.min(90, pastLat)),
            longitude: ((pastLon + 180) % 360) - 180,
            altitude: pastAlt,
            heading: heading + (Math.random() - 0.5) * 5,
          });
        }
        
        const updatedTracks = new Map(get().flightTracks);
        updatedTracks.set(icao24, {
          icao24,
          callsign: mockAircraft.callsign,
          startTime: Math.floor((now - totalMinutes * 60 * 1000) / 1000),
          endTime: Math.floor(now / 1000),
          waypoints,
          fetchedAt: Date.now(),
          isLoading: false,
        });
        set({ flightTracks: updatedTracks });
        return;
      }
    }
    
    try {
      const res = await fetch(`https://opensky-network.org/api/tracks/all?icao24=${icao24}&time=0`, {
        headers: { 'Accept': 'application/json' },
      });
      
      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }
      
      const data = await res.json();
      
      if (!data.path || data.path.length === 0) {
        throw new Error('No track data available');
      }
      
      const waypoints: TrackWaypoint[] = data.path
        .filter((p: number[]) => p[1] != null && p[2] != null)
        .map((p: number[]) => ({
          time: p[0],
          latitude: p[1],
          longitude: p[2],
          altitude: (p[3] || 0) * 3.28084,
          heading: p[4] || 0,
        }));
      
      const updatedTracks = new Map(get().flightTracks);
      updatedTracks.set(icao24, {
        icao24: data.icao24 || icao24,
        callsign: data.callsign || '',
        startTime: data.startTime || 0,
        endTime: data.endTime || 0,
        waypoints,
        fetchedAt: Date.now(),
        isLoading: false,
      });
      set({ flightTracks: updatedTracks });
      
    } catch (error) {
      console.log('Failed to fetch flight track:', error);
      const updatedTracks = new Map(get().flightTracks);
      updatedTracks.set(icao24, {
        icao24,
        callsign: '',
        startTime: 0,
        endTime: 0,
        waypoints: [],
        fetchedAt: Date.now(),
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      set({ flightTracks: updatedTracks });
    }
  },
  
  clearFlightTrack: (icao24: string) => {
    const newTracks = new Map(get().flightTracks);
    newTracks.delete(icao24);
    set({ flightTracks: newTracks });
  },
  
  viewportBounds: null,
  setViewportBounds: (bounds) => set({ viewportBounds: bounds }),
  
  locationReady: false,
  setLocationReady: (ready) => set({ locationReady: ready }),
  
  // Intro animation
  introPhase: 'loading',
  setIntroPhase: (phase) => set({ introPhase: phase }),
  
  // Loading progress
  loadingProgress: 0,
  setLoadingProgress: (progress) => set({ loadingProgress: progress }),
  
  // Layer management
  layers: getInitialLayerStates(),

  toggleLayer: (id) => {
    set((s) => ({
      layers: {
        ...s.layers,
        [id]: { ...s.layers[id], enabled: !s.layers[id].enabled },
      },
    }));
  },

  setLayerEnabled: (id, enabled) => {
    set((s) => ({
      layers: {
        ...s.layers,
        [id]: { ...s.layers[id], enabled },
      },
    }));
  },

  setLayerState: (id, state) => {
    set((s) => ({
      layers: {
        ...s.layers,
        [id]: { ...s.layers[id], ...state },
      },
    }));
  },

  isLayerEnabled: (id) => get().layers[id]?.enabled ?? false,

  // Generic layer entity storage
  layerEntities: {},

  setLayerEntities: (layerId, entities) => {
    set((s) => ({
      layerEntities: { ...s.layerEntities, [layerId]: entities },
    }));
  },

  getLayerEntities: (layerId) => get().layerEntities[layerId] ?? [],

  fetchAirports: async () => {
    const { airports, airportsLoading } = get();
    
    if (airports.length > 0 || airportsLoading) {
      return;
    }
    
    set({ airportsLoading: true, airportsError: null });
    
    try {
      const res = await fetch('/api/airports');
      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }
      
      const data = await res.json();
      console.log(`[Airports] Loaded ${data.airports.length} airports`);
      
      set({ 
        airports: data.airports, 
        airportsLoading: false 
      });
    } catch (error) {
      console.error('[Airports] Failed to fetch:', error);
      set({ 
        airportsLoading: false, 
        airportsError: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  },
}));
