import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { vesselPositions } from '@/db/schema';
import { sql } from 'drizzle-orm';

/**
 * Maritime Traffic API
 *
 * Serves real AIS vessel data from Neon Postgres (populated by the fetcher
 * via AISStream.io global AIS WebSocket feed).
 *
 * Query params: lamin, lamax, lomin, lomax (viewport bounds)
 * Returns: { vessels: ShipEntity[] }
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lamin = searchParams.get('lamin');
  const lamax = searchParams.get('lamax');
  const lomin = searchParams.get('lomin');
  const lomax = searchParams.get('lomax');

  if (!lamin || !lamax || !lomin || !lomax) {
    return NextResponse.json(
      { error: 'Missing viewport bounds', message: 'Provide lamin, lamax, lomin, lomax' },
      { status: 400 }
    );
  }

  const laminN = parseFloat(lamin);
  const lamaxN = parseFloat(lamax);
  const lominN = parseFloat(lomin);
  const lomaxN = parseFloat(lomax);

  try {
    const db = getDb();

    const rows = await db
      .select()
      .from(vesselPositions)
      .where(
        sql`${vesselPositions.latitude} BETWEEN ${laminN} AND ${lamaxN}
            AND ${vesselPositions.longitude} BETWEEN ${lominN} AND ${lomaxN}`
      )
      .limit(2000);

    const vessels = rows.map(r => ({
      id: r.mmsi,
      name: r.name || `MMSI ${r.mmsi}`,
      lat: r.latitude,
      lon: r.longitude,
      heading: r.heading ?? 0,
      speed: r.speed ?? 0,
      shipType: r.shipType || 'other',
      flag: r.flag || 'Unknown',
      imo: r.imo ? parseInt(r.imo, 10) : undefined,
      destination: r.destination || undefined,
      draught: r.draught ?? undefined,
    }));

    return NextResponse.json({ vessels, source: 'aisstream' });
  } catch (error) {
    console.error('[Maritime API] Error querying vessel data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch vessel data', vessels: [] },
      { status: 500 }
    );
  }
}
