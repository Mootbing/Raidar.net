# Orchestrator: Real-Time News

**Status:** SCAFFOLDED — needs API implementation
**Layer ID:** `news`
**Entity type:** `NewsEventEntity`
**Component:** `src/components/layers/NewsLayer.tsx`
**API route:** `src/app/api/news/route.ts`
**Polling:** 60s

## What exists

- Layer config, entity types, registry config, data source registration all done
- `NewsLayer.tsx` calls `useLayerData('news')` and renders instanced pulsing circles
- Severity-based coloring: low=green, medium=yellow, high=orange, critical=red
- Pulse speed scales with severity
- Viewport-based spatial caching is automatic
- API route stub returns `{ events: [] }`

## What to implement

### Step 1: Choose a news data source

| Source | Cost | Geocoding | Real-time | Notes |
|--------|------|-----------|-----------|-------|
| **GDELT Project** | Free | Built-in | Yes (15min) | Best for defense. Has lat/lon natively. |
| **NewsAPI** | Free tier / $449/mo | No | Yes | Keyword search, needs separate geocoding |
| **Event Registry** | Free tier | Built-in | Yes | Academic, good coverage |
| **RSS aggregation** | Free | No | Varies | Manual, needs geocoding pipeline |

Recommendation: Start with **GDELT** — it's free, defense-focused, and includes coordinates.

### Step 2: Implement the API route with GDELT

Edit `src/app/api/news/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';

const GDELT_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lamin = searchParams.get('lamin');
  const lamax = searchParams.get('lamax');
  const lomin = searchParams.get('lomin');
  const lomax = searchParams.get('lomax');
  const category = searchParams.get('category') || '';
  const limit = searchParams.get('limit') || '50';

  // GDELT v2 Doc API — returns geolocated news articles
  const themes = buildThemeFilter(category);
  const params = new URLSearchParams({
    query: `${themes} sourcelang:eng`,
    mode: 'artlist',
    maxrecords: limit,
    format: 'json',
    sort: 'DateDesc',
    timespan: '1h',  // Last 1 hour
  });

  // GDELT supports geographic filtering via sourcebct (bounding box centroid)
  if (lamin && lamax && lomin && lomax) {
    // GDELT uses "near" operator for geographic queries
    const centerLat = (parseFloat(lamin) + parseFloat(lamax)) / 2;
    const centerLon = (parseFloat(lomin) + parseFloat(lomax)) / 2;
    const radius = Math.max(
      Math.abs(parseFloat(lamax) - parseFloat(lamin)),
      Math.abs(parseFloat(lomax) - parseFloat(lomin))
    ) / 2;
    params.set('query', `${themes} near:${centerLat},${centerLon},${Math.round(radius * 111)}km sourcelang:eng`);
  }

  try {
    const res = await fetch(`${GDELT_BASE}?${params}`);
    const data = await res.json();

    const events = (data.articles || [])
      .filter((a: any) => a.seendate && (a.sourcecountry || a.domain))
      .map((a: any, i: number) => ({
        id: `gdelt_${a.url ? hashCode(a.url) : i}`,
        headline: a.title || 'Untitled',
        source: a.domain || a.source || 'Unknown',
        lat: parseFloat(a.sourcelat) || 0,
        lon: parseFloat(a.sourcelon) || 0,
        category: classifyArticle(a),
        severity: classifySeverity(a),
        url: a.url,
        publishedAt: new Date(a.seendate).getTime(),
      }))
      .filter((e: any) => e.lat !== 0 && e.lon !== 0); // Only geocoded articles

    return NextResponse.json({ events });
  } catch (error) {
    return NextResponse.json({ events: [], error: 'GDELT fetch failed' }, { status: 502 });
  }
}

function buildThemeFilter(category: string): string {
  const themeMap: Record<string, string> = {
    military: 'theme:MILITARY OR theme:ARMED_CONFLICT',
    security: 'theme:TERROR OR theme:SECURITY_SERVICES',
    maritime: 'theme:MARITIME_INCIDENT OR theme:PIRACY',
    aviation: 'theme:AVIATION OR theme:AVIATION_INCIDENT',
    geopolitics: 'theme:DIPLOMACY OR theme:SANCTIONS',
    natural_disaster: 'theme:NATURAL_DISASTER',
  };
  return themeMap[category] || 'theme:MILITARY OR theme:ARMED_CONFLICT OR theme:SECURITY_SERVICES';
}

function classifyArticle(article: any): string {
  const title = (article.title || '').toLowerCase();
  if (title.match(/military|army|navy|airforce|troops|deploy/)) return 'military';
  if (title.match(/terror|attack|bomb|shoot/)) return 'security';
  if (title.match(/ship|vessel|maritime|port|naval/)) return 'maritime';
  if (title.match(/flight|aircraft|airline|airport|crash/)) return 'aviation';
  if (title.match(/sanction|treaty|diplomat|summit/)) return 'geopolitics';
  if (title.match(/earthquake|hurricane|flood|wildfire/)) return 'natural_disaster';
  return 'geopolitics';
}

function classifySeverity(article: any): string {
  const tone = parseFloat(article.tone) || 0;
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
```

### Step 3: Add news info to EntityInfoPanel

```typescript
case 'news_event': {
  const news = entity as any;
  return (
    <>
      <InfoRow label="HEADLINE" value={news.headline} wrap />
      <InfoRow label="SOURCE" value={news.source} />
      <InfoRow label="CATEGORY" value={news.category.toUpperCase()} />
      <InfoRow label="SEVERITY" value={news.severity.toUpperCase()} accent={severityColor(news.severity)} />
      <InfoRow label="TIME" value={formatTimeAgo(news.publishedAt)} />
      {news.url && <a href={news.url} target="_blank" rel="noopener" className="text-[#66aaff] text-[9px]">OPEN SOURCE →</a>}
    </>
  );
}
```

### Step 4: News ticker UI (optional)

Add a scrolling news ticker above the bottom bar or as a side panel:

```typescript
// In Dashboard.tsx, add when news layer is enabled:
{newsLayerEnabled && events.length > 0 && (
  <div className="absolute top-4 left-4 right-[200px] pointer-events-auto">
    <ScrollingText
      items={events.map(e => `[${e.severity.toUpperCase()}] ${e.headline} — ${e.source}`)}
      speed={50}
    />
  </div>
)}
```

The existing `ScrollingText` component can be reused.

### Step 5: Cross-layer integration

When a news event is selected:
1. **Auto-highlight the country** — reverse geocode the event's lat/lon to a country ISO code, call `addHighlightedCountry(code)`
2. **Show nearby entities** — if maritime/aircraft layers are active, list entities within a configurable radius of the news event
3. **Event clustering** — when zoomed out, cluster nearby news events into a single marker with a count badge (reduces visual noise)

### Step 6: TTL and expiration

News events should expire. In `useLayerData`, the cache cleanup already removes stale entries. But for news specifically:

- Set `cacheConfig.cacheTTL: 300_000` (5 minutes) in the data source registration (already done)
- The GDELT query uses `timespan: '1h'` so old articles drop off naturally
- Consider adding an `expiresAt` field and filtering expired events in the renderer

## Data flow summary

```
Layer enabled → user pans map
  → useLayerData('news') sees viewport change
  → SpatialCache: coverage check → need fetch
  → GET /api/news?lamin=..&lamax=..&lomin=..&lomax=..&limit=100
  → API queries GDELT with geographic filter + defense themes
  → response: geolocated articles with lat/lon, tone, themes
  → parsed into NewsEventEntity format with severity classification
  → SpatialCache.merge(events, paddedBounds)
  → only events in viewport returned
  → NewsLayer.tsx renders pulsing circles color-coded by severity
  → user clicks event → EntityInfoPanel shows headline, source, link
  → auto-highlights affected country via BorderHighlightLayer
```
