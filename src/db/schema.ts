import {
  pgTable,
  text,
  real,
  boolean,
  smallint,
  bigint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ============================================================================
// AIRCRAFT POSITIONS (upserted every ~10s by fetcher)
// ============================================================================

export const aircraftPositions = pgTable(
  'aircraft_positions',
  {
    icao24: text('icao24').primaryKey(),
    callsign: text('callsign'),
    // PostGIS GEOGRAPHY stored as raw lon/lat for ST_MakeEnvelope queries
    longitude: real('longitude').notNull(),
    latitude: real('latitude').notNull(),
    altitudeFt: real('altitude_ft'),
    geoAltitudeFt: real('geo_altitude_ft'),
    heading: real('heading'),
    speedKnots: real('speed_knots'),
    verticalRateFpm: real('vertical_rate_fpm'),
    onGround: boolean('on_ground').default(false),
    squawk: text('squawk'),
    spi: boolean('spi').default(false),
    positionSource: smallint('position_source').default(0),
    originCountry: text('origin_country'),
    isMilitary: boolean('is_military').default(false),
    lastContact: bigint('last_contact', { mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_aircraft_lon_lat').on(table.longitude, table.latitude),
    index('idx_aircraft_updated').on(table.updatedAt),
  ]
);

// ============================================================================
// AIRCRAFT METADATA (slow-changing, enriched by fetcher)
// ============================================================================

export const aircraftMetadata = pgTable('aircraft_metadata', {
  icao24: text('icao24').primaryKey(),
  typecode: text('typecode'),
  model: text('model'),
  operator: text('operator'),
  registration: text('registration'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow(),
});

// ============================================================================
// SATELLITE TLE DATA (refreshed every 4h by fetcher)
// ============================================================================

export const satelliteTle = pgTable('satellite_tle', {
  noradId: text('norad_id').primaryKey(),
  name: text('name').notNull(),
  tleLine1: text('tle_line1').notNull(),
  tleLine2: text('tle_line2').notNull(),
  tleGroup: text('tle_group'),
  intlDesignator: text('intl_designator'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow(),
});

// ============================================================================
// VESSEL POSITIONS (upserted every ~60s by fetcher from AIS data)
// ============================================================================

export const vesselPositions = pgTable(
  'vessel_positions',
  {
    mmsi: text('mmsi').primaryKey(),
    name: text('name'),
    longitude: real('longitude').notNull(),
    latitude: real('latitude').notNull(),
    heading: real('heading'),
    speed: real('speed'),
    course: real('course'),
    shipType: text('ship_type'),
    navStatus: smallint('nav_status'),
    destination: text('destination'),
    draught: real('draught'),
    imo: text('imo'),
    callsign: text('callsign'),
    flag: text('flag'),
    isMilitary: boolean('is_military').default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_vessel_lon_lat').on(table.longitude, table.latitude),
    index('idx_vessel_updated').on(table.updatedAt),
  ]
);

// ============================================================================
// NEWS EVENTS (fetched from GDELT every 5 minutes by fetcher)
// ============================================================================

export const newsEvents = pgTable(
  'news_events',
  {
    id: text('id').primaryKey(),
    headline: text('headline').notNull(),
    source: text('source').notNull(),
    url: text('url'),
    longitude: real('longitude').notNull(),
    latitude: real('latitude').notNull(),
    category: text('category').notNull(),
    severity: text('severity').notNull(),
    tone: real('tone'),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_news_lon_lat').on(table.longitude, table.latitude),
    index('idx_news_published').on(table.publishedAt),
  ]
);

// ============================================================================
// FETCHER BOOKKEEPING
// ============================================================================

export const fetcherState = pgTable('fetcher_state', {
  sourceId: text('source_id').primaryKey(),
  lastFetchAt: timestamp('last_fetch_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastError: text('last_error'),
  fetchCount: bigint('fetch_count', { mode: 'number' }).default(0),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type AircraftPosition = typeof aircraftPositions.$inferSelect;
export type AircraftMetadataRow = typeof aircraftMetadata.$inferSelect;
export type SatelliteTleRow = typeof satelliteTle.$inferSelect;
export type VesselPosition = typeof vesselPositions.$inferSelect;
export type NewsEventRow = typeof newsEvents.$inferSelect;
export type FetcherStateRow = typeof fetcherState.$inferSelect;
