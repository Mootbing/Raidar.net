import { getDb } from '../db/client';
import { aircraftPositions, aircraftMetadata, fetcherState } from '../db/schema';
import { sql } from 'drizzle-orm';
import { inArray } from 'drizzle-orm';

// ============================================================================
// MILITARY DETECTION (ported from DataPoller.tsx)
// ============================================================================

const MILITARY_CALLSIGN_PREFIXES = [
  'RCH', 'DUKE', 'EVAC', 'CNV', 'NAVY', 'SPAR', 'SAM', 'EXEC',
  'PAT', 'HERKY', 'MOOSE', 'TOPCT', 'GOTHAM',
  'RRR', 'ASCOT', 'TARTN',  // RAF
  'GAF',                      // German Air Force
  'FAF',                      // French Air Force
  'IAM',                      // Italian Air Force
  'SHF',                      // Swedish Air Force
  'PLF',                      // Polish Air Force
  'BAF',                      // Belgian Air Force
  'HAF',                      // Hellenic Air Force
  'VIPER', 'COBRA', 'HAWK', 'JAKE', 'STEEL', 'ROCKY', 'THUD',
];

const MILITARY_OPERATORS_LOWER = [
  'air force', 'navy', 'army', 'marine', 'military',
  'luftwaffe', 'armee', 'armada', 'fuerza aerea',
  'defence', 'defense',
];

function detectMilitary(
  callsign: string,
  squawk: string | null,
  icao24: string,
  operator?: string | null,
): boolean {
  const cs = callsign.trim().toUpperCase();
  if (MILITARY_CALLSIGN_PREFIXES.some(p => cs.startsWith(p))) return true;

  if (squawk) {
    const sq = parseInt(squawk, 10);
    if (!isNaN(sq) && sq >= 7501 && sq <= 7577) return true;
  }

  const hex = parseInt(icao24, 16);
  if (!isNaN(hex)) {
    if (hex >= 0xAE0000 && hex <= 0xAFFFFF) return true;  // US military
    if (hex >= 0x43C000 && hex <= 0x43CFFF) return true;  // UK military
  }

  if (operator) {
    const op = operator.toLowerCase();
    if (MILITARY_OPERATORS_LOWER.some(m => op.includes(m))) return true;
  }

  return false;
}

// ============================================================================
// OPENSKY FETCH + UPSERT
// ============================================================================

interface ParsedAircraft {
  icao24: string;
  callsign: string | null;
  longitude: number;
  latitude: number;
  altitudeFt: number | null;
  geoAltitudeFt: number | null;
  heading: number | null;
  speedKnots: number | null;
  verticalRateFpm: number | null;
  onGround: boolean;
  squawk: string | null;
  spi: boolean;
  positionSource: number;
  originCountry: string | null;
  isMilitary: boolean;
  lastContact: number | null;
}

function parseStateVectors(states: any[]): ParsedAircraft[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const aircraft: ParsedAircraft[] = [];

  for (const s of states) {
    if (s[5] == null || s[6] == null) continue;

    const icao24: string = s[0];
    const callsign = (s[1] || '').trim() || null;
    const squawk: string | null = s[14] || null;

    aircraft.push({
      icao24,
      callsign,
      longitude: s[5],
      latitude: s[6],
      altitudeFt: s[7] != null ? s[7] * 3.28084 : null,
      geoAltitudeFt: s[13] != null ? s[13] * 3.28084 : null,
      heading: s[10] ?? null,
      speedKnots: s[9] != null ? s[9] * 1.94384 : null,
      verticalRateFpm: s[11] != null ? s[11] * 196.850 : null,
      onGround: s[8] || false,
      squawk,
      spi: s[15] || false,
      positionSource: s[16] || 0,
      originCountry: s[2] || null,
      isMilitary: detectMilitary(callsign || '', squawk, icao24),
      lastContact: s[4] || null,
    });
  }

  return aircraft;
}

/** Returns true on success, false on failure (for backoff logic). */
export async function fetchAircraft(): Promise<boolean> {
  const db = getDb();
  const startTime = Date.now();

  console.log('[Fetcher:Aircraft] Fetching global aircraft from OpenSky...');

  try {
    const res = await fetch('https://opensky-network.org/api/states/all', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const msg = `OpenSky API error: ${res.status}`;
      console.error(`[Fetcher:Aircraft] ${msg}`);
      await updateFetcherState('aircraft', msg);
      return false;
    }

    const data = await res.json();
    const states = data.states || [];

    if (states.length === 0) {
      console.warn('[Fetcher:Aircraft] No states returned');
      await updateFetcherState('aircraft', 'No states returned');
      return false;
    }

    const aircraft = parseStateVectors(states);
    console.log(`[Fetcher:Aircraft] Parsed ${aircraft.length} aircraft with positions`);

    // Batch upsert positions
    const BATCH_SIZE = 500;
    for (let i = 0; i < aircraft.length; i += BATCH_SIZE) {
      const batch = aircraft.slice(i, i + BATCH_SIZE);
      await db.insert(aircraftPositions).values(
        batch.map(a => ({
          icao24: a.icao24,
          callsign: a.callsign,
          longitude: a.longitude,
          latitude: a.latitude,
          altitudeFt: a.altitudeFt,
          geoAltitudeFt: a.geoAltitudeFt,
          heading: a.heading,
          speedKnots: a.speedKnots,
          verticalRateFpm: a.verticalRateFpm,
          onGround: a.onGround,
          squawk: a.squawk,
          spi: a.spi,
          positionSource: a.positionSource,
          originCountry: a.originCountry,
          isMilitary: a.isMilitary,
          lastContact: a.lastContact,
          updatedAt: new Date(),
        }))
      ).onConflictDoUpdate({
        target: aircraftPositions.icao24,
        set: {
          callsign: sql`excluded.callsign`,
          longitude: sql`excluded.longitude`,
          latitude: sql`excluded.latitude`,
          altitudeFt: sql`excluded.altitude_ft`,
          geoAltitudeFt: sql`excluded.geo_altitude_ft`,
          heading: sql`excluded.heading`,
          speedKnots: sql`excluded.speed_knots`,
          verticalRateFpm: sql`excluded.vertical_rate_fpm`,
          onGround: sql`excluded.on_ground`,
          squawk: sql`excluded.squawk`,
          spi: sql`excluded.spi`,
          positionSource: sql`excluded.position_source`,
          originCountry: sql`excluded.origin_country`,
          isMilitary: sql`excluded.is_military`,
          lastContact: sql`excluded.last_contact`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    }

    // Clean stale positions (> 24 hours old — keep data cached when fetcher restarts)
    await db.delete(aircraftPositions).where(
      sql`${aircraftPositions.updatedAt} < NOW() - INTERVAL '24 hours'`
    );

    // Check for new icao24s that need metadata
    const icao24s = aircraft.map(a => a.icao24);
    const existingMeta = await db
      .select({ icao24: aircraftMetadata.icao24 })
      .from(aircraftMetadata)
      .where(inArray(aircraftMetadata.icao24, icao24s.slice(0, 1000)));

    const existingSet = new Set(existingMeta.map(m => m.icao24));
    const newIcao24s = icao24s.filter(id => !existingSet.has(id));

    // Fetch metadata for new aircraft (batch of 10 to avoid rate limits)
    if (newIcao24s.length > 0) {
      const metaBatch = newIcao24s.slice(0, 10);
      console.log(`[Fetcher:Aircraft] Fetching metadata for ${metaBatch.length} new aircraft`);
      await fetchMetadataBatch(metaBatch);
    }

    // Re-check military status using metadata operator field
    const metaWithOperators = await db
      .select({ icao24: aircraftMetadata.icao24, operator: aircraftMetadata.operator })
      .from(aircraftMetadata)
      .where(inArray(aircraftMetadata.icao24, icao24s.slice(0, 1000)));

    for (const meta of metaWithOperators) {
      if (meta.operator) {
        const ac = aircraft.find(a => a.icao24 === meta.icao24);
        if (ac && !ac.isMilitary) {
          const isMil = detectMilitary(ac.callsign || '', ac.squawk, ac.icao24, meta.operator);
          if (isMil) {
            await db.update(aircraftPositions)
              .set({ isMilitary: true })
              .where(sql`${aircraftPositions.icao24} = ${meta.icao24}`);
          }
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Fetcher:Aircraft] Upserted ${aircraft.length} positions in ${elapsed}s`);

    await updateFetcherState('aircraft', null);
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Fetcher:Aircraft] Error: ${msg}`);
    await updateFetcherState('aircraft', msg);
    return false;
  }
}

async function fetchMetadataBatch(icao24s: string[]): Promise<void> {
  const db = getDb();

  await Promise.allSettled(
    icao24s.map(async (icao24) => {
      try {
        const res = await fetch(
          `https://opensky-network.org/api/metadata/aircraft/icao/${icao24}`,
          { signal: AbortSignal.timeout(5000) }
        );

        if (res.ok) {
          const d = await res.json();
          await db.insert(aircraftMetadata).values({
            icao24,
            typecode: d.typecode || null,
            model: d.model || null,
            operator: d.operator || null,
            registration: d.registration || null,
            fetchedAt: new Date(),
          }).onConflictDoUpdate({
            target: aircraftMetadata.icao24,
            set: {
              typecode: sql`excluded.typecode`,
              model: sql`excluded.model`,
              operator: sql`excluded.operator`,
              registration: sql`excluded.registration`,
              fetchedAt: sql`excluded.fetched_at`,
            },
          });
        }
      } catch {
        // Skip failed metadata lookups silently
      }
    })
  );
}

async function updateFetcherState(sourceId: string, error: string | null): Promise<void> {
  const db = getDb();
  await db.insert(fetcherState).values({
    sourceId,
    lastFetchAt: new Date(),
    lastSuccessAt: error ? undefined : new Date(),
    lastError: error,
    fetchCount: 1,
  }).onConflictDoUpdate({
    target: fetcherState.sourceId,
    set: {
      lastFetchAt: new Date(),
      ...(error ? { lastError: error } : { lastSuccessAt: new Date(), lastError: null }),
      fetchCount: sql`${fetcherState.fetchCount} + 1`,
    },
  });
}
