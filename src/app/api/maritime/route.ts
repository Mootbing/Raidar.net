import { NextRequest, NextResponse } from 'next/server';

const AIS_API_KEY = process.env.AIS_API_KEY;

// Rate limiting state
let lastRequestTime = 0;
let requestCount = 0;
let requestCountResetTime = Date.now();
const MIN_REQUEST_INTERVAL = 5000;
const MAX_REQUESTS_PER_MINUTE = 10;

/**
 * Map AIS ship type codes to human-readable categories.
 * See: https://api.vtexplorer.com/docs/ref-aistypes.html
 */
function mapAISType(code: number | undefined | null): string {
  if (code == null) return 'other';
  if (code >= 70 && code <= 79) return 'cargo';
  if (code >= 80 && code <= 89) return 'tanker';
  if (code >= 60 && code <= 69) return 'passenger';
  if (code >= 40 && code <= 49) return 'high_speed';
  if (code >= 30 && code <= 39) return 'fishing';
  if (code >= 50 && code <= 59) return 'special';
  if (code === 35) return 'military';
  return 'other';
}

/**
 * Generate mock vessel data within the given viewport bounds.
 * Used as fallback when no AIS_API_KEY is configured.
 */
function generateMockVessels(
  lamin: number, lamax: number,
  lomin: number, lomax: number
) {
  // Deterministic seed from bounds to keep vessels stable between polls
  const seed = Math.abs(Math.round(lamin * 100) + Math.round(lomin * 100));
  const rng = (i: number) => {
    const x = Math.sin(seed * 9301 + i * 49297) * 49297;
    return x - Math.floor(x);
  };

  const shipTypes = ['cargo', 'tanker', 'passenger', 'fishing', 'special', 'military', 'high_speed', 'other'];
  const flags = ['PA', 'LR', 'MH', 'HK', 'SG', 'BS', 'MT', 'CY', 'NO', 'GB', 'US', 'JP', 'CN', 'DE', 'GR'];
  const names = [
    'EVER GIVEN', 'MAERSK SEALAND', 'MSC OSCAR', 'OASIS OF THE SEAS',
    'PACIFIC EXPLORER', 'ATLANTIC GUARDIAN', 'NORTHERN SPIRIT', 'SOUTHERN CROSS',
    'GOLDEN DRAGON', 'SILVER STAR', 'BLUE HORIZON', 'RED PHOENIX',
    'ARCTIC VENTURE', 'CORAL PRINCESS', 'DIAMOND WAVE', 'EMERALD SEA',
    'FALCON TRADER', 'HORIZON PIONEER', 'LIBERTY BELL', 'NEPTUNE GLORY',
    'OCEAN MONARCH', 'PACIFIC DAWN', 'ROYAL VOYAGER', 'SEA FORTUNE',
  ];
  const destinations = [
    'SINGAPORE', 'ROTTERDAM', 'SHANGHAI', 'HAMBURG', 'ANTWERP',
    'LOS ANGELES', 'DUBAI', 'HONG KONG', 'BUSAN', 'YOKOHAMA',
    'FELIXSTOWE', 'PIRAEUS', 'SANTOS', 'MUMBAI', 'SYDNEY',
  ];

  const latRange = lamax - lamin;
  const lonRange = lomax - lomin;

  // Scale vessel count by viewport size, max 60
  const area = latRange * lonRange;
  const count = Math.min(60, Math.max(5, Math.round(area * 0.15)));

  const vessels = [];
  for (let i = 0; i < count; i++) {
    const lat = lamin + rng(i * 7) * latRange;
    const lon = lomin + rng(i * 7 + 1) * lonRange;
    const typeIdx = Math.floor(rng(i * 7 + 2) * shipTypes.length);
    const flagIdx = Math.floor(rng(i * 7 + 3) * flags.length);
    const nameIdx = Math.floor(rng(i * 7 + 4) * names.length);
    const destIdx = Math.floor(rng(i * 7 + 5) * destinations.length);
    const mmsi = 200000000 + seed * 1000 + i;

    vessels.push({
      id: mmsi.toString(),
      name: names[nameIdx],
      lat,
      lon,
      heading: Math.round(rng(i * 7 + 6) * 360),
      speed: Math.round(rng(i * 13) * 20 * 10) / 10,
      shipType: shipTypes[typeIdx],
      flag: flags[flagIdx],
      imo: 9000000 + seed * 100 + i,
      destination: destinations[destIdx],
      draught: Math.round((3 + rng(i * 11) * 15) * 10) / 10,
    });
  }

  return vessels;
}

/**
 * Maritime Traffic API
 *
 * Proxies AIS vessel data for the given viewport bounds.
 * Falls back to mock data when AIS_API_KEY is not configured.
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

  // No API key — return mock data
  if (!AIS_API_KEY) {
    const vessels = generateMockVessels(laminN, lamaxN, lominN, lomaxN);
    console.log(`[Maritime API] No AIS_API_KEY set, returning ${vessels.length} mock vessels`);
    return NextResponse.json({ vessels, source: 'mock' });
  }

  // Rate limiting
  const now = Date.now();
  if (now - requestCountResetTime > 60000) {
    requestCount = 0;
    requestCountResetTime = now;
  }
  if (requestCount >= MAX_REQUESTS_PER_MINUTE) {
    const waitTime = Math.ceil((60000 - (now - requestCountResetTime)) / 1000);
    return NextResponse.json(
      { error: 'Rate limited', message: `Too many requests. Try again in ${waitTime}s`, retryAfter: waitTime },
      { status: 429 }
    );
  }
  if (now - lastRequestTime < MIN_REQUEST_INTERVAL) {
    const waitTime = Math.ceil((MIN_REQUEST_INTERVAL - (now - lastRequestTime)) / 1000);
    return NextResponse.json(
      { error: 'Rate limited', message: `Please wait ${waitTime}s between requests`, retryAfter: waitTime },
      { status: 429 }
    );
  }

  try {
    lastRequestTime = now;
    requestCount++;

    // AISHub API
    const url = `https://data.aishub.net/ws.php?username=${AIS_API_KEY}&format=1&output=json&compress=0&latmin=${lamin}&latmax=${lamax}&lonmin=${lomin}&lonmax=${lomax}`;

    console.log(`[Maritime API] Fetching AIS data (request ${requestCount}/${MAX_REQUESTS_PER_MINUTE} this minute)`);
    const res = await fetch(url, {
      next: { revalidate: 20 },
    });

    if (!res.ok) {
      if (res.status === 429) {
        return NextResponse.json(
          { error: 'AIS API rate limited', message: 'AIS API rate limit exceeded' },
          { status: 429 }
        );
      }
      throw new Error(`AIS API error: ${res.status}`);
    }

    const data = await res.json();

    // AISHub returns array or { ERROR: ... } on failure
    const records = Array.isArray(data) ? data : (data[1] ?? []);
    const vessels = records.map((v: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      id: String(v.MMSI),
      name: v.NAME?.trim() || `MMSI ${v.MMSI}`,
      lat: v.LATITUDE,
      lon: v.LONGITUDE,
      heading: v.HEADING ?? v.COG ?? 0,
      speed: v.SOG ?? 0,
      shipType: mapAISType(v.TYPE),
      flag: v.FLAG || 'Unknown',
      imo: v.IMO,
      destination: v.DESTINATION?.trim(),
      draught: v.DRAUGHT,
    }));

    console.log(`[Maritime API] Received ${vessels.length} vessels`);
    return NextResponse.json({ vessels, source: 'aishub' });
  } catch (error) {
    console.error('[Maritime API] Error fetching AIS data:', error);
    // Fall back to mock data on error
    const vessels = generateMockVessels(laminN, lamaxN, lominN, lomaxN);
    return NextResponse.json({ vessels, source: 'mock-fallback' });
  }
}
