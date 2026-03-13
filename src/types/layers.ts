// ============================================================================
// LAYER MANAGEMENT SYSTEM
// Each feature (air traffic, maritime, satellites, etc.) is a toggleable layer
// ============================================================================

/**
 * All layer IDs in the system.
 * Add new layers here as the system expands.
 */
export type LayerId =
  | 'borders'
  | 'satellite_imagery'
  | 'airports'
  | 'aircraft'
  | 'maritime'
  | 'satellites'
  | 'docks'
  | 'news';

/**
 * Layer categories for grouping in the UI
 */
export type LayerCategory = 'base' | 'traffic' | 'infrastructure' | 'intel';

/**
 * Static configuration for a layer (doesn't change at runtime)
 */
export interface LayerConfig {
  id: LayerId;
  label: string;
  shortLabel: string;
  icon: string;
  color: string;
  defaultEnabled: boolean;
  lazy: boolean;
  category: LayerCategory;
  description: string;
}

/**
 * Runtime state of a layer (changes at runtime)
 */
export interface LayerState {
  enabled: boolean;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  entityCount: number;
}

// ============================================================================
// LAYER CONFIGURATIONS
// ============================================================================

export const LAYER_CONFIGS: Record<LayerId, LayerConfig> = {
  borders: {
    id: 'borders',
    label: 'COUNTRY BORDERS',
    shortLabel: 'BORDERS',
    icon: '◇',
    color: '#ffffff',
    defaultEnabled: true,
    lazy: false,
    category: 'base',
    description: 'Political boundaries and country borders',
  },
  satellite_imagery: {
    id: 'satellite_imagery',
    label: 'SATELLITE IMAGERY',
    shortLabel: 'IMAGERY',
    icon: '◉',
    color: '#44aaff',
    defaultEnabled: false,
    lazy: true,
    category: 'base',
    description: 'Earth satellite imagery overlay on globe',
  },
  airports: {
    id: 'airports',
    label: 'AIRPORTS',
    shortLabel: 'AIRPORTS',
    icon: '⬚',
    color: '#ffffff',
    defaultEnabled: true,
    lazy: false,
    category: 'infrastructure',
    description: 'Civilian and military airports worldwide',
  },
  aircraft: {
    id: 'aircraft',
    label: 'AIR TRAFFIC',
    shortLabel: 'AIR',
    icon: '✈',
    color: '#00ff88',
    defaultEnabled: true,
    lazy: false,
    category: 'traffic',
    description: 'Real-time aircraft positions and flight paths',
  },
  maritime: {
    id: 'maritime',
    label: 'MARITIME TRAFFIC',
    shortLabel: 'MARITIME',
    icon: '⚓',
    color: '#4488ff',
    defaultEnabled: true,
    lazy: true,
    category: 'traffic',
    description: 'Ship positions via AIS transponders',
  },
  satellites: {
    id: 'satellites',
    label: 'SATELLITES',
    shortLabel: 'SAT',
    icon: '◎',
    color: '#ff66aa',
    defaultEnabled: true,
    lazy: true,
    category: 'traffic',
    description: 'Overhead satellite positions and orbital tracks',
  },
  docks: {
    id: 'docks',
    label: 'SHIPPING DOCKS',
    shortLabel: 'DOCKS',
    icon: '⊞',
    color: '#88ccff',
    defaultEnabled: true,
    lazy: false,
    category: 'infrastructure',
    description: 'Major ports and shipping terminals',
  },
  news: {
    id: 'news',
    label: 'REAL-TIME NEWS',
    shortLabel: 'NEWS',
    icon: '▣',
    color: '#ffcc00',
    defaultEnabled: false,
    lazy: true,
    category: 'intel',
    description: 'Geolocated defense and security news',
  },
} as const;

/**
 * Get all layers in a category
 */
export function getLayersByCategory(category: LayerCategory): LayerConfig[] {
  return Object.values(LAYER_CONFIGS).filter(l => l.category === category);
}

/**
 * Get the initial layer states from configs
 */
export function getInitialLayerStates(): Record<LayerId, LayerState> {
  const states = {} as Record<LayerId, LayerState>;
  for (const config of Object.values(LAYER_CONFIGS)) {
    states[config.id] = {
      enabled: config.defaultEnabled,
      loaded: !config.lazy, // Non-lazy layers are considered "loaded" immediately
      loading: false,
      error: null,
      entityCount: 0,
    };
  }
  return states;
}

/**
 * Category display info
 */
export const LAYER_CATEGORIES: Record<LayerCategory, { label: string; order: number }> = {
  base: { label: 'BASE LAYERS', order: 0 },
  traffic: { label: 'TRAFFIC', order: 1 },
  infrastructure: { label: 'INFRASTRUCTURE', order: 2 },
  intel: { label: 'INTELLIGENCE', order: 3 },
};
