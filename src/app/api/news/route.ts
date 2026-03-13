import { NextRequest, NextResponse } from 'next/server';

/**
 * Real-Time News API
 *
 * Aggregates and geocodes defense/security news from multiple sources.
 *
 * Data sources:
 * - GDELT Project (free): https://api.gdeltproject.org/api/v2/doc/doc
 *   - Real-time global news with built-in geocoding
 *   - Filters: theme (MILITARY, TERROR, etc.), tone, location
 * - NewsAPI (freemium): https://newsapi.org
 *   - Requires API key, good for keyword-based search
 * - RSS feeds from defense outlets:
 *   - Defense News, Jane's, Breaking Defense, The War Zone
 *   - Reuters World, AP International
 *
 * Geocoding pipeline:
 * - GDELT provides coordinates natively
 * - For other sources, extract location entities from headlines
 *   using a geocoding service (Nominatim, MapBox, Google)
 *
 * Query params: category, severity, limit
 * Returns: { events: NewsEventEntity[] }
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const _category = searchParams.get('category');
  const _limit = searchParams.get('limit') || '50';

  // TODO: Implement news aggregation + geocoding
  return NextResponse.json({ events: [], source: 'placeholder' });
}
