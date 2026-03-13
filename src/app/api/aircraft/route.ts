import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { aircraftPositions, aircraftMetadata } from '@/db/schema';
import { sql } from 'drizzle-orm';

/**
 * Aircraft Data API
 *
 * Reads aircraft positions from Neon Postgres (populated by the fetcher process).
 * Supports viewport-bounded queries via query params: lamin, lamax, lomin, lomax.
 * JOINs aircraft_metadata for type/model/operator enrichment.
 */

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lamin = parseFloat(searchParams.get('lamin') || '-90');
  const lamax = parseFloat(searchParams.get('lamax') || '90');
  const lomin = parseFloat(searchParams.get('lomin') || '-180');
  const lomax = parseFloat(searchParams.get('lomax') || '180');

  try {
    const db = getDb();

    // Viewport query with metadata JOIN
    const rows = await db
      .select({
        icao24: aircraftPositions.icao24,
        callsign: aircraftPositions.callsign,
        longitude: aircraftPositions.longitude,
        latitude: aircraftPositions.latitude,
        altitudeFt: aircraftPositions.altitudeFt,
        geoAltitudeFt: aircraftPositions.geoAltitudeFt,
        heading: aircraftPositions.heading,
        speedKnots: aircraftPositions.speedKnots,
        verticalRateFpm: aircraftPositions.verticalRateFpm,
        onGround: aircraftPositions.onGround,
        squawk: aircraftPositions.squawk,
        spi: aircraftPositions.spi,
        positionSource: aircraftPositions.positionSource,
        originCountry: aircraftPositions.originCountry,
        isMilitary: aircraftPositions.isMilitary,
        lastContact: aircraftPositions.lastContact,
        // Metadata fields
        typecode: aircraftMetadata.typecode,
        model: aircraftMetadata.model,
        operator: aircraftMetadata.operator,
        registration: aircraftMetadata.registration,
      })
      .from(aircraftPositions)
      .leftJoin(aircraftMetadata, sql`${aircraftPositions.icao24} = ${aircraftMetadata.icao24}`)
      .where(sql`
        ${aircraftPositions.latitude} >= ${lamin}
        AND ${aircraftPositions.latitude} <= ${lamax}
        AND ${aircraftPositions.longitude} >= ${lomin}
        AND ${aircraftPositions.longitude} <= ${lomax}
      `);

    // Map to clean response format
    const aircraft = rows.map(r => ({
      id: r.icao24,
      callsign: r.callsign || 'N/A',
      type: r.typecode || 'UNKNOWN',
      position: {
        longitude: r.longitude,
        latitude: r.latitude,
        altitude: r.altitudeFt || 0,
        heading: r.heading || 0,
        speed: r.speedKnots || 0,
        verticalRate: r.verticalRateFpm || 0,
        geoAltitude: r.geoAltitudeFt || 0,
      },
      timestamp: Date.now(),
      originCountry: r.originCountry || 'Unknown',
      onGround: r.onGround || false,
      squawk: r.squawk || null,
      spi: r.spi || false,
      positionSource: r.positionSource || 0,
      lastContact: r.lastContact || null,
      isMilitary: r.isMilitary || false,
      // Enriched metadata
      typecode: r.typecode || null,
      aircraftModel: r.model || null,
      operator: r.operator || null,
      registration: r.registration || null,
    }));

    return NextResponse.json({
      aircraft,
      source: 'neon',
      count: aircraft.length,
    });
  } catch (error) {
    console.error('[Aircraft] DB query error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch aircraft data' },
      { status: 500 }
    );
  }
}
