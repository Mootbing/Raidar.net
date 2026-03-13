/**
 * Centralized configuration for all magic numbers and constants
 * Organized by feature/component area
 */

// =============================================================================
// CAMERA SETTINGS
// =============================================================================

export const CAMERA = {
  // Distance limits
  MIN_DISTANCE: 1.05,
  MAX_DISTANCE: 5,
  DEFAULT_DISTANCE: 2.5,
  CITY_ZOOM_DISTANCE: 1.15,
  PATH_VIEW_DISTANCE: 1.25,
  FLYOVER_ZOOM_OUT: 2.2,
  
  // Follow cam
  FOLLOW_DISTANCE: 0.04,
  FOLLOW_LOOK_AHEAD: 0.01,
  
  // Controls
  ZOOM_SPEED_KEYBOARD: 0.7,
  ZOOM_SPEED_TRACKPAD: 0.4,
  PAN_SPEED: 0.3,
  ROTATE_SPEED_MIN: 0.08,
  ROTATE_SPEED_MAX: 0.8,
  
  // Animation
  SLANT_ANGLE: 0.4,
  YAW_SPEED: 0.4,

  // View modes (camera tracking for selected aircraft)
  VIEW_CHASE_DISTANCE: 0.05,
  VIEW_CHASE_HEIGHT: 0.015,
  VIEW_COCKPIT_HEIGHT: 0.002,
  VIEW_COCKPIT_LOOK_AHEAD: 0.04,
  VIEW_TOP_HEIGHT: 0.06,
  VIEW_ORBIT_DISTANCE: 0.05,
  VIEW_ORBIT_HEIGHT: 0.015,
  VIEW_ORBIT_SPEED: 0.5,
  VIEW_LERP_SPEED: 4,
} as const;

// =============================================================================
// DEFAULT LOCATIONS
// =============================================================================

export const LOCATIONS = {
  DEFAULT: { lat: 33.0, lon: 44.0 }, // Middle East (Iraq center)
} as const;

// =============================================================================
// GLOBE / 3D POSITIONING
// =============================================================================

export const GLOBE = {
  ALTITUDE_SCALE: 0.0000005,
  AIRPORT_SURFACE_OFFSET: 1.001,
  DOCK_SURFACE_OFFSET: 1.001,
  SATELLITE_IMAGERY_OFFSET: 1.001,
  BORDER_SURFACE_OFFSET: 1.002,
  BORDER_HIGHLIGHT_OFFSET: 1.003,
  NEWS_SURFACE_OFFSET: 1.004,
  MARITIME_SURFACE_OFFSET: 1.001,
  SATELLITE_MIN_ALTITUDE: 1.05,   // LEO rendered close to surface
  SATELLITE_MAX_ALTITUDE: 1.5,    // GEO rendered further out
  EARTH_RADIUS_KM: 6371,
  EARTH_CIRCUMFERENCE_KM: 2 * Math.PI * 6371,
} as const;

// =============================================================================
// AIRCRAFT RENDERING
// =============================================================================

export const AIRCRAFT = {
  // Geometry sizes
  SIMPLE_TRIANGLE_SIZE: 0.006,
  DETAILED_PLANE_SIZE: 0.008,
  HITBOX_SIZE: 0.02,
  
  // LOD (Level of Detail)
  LOD_THRESHOLD: 500,
  
  // Viewport edge fading
  EDGE_FADE_ZONE: 0.05,
  
  // Deloading
  DELOAD_GRACE_PERIOD: 5000,
  DELOAD_CHECK_INTERVAL: 2000,
  
  // Dead reckoning
  PREDICTION_MAX_SECONDS: 120,
  MIN_SPEED_FOR_PREDICTION: 10,
  
  // Animation
  FADE_IN_STAGGER_DURATION: 1.2,
  FADE_IN_INDIVIDUAL_DURATION: 0.4,
  
  // Scaling
  SCALE_SELECTED: 1.8,
  SCALE_HOVERED: 1.6,
  ZOOM_SCALE_FACTOR: 5,
  ZOOM_SCALE_MIN: 0.2,
  ZOOM_SCALE_MAX: 1.2,
  
  // Smoothing
  VISIBILITY_SMOOTH_FACTOR: 4,
  VISIBILITY_SMOOTH_MAX: 0.25,
  OPACITY_SMOOTH_FACTOR: 3,
  OPACITY_SMOOTH_MAX: 0.2,
} as const;

// =============================================================================
// AIRPORT RENDERING
// =============================================================================

export const AIRPORTS = {
  // Geometry sizes
  LARGE_AIRPORT_SIZE: 0.0025,
  SMALL_AIRPORT_SIZE: 0.0012,
  
  // Visibility
  SMALL_AIRPORT_FADE_DISTANCE: 1.25,
  SMALL_AIRPORT_FADE_SPEED: 3,
  SMALL_AIRPORT_MAX_OPACITY: 0.5,
  LARGE_AIRPORT_MAX_OPACITY: 1,
  
  // Animation - diagonal sweep from top-left to bottom-right
  FADE_IN_STAGGER_DURATION: 2.5,    // Total duration for nth-child style stagger across all airports
  RIPPLE_DURATION: 0.6,             // Individual airport animation duration
  RIPPLE_OVERSHOOT: 2.2,            // Bigger overshoot: small → BIG → normal
  RIPPLE_MIN_SCALE: 0.1,            // Start barely visible
  RIPPLE_MIN_OPACITY: 0.2,          // Start low opacity
  OPACITY_SMOOTH_FACTOR: 4,
} as const;

// =============================================================================
// DOCK / PORT RENDERING
// =============================================================================

export const DOCKS = {
  // Geometry sizes
  MARKER_SIZE: 0.002,

  // Visibility
  MAX_OPACITY: 0.85,
  SMALL_PORT_FADE_DISTANCE: 1.35,   // Small ports fade at this camera distance
  SMALL_PORT_FADE_SPEED: 3,

  // Animation - diagonal sweep (same pattern as airports)
  FADE_IN_STAGGER_DURATION: 2.5,
  RIPPLE_DURATION: 0.6,
  RIPPLE_OVERSHOOT: 2.2,
  RIPPLE_MIN_SCALE: 0.1,
  RIPPLE_MIN_OPACITY: 0.2,
  OPACITY_SMOOTH_FACTOR: 4,

  // Colors — all docks render blue; hover overrides
  COLOR_CONTAINER: '#4488ff',
  COLOR_BULK: '#4488ff',
  COLOR_NAVAL: '#4488ff',
  COLOR_OIL_TERMINAL: '#4488ff',
  COLOR_MIXED: '#4488ff',
  COLOR_HOVERED: '#00ff66',
} as const;

// =============================================================================
// COUNTRY BORDERS
// =============================================================================

export const BORDERS = {
  DRAW_DURATION: 3.5,   // Seconds - synced to finish when loading completes (0% → 100%)
  DRAW_OPACITY: 0.25,   // Opacity while drawing (25%)
  FINAL_OPACITY: 1.0,   // Opacity after drawing complete (100%)
  FADE_IN_DURATION: 0.8, // Seconds to fade from DRAW_OPACITY to FINAL_OPACITY
} as const;

// =============================================================================
// FLIGHT PATH RENDERING
// =============================================================================

export const FLIGHT_PATH = {
  ANIMATION_DURATION: 0.3,
  TRAVELED_RATIO: 0.5,
  PREDICTED_RATIO: 0.5,
  PREDICT_MINUTES: 10,
  HISTORY_MINUTES: 30,
  
  // Line styling
  TRAVELED_OPACITY: 0.9,
  PREDICTED_OPACITY: 0.5,
  DASH_SIZE: 0.002,
  GAP_SIZE: 0.004,
} as const;

// =============================================================================
// DATA POLLING
// =============================================================================

export const POLLING = {
  BASE_INTERVAL: 15000,
  MAX_BACKOFF_MULTIPLIER: 8,
  DEBOUNCE_VIEWPORT_CHANGE: 300,
  FLIGHT_TRACK_CACHE_TTL: 60000,
  // Lazy loading - viewport-based
  VIEWPORT_PADDING_FACTOR: 1.5,     // Fetch 50% larger area than viewport for prefetching
  COVERAGE_THRESHOLD: 0.7,          // Re-fetch when <70% of viewport is covered by loaded region
  AIRCRAFT_CACHE_TTL: 120000,       // Keep aircraft in cache for 2 minutes
  CACHE_CLEANUP_INTERVAL: 30000,    // Clean stale cache entries every 30s
  MAX_FETCH_ZOOM: 0.85,             // Don't fetch when zoom level exceeds this (nearly whole globe)
} as const;

// =============================================================================
// INPUT CONTROLS
// =============================================================================

export const INPUT = {
  MOUSE: {
    PAN_SPEED: 0.5,
    ROTATE_SPEED: 0.5,
    DAMPING_FACTOR: 0.1,
  },
  KEYBOARD: {
    ZOOM_SPEED: 1.5,
    PAN_SPEED: 0.3,
    ZOOM_LIMIT_TOLERANCE: 0.001,
    ROTATE_ZOOM_SCALE: 0.2,
  },
  TOUCH: {
    PAN_SPEED: 0.5,
    ROTATE_SPEED: 0.5,
  },
  ANIMATION: {
    CAMERA_DIRECT_SPEED: 3.0,
    CAMERA_FLYOVER_SPEED: 2.0,
    FLYOVER_TRAVEL_THRESHOLD: 0.3,
    OFFSET_ZOOM_MULTIPLIER: 0.5,
    MIN_OFFSET_DISTANCE: 0.02,
  },
} as const;

// =============================================================================
// INTRO / LOADING ANIMATION
// =============================================================================

export const INTRO = {
  // Loading screen stage durations (ms)
  STAGES: [
    { text: 'ESTABLISHING_SECURE_CONNECTION', duration: 400 },
    { text: 'AUTHENTICATING_CLEARANCE_LEVEL', duration: 350 },
    { text: 'LOADING_SATELLITE_IMAGERY', duration: 500 },
    { text: 'CALIBRATING_RADAR_SYSTEMS', duration: 450 },
    { text: 'SYNCHRONIZING_FLIGHT_DATA', duration: 400 },
    { text: 'ACQUIRING_GPS_COORDINATES', duration: 600 },
    { text: 'INITIALIZING_TRACKING_MATRIX', duration: 350 },
    { text: 'SYSTEM_READY', duration: 300 },
  ],
  
  // Post-loading timing (ms)
  // Note: Airports animation is triggered by CameraController when camera lerp is 90% complete
  AIRCRAFT_DELAY: 400,          // Delay after locationReady before aircraft animate
  AIRCRAFT_DURATION: 1200,
  
  // Loading screen fade
  FADE_DURATION: 700,
  FADE_DELAY: 200,
  
  // Progress animation
  PROGRESS_INTERVAL: 50,
  PROGRESS_SMOOTH_FACTOR: 0.15,
  PROGRESS_JITTER: 3,
  
  // Camera lerp when location determined
  CAMERA_LERP_DURATION: 1.5,    // Seconds to animate camera to user location
} as const;

// =============================================================================
// UI / INTERACTION
// =============================================================================

export const UI = {
  // Mode bar
  TAB_HOLD_THRESHOLD: 300,
  
  // Search
  SEARCH_DEBOUNCE: 300,
  SEARCH_MAX_RESULTS: 30,
  
  // Entity snapping
  SNAP_MAX_DISTANCE: 30,
  SNAP_MIN_DISTANCE: 0.5,
  HOVER_SNAP_DISTANCE: 25,
  
  // Entity info panel
  INFO_PANEL_WIDTH: 300,
  INFO_PANEL_MAX_HEIGHT: 600,
  INFO_PANEL_ANIM_DURATION: 300,
  
  // Toast notifications
  TOAST: {
    DISPLAY_DURATION: 1200,
    EXIT_ANIM_DURATION: 300,
    STAGGER_DELAY: 30,
    MIN_OPACITY: 0.25,
    OPACITY_DECAY: 0.12,
    BG_OPACITY_BASE: 0.7,
    BG_OPACITY_STEP: 0.03,
  },
  
  // Bottom bar
  BOTTOM_BAR_ANIM_DELAY: 900,
  BOTTOM_BAR_ITEM_STAGGER: 0.12,
  
  // Prediction update interval
  PREDICTION_UPDATE_INTERVAL: 100,
} as const;

// =============================================================================
// COLORS
// =============================================================================

export const COLORS = {
  // Aircraft
  AIRCRAFT_DEFAULT: '#00ff88',
  AIRCRAFT_SELECTED: '#00ddff',
  AIRCRAFT_HOVERED: '#00ffcc',
  AIRCRAFT_MILITARY: '#ff6644',
  
  // Airports
  AIRPORT_DEFAULT: '#ffffff',
  AIRPORT_HOVERED: '#00ff66',
  
  // Mode bar
  MODE_ALL: { active: '#66aaff', inactive: '#335577', highlighted: '#88ccff' },
  MODE_AIRCRAFT: { active: '#00ff88', inactive: '#005533', highlighted: '#66ffaa' },
  MODE_AIRPORT: { active: '#ffffff', inactive: '#555555', highlighted: '#cccccc' },
  MODE_MISSILE: { active: '#ff4444', inactive: '#552222', highlighted: '#ff6666' },

  // Layer colors
  LAYER_MARITIME: '#4488ff',
  LAYER_SATELLITE: '#ff66aa',
  LAYER_DOCKS: '#88ccff',
  LAYER_NEWS: '#ffcc00',
  LAYER_BORDER_HIGHLIGHT: '#ffaa00',
  
  // General UI
  UI_ACCENT: '#00ff88',
  UI_ACCENT_ALT: '#00ddff',
  UI_ACCENT_BLUE: '#66aaff',
  UI_WARNING: '#ffaa00',
  UI_ERROR: '#ff4444',
  
  // Text
  TEXT_PRIMARY: '#ffffff',
  TEXT_SECONDARY: '#888888',
  TEXT_MUTED: '#555555',
  TEXT_DIMMED: '#444444',
  TEXT_DARK: '#333333',
  
  // Backgrounds
  BG_DARK: '#000000',
  BG_OVERLAY: 'rgba(0, 0, 0, 0.8)',
  BG_GLASS: 'rgba(0, 0, 0, 0.3)',
  BG_ELEVATED: '#111111',
  BG_HOVER: '#222222',
  
  // Borders
  BORDER_DEFAULT: '#333333',
  BORDER_SUBTLE: '#1a1a1a',
  BORDER_FOCUS: 'rgba(0, 255, 136, 0.5)',
  
  // Status
  STATUS_ONLINE: '#00ff88',
  STATUS_OFFLINE: '#666666',
  
  // 3D
  GLOBE_SURFACE: '#000000',
  BORDERS_LINE: '#ffffff',
  FLIGHT_PATH: '#00ff88',

  // Military
  MILITARY: '#ff4444',

  // Satellites
  SATELLITE_DEFAULT: '#ff69b4',
  SATELLITE_HOVERED: '#ffb6c1',
  SATELLITE_SELECTED: '#ff1493',

  // Maritime
  MARITIME_DEFAULT: '#66aaff',
  MARITIME_SELECTED: '#00ff88',
  MARITIME_HOVERED: '#ffcc00',
  MARITIME_MILITARY: '#ff4444',

  // News severity
  NEWS_LOW: '#00ff88',
  NEWS_MEDIUM: '#ffcc00',
  NEWS_HIGH: '#ff8800',
  NEWS_CRITICAL: '#ff2222',

  // AI mode bar
  MODE_AI_AGENT: { active: '#ff4444', inactive: '#442222', highlighted: '#ff6666' },
  MODE_AI_PLAN: { active: '#ffaa00', inactive: '#443300', highlighted: '#ffcc33' },
  MODE_AI_ASK: { active: '#00cc66', inactive: '#224422', highlighted: '#33ff88' },

  // Misc
  TILE_MISSING: '#0a0a12',
  HITBOX: '#ffffff',
} as const;

// =============================================================================
// TYPOGRAPHY
// =============================================================================

export const TYPOGRAPHY = {
  // Font sizes (in Tailwind notation for easy use)
  SIZE_XS: '8px',
  SIZE_SM: '9px',
  SIZE_BASE: '10px',
  SIZE_MD: '11px',
  SIZE_LG: '12px',
  SIZE_XL: '14px',
  SIZE_2XL: '16px',
  
  // Font families (CSS values)
  FONT_MONO: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  
  // Letter spacing
  TRACKING_TIGHT: '0.05em',
  TRACKING_NORMAL: '0.1em',
  TRACKING_WIDE: '0.15em',
  TRACKING_WIDER: '0.2em',
  TRACKING_WIDEST: '0.25em',
} as const;

// =============================================================================
// Z-INDEX LAYERS
// =============================================================================

export const Z_INDEX = {
  GLOBE: 0,
  BORDERS: 1,
  BORDER_HIGHLIGHT: 1.5,
  DOCKS: 2,
  AIRPORTS: 2,
  MARITIME: 3,
  AIRCRAFT: 3,
  SATELLITES: 4,
  NEWS: 5,
  UI_OVERLAY: 10,
  MODAL: 50,
  TOAST: 60,
  LOADING: 100,
  ERROR: 99999,
} as const;
