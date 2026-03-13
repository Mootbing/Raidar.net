import { NextRequest, NextResponse } from 'next/server';

/**
 * Satellite Data API
 *
 * Serves TLE (Two-Line Element) data for satellite position propagation.
 * Client-side SGP4 propagation is preferred for real-time updates.
 *
 * Data sources:
 * - CelesTrak (free): https://celestrak.org/NORAD/elements/
 *   - Active satellites: https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle
 *   - Starlink: https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle
 *   - Military: https://celestrak.org/NORAD/elements/gp.php?GROUP=military&FORMAT=tle
 * - Space-Track (requires login): https://www.space-track.org
 * - N2YO API: https://www.n2yo.com/api/
 *
 * Client library: satellite.js (npm install satellite.js)
 *   - Parse TLE -> propagate with SGP4 -> get lat/lon/alt at any time
 *
 * Returns: { satellites: { name, noradId, tle1, tle2 }[] }
 */
export async function GET(_request: NextRequest) {
  // TODO: Fetch TLE data from CelesTrak or Space-Track
  // TLE data updates every few hours, so cache aggressively
  return NextResponse.json({ satellites: [], source: 'placeholder' });
}
