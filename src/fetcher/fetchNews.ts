import { getDb } from '../db/client';
import { newsEvents, fetcherState } from '../db/schema';
import { sql } from 'drizzle-orm';

// ============================================================================
// GDELT NEWS FETCH
// Free, real-time global news with built-in geocoding.
// Queries the GDELT v2 Doc API for defense/security themed articles.
// Articles are geocoded via sourcecountry → country centroid lookup.
// ============================================================================

const GDELT_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';

export async function fetchNews(): Promise<boolean> {
  const db = getDb();
  const start = Date.now();

  try {
    // GDELT rate-limits to ~1 req/5s.  Fetch multiple theme queries sequentially
    // to get broader coverage without hitting OR-syntax issues.
    const themes = [
      'theme:MILITARY',
      'theme:ARMED_CONFLICT',
      'theme:TERROR',
      'theme:SECURITY_SERVICES',
    ];

    const allArticles: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const theme of themes) {
      const params = new URLSearchParams({
        query: `${theme} sourcelang:eng`,
        mode: 'artlist',
        maxrecords: '75',
        format: 'json',
        sort: 'DateDesc',
        timespan: '60min',
      });

      const res = await fetch(`${GDELT_BASE}?${params}`, {
        signal: AbortSignal.timeout(30_000),
      });

      if (res.ok) {
        const data = await res.json();
        allArticles.push(...(data.articles || []));
      } else if (res.status === 429) {
        // Rate limited — use what we have so far
        console.log(`[News] Rate limited on ${theme}, proceeding with ${allArticles.length} articles`);
        break;
      } else {
        console.warn(`[News] GDELT ${res.status} for ${theme}`);
      }

      // Respect GDELT's 5s rate limit between requests
      await new Promise(r => setTimeout(r, 6000));
    }

    const articles = allArticles;

    // Parse articles, geocode via sourcecountry → centroid
    const seen = new Set<string>();
    const events = articles
      .filter((a: any) => a.seendate && a.sourcecountry) // eslint-disable-line @typescript-eslint/no-explicit-any
      .map((a: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const coords = getCountryCentroid(a.sourcecountry);
        if (!coords) return null;

        // Add small random jitter (±0.5°) so overlapping markers spread out
        const jitterLat = (Math.random() - 0.5) * 1.0;
        const jitterLon = (Math.random() - 0.5) * 1.0;

        const id = `gdelt_${a.url ? hashCode(a.url) : Math.random().toString(36).slice(2)}`;
        if (seen.has(id)) return null;
        seen.add(id);

        const tone = parseTone(a.tone);
        return {
          id,
          headline: (a.title || 'Untitled').slice(0, 500),
          source: a.domain || a.source || 'Unknown',
          url: a.url || null,
          longitude: coords.lon + jitterLon,
          latitude: coords.lat + jitterLat,
          category: classifyArticle(a),
          severity: classifySeverity(tone),
          tone,
          publishedAt: parseGdeltDate(a.seendate),
          fetchedAt: new Date(),
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    if (events.length === 0) {
      console.log('[News] GDELT returned 0 geocodable articles');
      await updateFetcherState(db, null);
      return true;
    }

    // Batch upsert (500 at a time)
    const BATCH_SIZE = 500;
    let upserted = 0;
    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      const batch = events.slice(i, i + BATCH_SIZE);
      await db
        .insert(newsEvents)
        .values(batch)
        .onConflictDoUpdate({
          target: newsEvents.id,
          set: {
            headline: sql`EXCLUDED.headline`,
            source: sql`EXCLUDED.source`,
            severity: sql`EXCLUDED.severity`,
            tone: sql`EXCLUDED.tone`,
            fetchedAt: sql`EXCLUDED.fetched_at`,
          },
        });
      upserted += batch.length;
    }

    // Clean up events older than 6 hours
    await db.delete(newsEvents).where(
      sql`${newsEvents.publishedAt} < NOW() - INTERVAL '6 hours'`
    );

    const elapsed = Date.now() - start;
    console.log(`[News] Upserted ${upserted} events from ${articles.length} articles (${elapsed}ms)`);

    await updateFetcherState(db, null);
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[News] Fetch failed:', msg);
    await updateFetcherState(db, msg);
    return false;
  }
}

// ============================================================================
// HELPERS
// ============================================================================

/** Parse GDELT date format: "20260313T153000Z" → Date */
function parseGdeltDate(dateStr: string): Date {
  // Format: YYYYMMDDTHHmmssZ
  const s = dateStr.replace(/[^0-9TZ]/g, '');
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return new Date();
  return d;
}

function parseTone(toneStr: string | undefined): number {
  if (!toneStr) return 0;
  // GDELT tone field is comma-separated: "tone,positive,negative,polarity,..."
  const first = toneStr.split(',')[0];
  return parseFloat(first) || 0;
}

function classifyArticle(article: any): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  const title = (article.title || '').toLowerCase();
  if (title.match(/military|army|navy|airforce|troops|deploy/)) return 'military';
  if (title.match(/terror|attack|bomb|shoot/)) return 'security';
  if (title.match(/ship|vessel|maritime|port|naval/)) return 'maritime';
  if (title.match(/flight|aircraft|airline|airport|crash/)) return 'aviation';
  if (title.match(/sanction|treaty|diplomat|summit/)) return 'geopolitics';
  if (title.match(/earthquake|hurricane|flood|wildfire/)) return 'natural_disaster';
  return 'geopolitics';
}

function classifySeverity(tone: number): string {
  if (tone < -8) return 'critical';
  if (tone < -5) return 'high';
  if (tone < -2) return 'medium';
  return 'low';
}

function hashCode(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

async function updateFetcherState(db: any, error: string | null) { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    await db
      .insert(fetcherState)
      .values({
        sourceId: 'news',
        lastFetchAt: new Date(),
        lastSuccessAt: error ? undefined : new Date(),
        lastError: error,
        fetchCount: 1,
      })
      .onConflictDoUpdate({
        target: fetcherState.sourceId,
        set: {
          lastFetchAt: sql`NOW()`,
          ...(error
            ? { lastError: error }
            : { lastSuccessAt: sql`NOW()`, lastError: null }),
          fetchCount: sql`${fetcherState.fetchCount} + 1`,
        },
      });
  } catch {
    // Non-critical
  }
}

// ============================================================================
// COUNTRY CENTROID LOOKUP
// Maps GDELT sourcecountry names to approximate lat/lon centroids.
// ============================================================================

function getCountryCentroid(country: string): { lat: number; lon: number } | null {
  const key = country.trim().toLowerCase();
  return COUNTRY_CENTROIDS[key] ?? null;
}

const COUNTRY_CENTROIDS: Record<string, { lat: number; lon: number }> = {
  'afghanistan': { lat: 33.94, lon: 67.71 },
  'albania': { lat: 41.15, lon: 20.17 },
  'algeria': { lat: 28.03, lon: 1.66 },
  'argentina': { lat: -38.42, lon: -63.62 },
  'armenia': { lat: 40.07, lon: 45.04 },
  'australia': { lat: -25.27, lon: 133.78 },
  'austria': { lat: 47.52, lon: 14.55 },
  'azerbaijan': { lat: 40.14, lon: 47.58 },
  'bahrain': { lat: 26.07, lon: 50.56 },
  'bangladesh': { lat: 23.68, lon: 90.36 },
  'belarus': { lat: 53.71, lon: 27.95 },
  'belgium': { lat: 50.50, lon: 4.47 },
  'bolivia': { lat: -16.29, lon: -63.59 },
  'bosnia and herzegovina': { lat: 43.92, lon: 17.68 },
  'brazil': { lat: -14.24, lon: -51.93 },
  'brunei': { lat: 4.54, lon: 114.73 },
  'bulgaria': { lat: 42.73, lon: 25.49 },
  'cambodia': { lat: 12.57, lon: 104.99 },
  'cameroon': { lat: 7.37, lon: 12.35 },
  'canada': { lat: 56.13, lon: -106.35 },
  'chile': { lat: -35.68, lon: -71.54 },
  'china': { lat: 35.86, lon: 104.20 },
  'colombia': { lat: 4.57, lon: -74.30 },
  'costa rica': { lat: 9.75, lon: -83.75 },
  'croatia': { lat: 45.10, lon: 15.20 },
  'cuba': { lat: 21.52, lon: -77.78 },
  'cyprus': { lat: 35.13, lon: 33.43 },
  'czech republic': { lat: 49.82, lon: 15.47 },
  'czechia': { lat: 49.82, lon: 15.47 },
  'democratic republic of the congo': { lat: -4.04, lon: 21.76 },
  'denmark': { lat: 56.26, lon: 9.50 },
  'djibouti': { lat: 11.83, lon: 42.59 },
  'dominican republic': { lat: 18.74, lon: -70.16 },
  'ecuador': { lat: -1.83, lon: -78.18 },
  'egypt': { lat: 26.82, lon: 30.80 },
  'el salvador': { lat: 13.79, lon: -88.90 },
  'eritrea': { lat: 15.18, lon: 39.78 },
  'estonia': { lat: 58.60, lon: 25.01 },
  'ethiopia': { lat: 9.15, lon: 40.49 },
  'finland': { lat: 61.92, lon: 25.75 },
  'france': { lat: 46.23, lon: 2.21 },
  'georgia': { lat: 42.32, lon: 43.36 },
  'germany': { lat: 51.17, lon: 10.45 },
  'ghana': { lat: 7.95, lon: -1.02 },
  'greece': { lat: 39.07, lon: 21.82 },
  'guatemala': { lat: 15.78, lon: -90.23 },
  'haiti': { lat: 18.97, lon: -72.29 },
  'honduras': { lat: 15.20, lon: -86.24 },
  'hong kong': { lat: 22.40, lon: 114.11 },
  'hungary': { lat: 47.16, lon: 19.50 },
  'iceland': { lat: 64.96, lon: -19.02 },
  'india': { lat: 20.59, lon: 78.96 },
  'indonesia': { lat: -0.79, lon: 113.92 },
  'iran': { lat: 32.43, lon: 53.69 },
  'iraq': { lat: 33.22, lon: 43.68 },
  'ireland': { lat: 53.14, lon: -7.69 },
  'israel': { lat: 31.05, lon: 34.85 },
  'italy': { lat: 41.87, lon: 12.57 },
  'ivory coast': { lat: 7.54, lon: -5.55 },
  'jamaica': { lat: 18.11, lon: -77.30 },
  'japan': { lat: 36.20, lon: 138.25 },
  'jordan': { lat: 30.59, lon: 36.24 },
  'kazakhstan': { lat: 48.02, lon: 66.92 },
  'kenya': { lat: -0.02, lon: 37.91 },
  'kosovo': { lat: 42.60, lon: 20.90 },
  'kuwait': { lat: 29.31, lon: 47.48 },
  'kyrgyzstan': { lat: 41.20, lon: 74.77 },
  'laos': { lat: 19.86, lon: 102.50 },
  'latvia': { lat: 56.88, lon: 24.60 },
  'lebanon': { lat: 33.85, lon: 35.86 },
  'libya': { lat: 26.34, lon: 17.23 },
  'lithuania': { lat: 55.17, lon: 23.88 },
  'luxembourg': { lat: 49.82, lon: 6.13 },
  'madagascar': { lat: -18.77, lon: 46.87 },
  'malaysia': { lat: 4.21, lon: 101.98 },
  'mali': { lat: 17.57, lon: -4.00 },
  'malta': { lat: 35.94, lon: 14.38 },
  'mexico': { lat: 23.63, lon: -102.55 },
  'moldova': { lat: 47.41, lon: 28.37 },
  'mongolia': { lat: 46.86, lon: 103.85 },
  'montenegro': { lat: 42.71, lon: 19.37 },
  'morocco': { lat: 31.79, lon: -7.09 },
  'mozambique': { lat: -18.67, lon: 35.53 },
  'myanmar': { lat: 21.91, lon: 95.96 },
  'namibia': { lat: -22.96, lon: 18.49 },
  'nepal': { lat: 28.39, lon: 84.12 },
  'netherlands': { lat: 52.13, lon: 5.29 },
  'new zealand': { lat: -40.90, lon: 174.89 },
  'nicaragua': { lat: 12.87, lon: -85.21 },
  'niger': { lat: 17.61, lon: 8.08 },
  'nigeria': { lat: 9.08, lon: 8.68 },
  'north korea': { lat: 40.34, lon: 127.51 },
  'north macedonia': { lat: 41.51, lon: 21.75 },
  'norway': { lat: 60.47, lon: 8.47 },
  'oman': { lat: 21.47, lon: 55.98 },
  'pakistan': { lat: 30.38, lon: 69.35 },
  'palestine': { lat: 31.95, lon: 35.23 },
  'panama': { lat: 8.54, lon: -80.78 },
  'paraguay': { lat: -23.44, lon: -58.44 },
  'peru': { lat: -9.19, lon: -75.02 },
  'philippines': { lat: 12.88, lon: 121.77 },
  'poland': { lat: 51.92, lon: 19.15 },
  'portugal': { lat: 39.40, lon: -8.22 },
  'qatar': { lat: 25.35, lon: 51.18 },
  'romania': { lat: 45.94, lon: 24.97 },
  'russia': { lat: 61.52, lon: 105.32 },
  'rwanda': { lat: -1.94, lon: 29.87 },
  'saudi arabia': { lat: 23.89, lon: 45.08 },
  'senegal': { lat: 14.50, lon: -14.45 },
  'serbia': { lat: 44.02, lon: 21.01 },
  'sierra leone': { lat: 8.46, lon: -11.78 },
  'singapore': { lat: 1.35, lon: 103.82 },
  'slovakia': { lat: 48.67, lon: 19.70 },
  'slovenia': { lat: 46.15, lon: 14.99 },
  'somalia': { lat: 5.15, lon: 46.20 },
  'south africa': { lat: -30.56, lon: 22.94 },
  'south korea': { lat: 35.91, lon: 127.77 },
  'south sudan': { lat: 6.88, lon: 31.31 },
  'spain': { lat: 40.46, lon: -3.75 },
  'sri lanka': { lat: 7.87, lon: 80.77 },
  'sudan': { lat: 12.86, lon: 30.22 },
  'sweden': { lat: 60.13, lon: 18.64 },
  'switzerland': { lat: 46.82, lon: 8.23 },
  'syria': { lat: 34.80, lon: 39.00 },
  'taiwan': { lat: 23.70, lon: 120.96 },
  'tajikistan': { lat: 38.86, lon: 71.28 },
  'tanzania': { lat: -6.37, lon: 34.89 },
  'thailand': { lat: 15.87, lon: 100.99 },
  'tunisia': { lat: 33.89, lon: 9.54 },
  'turkey': { lat: 38.96, lon: 35.24 },
  'turkmenistan': { lat: 38.97, lon: 59.56 },
  'uganda': { lat: 1.37, lon: 32.29 },
  'ukraine': { lat: 48.38, lon: 31.17 },
  'united arab emirates': { lat: 23.42, lon: 53.85 },
  'united kingdom': { lat: 55.38, lon: -3.44 },
  'united states': { lat: 37.09, lon: -95.71 },
  'uruguay': { lat: -32.52, lon: -55.77 },
  'uzbekistan': { lat: 41.38, lon: 64.59 },
  'venezuela': { lat: 6.42, lon: -66.59 },
  'vietnam': { lat: 14.06, lon: 108.28 },
  'yemen': { lat: 15.55, lon: 48.52 },
  'zambia': { lat: -13.13, lon: 27.85 },
  'zimbabwe': { lat: -19.02, lon: 29.15 },
};
