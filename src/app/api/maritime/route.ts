import { NextRequest, NextResponse } from 'next/server';

/**
 * Maritime Traffic API
 *
 * Proxies AIS vessel data for the given viewport bounds.
 *
 * Data sources to integrate:
 * - AISHub (free, community): https://www.aishub.net/api
 * - MarineTraffic API (commercial): https://www.marinetraffic.com/en/ais-api-services
 * - VesselFinder API: https://api.vesselfinder.com
 * - BarentsWatch (Nordic): https://www.barentswatch.no/en/
 *
 * Query params: lamin, lamax, lomin, lomax (viewport bounds)
 * Returns: { vessels: ShipEntity[] }
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const _lamin = searchParams.get('lamin');
  const _lamax = searchParams.get('lamax');
  const _lomin = searchParams.get('lomin');
  const _lomax = searchParams.get('lomax');

  // TODO: Implement real AIS data fetching
  // For now, return empty array as placeholder
  return NextResponse.json({ vessels: [], source: 'placeholder' });
}
