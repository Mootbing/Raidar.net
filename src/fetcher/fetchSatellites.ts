import { getDb } from '../db/client';
import { satelliteTle, fetcherState } from '../db/schema';
import { sql } from 'drizzle-orm';

// CelesTrak TLE groups to fetch
const TLE_GROUPS = [
  { group: 'stations', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle' },
  { group: 'visual', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle' },
  { group: 'weather', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle' },
  { group: 'science', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=science&FORMAT=tle' },
];

interface ParsedTLE {
  noradId: string;
  name: string;
  tleLine1: string;
  tleLine2: string;
  tleGroup: string;
  intlDesignator: string;
}

function parseTLE(text: string, group: string): ParsedTLE[] {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const satellites: ParsedTLE[] = [];

  for (let i = 0; i < lines.length - 2; i += 3) {
    const name = lines[i];
    const tle1 = lines[i + 1];
    const tle2 = lines[i + 2];

    if (!tle1.startsWith('1 ') || !tle2.startsWith('2 ')) continue;

    const noradId = tle1.substring(2, 7).trim();
    const intlDesignator = tle1.substring(9, 17).trim();

    satellites.push({
      noradId,
      name: name.trim(),
      tleLine1: tle1,
      tleLine2: tle2,
      tleGroup: group,
      intlDesignator,
    });
  }

  return satellites;
}

export async function fetchSatellites(): Promise<void> {
  const db = getDb();
  const startTime = Date.now();

  console.log('[Fetcher:Satellites] Fetching TLE data from CelesTrak...');

  const results = await Promise.allSettled(
    TLE_GROUPS.map(async ({ group, url }) => {
      const res = await fetch(url, {
        headers: { 'Accept': 'text/plain' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`CelesTrak ${group}: ${res.status}`);
      const text = await res.text();
      return parseTLE(text, group);
    })
  );

  // Deduplicate by NORAD ID
  const all: ParsedTLE[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const sat of result.value) {
        if (!seen.has(sat.noradId)) {
          seen.add(sat.noradId);
          all.push(sat);
        }
      }
    } else {
      console.warn('[Fetcher:Satellites] Group fetch failed:', result.reason);
    }
  }

  if (all.length === 0) {
    console.warn('[Fetcher:Satellites] No satellites fetched, skipping upsert');
    await db.insert(fetcherState).values({
      sourceId: 'satellites',
      lastFetchAt: new Date(),
      lastError: 'No satellites fetched',
      fetchCount: 1,
    }).onConflictDoUpdate({
      target: fetcherState.sourceId,
      set: {
        lastFetchAt: new Date(),
        lastError: 'No satellites fetched',
        fetchCount: sql`${fetcherState.fetchCount} + 1`,
      },
    });
    return;
  }

  // Batch upsert into satellite_tle
  const BATCH_SIZE = 500;
  for (let i = 0; i < all.length; i += BATCH_SIZE) {
    const batch = all.slice(i, i + BATCH_SIZE);
    await db.insert(satelliteTle).values(
      batch.map(s => ({
        noradId: s.noradId,
        name: s.name,
        tleLine1: s.tleLine1,
        tleLine2: s.tleLine2,
        tleGroup: s.tleGroup,
        intlDesignator: s.intlDesignator,
        fetchedAt: new Date(),
      }))
    ).onConflictDoUpdate({
      target: satelliteTle.noradId,
      set: {
        name: sql`excluded.name`,
        tleLine1: sql`excluded.tle_line1`,
        tleLine2: sql`excluded.tle_line2`,
        tleGroup: sql`excluded.tle_group`,
        intlDesignator: sql`excluded.intl_designator`,
        fetchedAt: sql`excluded.fetched_at`,
      },
    });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Fetcher:Satellites] Upserted ${all.length} satellites in ${elapsed}s`);

  // Update fetcher state
  await db.insert(fetcherState).values({
    sourceId: 'satellites',
    lastFetchAt: new Date(),
    lastSuccessAt: new Date(),
    fetchCount: 1,
  }).onConflictDoUpdate({
    target: fetcherState.sourceId,
    set: {
      lastFetchAt: new Date(),
      lastSuccessAt: new Date(),
      lastError: null,
      fetchCount: sql`${fetcherState.fetchCount} + 1`,
    },
  });
}
