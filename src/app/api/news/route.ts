import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { newsEvents } from '@/db/schema';
import { sql, and, gte, lte } from 'drizzle-orm';

/**
 * Real-Time News API
 *
 * Serves cached GDELT news events from Postgres.
 * The standalone fetcher populates the news_events table every 5 minutes.
 *
 * Query params: lamin, lamax, lomin, lomax (viewport bounds), limit
 * Returns: { events: [...], source: 'neon', count: number }
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lamin = parseFloat(searchParams.get('lamin') || '-90');
  const lamax = parseFloat(searchParams.get('lamax') || '90');
  const lomin = parseFloat(searchParams.get('lomin') || '-180');
  const lomax = parseFloat(searchParams.get('lomax') || '180');
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);

  try {
    const db = getDb();

    const rows = await db
      .select()
      .from(newsEvents)
      .where(
        and(
          gte(newsEvents.latitude, lamin),
          lte(newsEvents.latitude, lamax),
          gte(newsEvents.longitude, lomin),
          lte(newsEvents.longitude, lomax),
          // Only return events from the last 6 hours
          gte(newsEvents.publishedAt, sql`NOW() - INTERVAL '6 hours'`)
        )
      )
      .orderBy(sql`${newsEvents.publishedAt} DESC`)
      .limit(limit);

    const events = rows.map((r) => ({
      id: r.id,
      headline: r.headline,
      source: r.source,
      url: r.url,
      lat: r.latitude,
      lon: r.longitude,
      category: r.category,
      severity: r.severity,
      publishedAt: r.publishedAt.getTime(),
    }));

    return NextResponse.json({ events, source: 'neon', count: events.length });
  } catch (error) {
    console.error('[News API] DB query failed:', error);
    return NextResponse.json({ events: [], source: 'neon', error: 'Database query failed' }, { status: 502 });
  }
}
