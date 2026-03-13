import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { satelliteTle } from '@/db/schema';

/**
 * Satellite Data API
 *
 * Reads TLE data from Neon Postgres (populated by the fetcher process).
 * Returns all satellites globally — client-side SGP4 propagation handles positioning.
 */

export async function GET() {
  try {
    const db = getDb();
    const rows = await db.select().from(satelliteTle);

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
  } catch (error) {
    console.error('[Satellites] DB query error:', error);
    return NextResponse.json(
      { satellites: [], error: 'Failed to fetch satellite data' },
      { status: 502 }
    );
  }
}
