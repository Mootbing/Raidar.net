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
export type FetcherStateRow = typeof fetcherState.$inferSelect;
