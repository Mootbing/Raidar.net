import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { satelliteTle } from '@/db/schema';

/**
 * Satellite Data API
 *
 * Reads TLE data from Neon Postgres (populated by the fetcher process).
 * Falls back to direct CelesTrak fetch when the DB table is empty.
 */

const TLE_GROUPS = [
  { group: 'stations', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle' },
  { group: 'visual', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle' },
  { group: 'weather', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle' },
  { group: 'science', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=science&FORMAT=tle' },
];

interface ParsedSatellite {
  id: string;
  name: string;
  noradId: string;
  tle1: string;
  tle2: string;
  group: string;
  intlDesignator: string;
}

function parseTLE(text: string, group: string): ParsedSatellite[] {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const satellites: ParsedSatellite[] = [];

  for (let i = 0; i < lines.length - 2; i += 3) {
    const name = lines[i];
    const tle1 = lines[i + 1];
    const tle2 = lines[i + 2];

    if (!tle1.startsWith('1 ') || !tle2.startsWith('2 ')) continue;

    const noradId = tle1.substring(2, 7).trim();
    const intlDesignator = tle1.substring(9, 17).trim();

    satellites.push({
      id: noradId,
      name: name.trim(),
      noradId,
      tle1,
      tle2,
      group,
      intlDesignator,
    });
  }

  return satellites;
}

async function fetchFromCelesTrak(): Promise<ParsedSatellite[]> {
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

  const all: ParsedSatellite[] = [];
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
      console.warn('[Satellites] CelesTrak group fetch failed:', result.reason);
    }
  }

  return all;
}

export async function GET() {
  try {
    const db = getDb();
    const rows = await db.select().from(satelliteTle);

    if (rows.length > 0) {
      const satellites = rows.map(row => ({
        id: row.noradId,
        name: row.name,
        noradId: row.noradId,
        tle1: row.tleLine1,
        tle2: row.tleLine2,
        group: row.tleGroup || 'unknown',
        intlDesignator: row.intlDesignator || '',
      }));

      return NextResponse.json({
        satellites,
        source: 'neon',
        cached: false,
        count: satellites.length,
      });
    }

    // DB is empty — fall back to direct CelesTrak fetch
    console.log('[Satellites] DB empty, fetching directly from CelesTrak...');
    const satellites = await fetchFromCelesTrak();

    return NextResponse.json({
      satellites,
      source: 'celestrak',
      cached: false,
      count: satellites.length,
    });
  } catch (error) {
    console.error('[Satellites] DB query error, trying CelesTrak fallback:', error);

    try {
      const satellites = await fetchFromCelesTrak();
      return NextResponse.json({
        satellites,
        source: 'celestrak-fallback',
        cached: false,
        count: satellites.length,
      });
    } catch (fallbackError) {
      console.error('[Satellites] CelesTrak fallback also failed:', fallbackError);
      return NextResponse.json(
        { satellites: [], error: 'Failed to fetch satellite data' },
        { status: 502 }
      );
    }
  }
}
