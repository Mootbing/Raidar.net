// ============================================================================
// UNIFIED ENTITY SYSTEM
// All map objects (aircraft, airports, missiles, etc.) implement MapEntity
// ============================================================================

/**
 * All possible entity types in the system
 * Add new types here as the system expands
 */
export type EntityType =
  | 'aircraft'
  | 'airport'
  | 'missile'
  | 'radar'
  | 'sam_site'
  | 'ship'
  | 'satellite'
  | 'dock'
  | 'news_event'
  | 'draw_shape';

/**
 * Reference to an entity (type + id)
 * Used for hover/select state to avoid storing full entity objects
 */
export interface EntityRef {
  type: EntityType;
  id: string;
}

/**
 * Base position for all entities
 */
export interface GeoPosition {
  lat: number;
  lon: number;
  alt?: number;
}

/**
 * Base interface all map entities must implement
 */
export interface MapEntity {
  id: string;
  entityType: EntityType;
  position: GeoPosition;
}

// ============================================================================
// ENTITY TYPE DEFINITIONS
// Each entity type extends MapEntity with its specific properties
// ============================================================================

/**
 * Aircraft entity (extends existing Aircraft interface)
 */
export interface AircraftEntity extends MapEntity {
  entityType: 'aircraft';
  callsign: string;
  type: string;
  position: GeoPosition & {
    heading: number;
    speed: number;
    verticalRate?: number;
    geoAltitude?: number;
  };
  timestamp: number;
  isPlayerControlled?: boolean;
  originCountry?: string;
  onGround?: boolean;
  squawk?: string | null;
  spi?: boolean;
  positionSource?: number;
  lastContact?: number;
}

/**
 * Airport entity
 */
export interface AirportEntity extends MapEntity {
  entityType: 'airport';
  icao: string;
  iata: string;
  name: string;
  city: string;
  country: string;
  elevation: number;
  airportType: 'large_airport' | 'medium_airport' | 'small_airport' | 'heliport' | 'seaplane_base' | 'closed';
  scheduledService: boolean;
}

/**
 * Missile entity (placeholder for future)
 */
export interface MissileEntity extends MapEntity {
  entityType: 'missile';
  missileType: string;
  heading: number;
  speed: number;
  altitude: number;
  launchTime: number;
  targetId?: string;
  status: 'launched' | 'cruising' | 'terminal' | 'intercepted' | 'impact';
}

/**
 * Radar site entity (placeholder for future)
 */
export interface RadarEntity extends MapEntity {
  entityType: 'radar';
  name: string;
  range: number; // km
  isActive: boolean;
  detectedEntities: EntityRef[];
}

/**
 * SAM site entity (placeholder for future)
 */
export interface SamSiteEntity extends MapEntity {
  entityType: 'sam_site';
  name: string;
  range: number; // km
  missileCount: number;
  isActive: boolean;
  systemType: string;
}

/**
 * Ship entity — AIS vessel data
 */
export interface ShipEntity extends MapEntity {
  entityType: 'ship';
  name: string;
  shipType: string;
  heading: number;
  speed: number;
  flag: string;
  imo?: number;
  destination?: string;
  draught?: number;
}

/**
 * Satellite entity
 */
export interface SatelliteEntity extends MapEntity {
  entityType: 'satellite';
  name: string;
  noradId: string;
  orbitType: 'LEO' | 'MEO' | 'GEO' | 'HEO' | 'SSO';
  purpose: string;
  operator: string;
  launchDate?: string;
  speed: number; // km/s
  inclination: number; // degrees
  period: number; // minutes
  trajectory?: GeoPosition[]; // Predicted ground track
}

/**
 * Dock / Port entity
 */
export interface DockEntity extends MapEntity {
  entityType: 'dock';
  name: string;
  portCode: string;
  country: string;
  portType: 'container' | 'bulk' | 'naval' | 'mixed' | 'oil_terminal';
  capacity?: number;
  isActive: boolean;
  vesselCount?: number;
}

/**
 * News event entity (geolocated news)
 */
export interface NewsEventEntity extends MapEntity {
  entityType: 'news_event';
  headline: string;
  source: string;
  category: 'military' | 'security' | 'maritime' | 'aviation' | 'geopolitics' | 'natural_disaster';
  severity: 'low' | 'medium' | 'high' | 'critical';
  url?: string;
  publishedAt: number;
  expiresAt?: number;
}

/**
 * Draw shape entity (for user-drawn regions)
 */
export interface DrawShapeEntity extends MapEntity {
  entityType: 'draw_shape';
  shapeType: 'polygon' | 'circle' | 'rectangle' | 'freehand';
  points: GeoPosition[];
  style: {
    strokeColor: string;
    fillColor: string;
    fillOpacity: number;
    strokeWidth: number;
  };
  label?: string;
  createdAt: number;
}

/**
 * Union type of all entity types
 */
export type AnyEntity =
  | AircraftEntity
  | AirportEntity
  | MissileEntity
  | RadarEntity
  | SamSiteEntity
  | ShipEntity
  | SatelliteEntity
  | DockEntity
  | NewsEventEntity
  | DrawShapeEntity;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create an EntityRef from an entity
 */
export function toEntityRef(entity: MapEntity): EntityRef {
  return { type: entity.entityType, id: entity.id };
}

/**
 * Check if two EntityRefs are equal
 */
export function entityRefsEqual(a: EntityRef | null, b: EntityRef | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.type === b.type && a.id === b.id;
}

/**
 * Get display name for an entity type
 */
export function getEntityTypeName(type: EntityType): string {
  const names: Record<EntityType, string> = {
    aircraft: 'Aircraft',
    airport: 'Airport',
    missile: 'Missile',
    radar: 'Radar',
    sam_site: 'SAM Site',
    ship: 'Ship',
    satellite: 'Satellite',
    dock: 'Port',
    news_event: 'News',
    draw_shape: 'Shape',
  };
  return names[type];
}

/**
 * Get plural name for an entity type
 */
export function getEntityTypePluralName(type: EntityType): string {
  const names: Record<EntityType, string> = {
    aircraft: 'Aircraft',
    airport: 'Airports',
    missile: 'Missiles',
    radar: 'Radars',
    sam_site: 'SAM Sites',
    ship: 'Ships',
    satellite: 'Satellites',
    dock: 'Ports',
    news_event: 'News',
    draw_shape: 'Shapes',
  };
  return names[type];
}

