import { getDb } from '../db/client';
import { vesselPositions, fetcherState } from '../db/schema';
import { sql } from 'drizzle-orm';

// ============================================================================
// DIGITRAFFIC.FI AIS FETCH
// Free, open AIS data from Finnish Transport Infrastructure Agency.
// Provides real-time vessel positions + metadata for Baltic/Nordic waters.
// No API key required. CC 4.0 BY license.
// ============================================================================

const LOCATIONS_URL = 'https://meri.digitraffic.fi/api/ais/v1/locations';
const VESSELS_URL = 'https://meri.digitraffic.fi/api/ais/v1/vessels';

// AIS ship type codes → human-readable categories
function mapShipType(typeCode: number | undefined | null): string {
  if (typeCode == null) return 'other';
  if (typeCode >= 70 && typeCode <= 79) return 'cargo';
  if (typeCode >= 80 && typeCode <= 89) return 'tanker';
  if (typeCode >= 60 && typeCode <= 69) return 'passenger';
  if (typeCode >= 40 && typeCode <= 49) return 'high_speed';
  if (typeCode >= 30 && typeCode <= 39) return 'fishing';
  if (typeCode >= 50 && typeCode <= 59) return 'special';
  if (typeCode === 35) return 'military';
  return 'other';
}

// AIS MID (Maritime Identification Digits) → country flag
function mmsiToFlag(mmsi: string): string {
  const mid = mmsi.substring(0, 3);
  const midMap: Record<string, string> = {
    '201': 'AL', '202': 'AD', '203': 'AT', '204': 'PT', '205': 'BE',
    '206': 'BY', '207': 'BG', '208': 'VA', '209': 'CY', '210': 'CY',
    '211': 'DE', '212': 'CY', '213': 'GE', '214': 'MD', '215': 'MT',
    '216': 'AM', '218': 'DE', '219': 'DK', '220': 'DK', '224': 'ES',
    '225': 'ES', '226': 'FR', '227': 'FR', '228': 'FR', '229': 'MT',
    '230': 'FI', '231': 'FO', '232': 'GB', '233': 'GB', '234': 'GB',
    '235': 'GB', '236': 'GI', '237': 'GR', '238': 'HR', '239': 'GR',
    '240': 'GR', '241': 'GR', '242': 'MA', '243': 'HU', '244': 'NL',
    '245': 'NL', '246': 'NL', '247': 'IT', '248': 'MT', '249': 'MT',
    '250': 'IE', '251': 'IS', '252': 'LI', '253': 'LU', '254': 'MC',
    '255': 'PT', '256': 'MT', '257': 'NO', '258': 'NO', '259': 'NO',
    '261': 'PL', '263': 'PT', '264': 'RO', '265': 'SE', '266': 'SE',
    '267': 'SK', '268': 'SM', '269': 'CH', '270': 'CZ', '271': 'TR',
    '272': 'UA', '273': 'RU', '274': 'MK', '275': 'LV', '276': 'EE',
    '277': 'LT', '278': 'SI', '279': 'ME', '301': 'AI', '303': 'US',
    '304': 'AG', '305': 'AG', '306': 'CW', '307': 'AW', '308': 'BS',
    '309': 'BS', '310': 'BM', '311': 'BS', '312': 'BZ', '314': 'BB',
    '316': 'CA', '319': 'KY', '321': 'CR', '323': 'CU', '325': 'DM',
    '327': 'DO', '329': 'GP', '330': 'GD', '331': 'GL', '332': 'GT',
    '334': 'HN', '336': 'HT', '338': 'US', '339': 'JM', '341': 'KN',
    '343': 'LC', '345': 'MX', '347': 'MQ', '348': 'MS', '350': 'NI',
    '351': 'PA', '352': 'PA', '353': 'PA', '354': 'PA', '355': 'PA',
    '356': 'PA', '357': 'PA', '358': 'PR', '359': 'SV', '361': 'PM',
    '362': 'TT', '364': 'TC', '366': 'US', '367': 'US', '368': 'US',
    '369': 'US', '370': 'PA', '371': 'PA', '372': 'PA', '373': 'PA',
    '374': 'PA', '375': 'VC', '376': 'VC', '377': 'VC',
    '401': 'AF', '403': 'SA', '405': 'BD', '408': 'BH', '410': 'BT',
    '412': 'CN', '413': 'CN', '414': 'CN', '416': 'TW', '417': 'LK',
    '419': 'IN', '422': 'IR', '423': 'AZ', '425': 'IQ', '428': 'IL',
    '431': 'JP', '432': 'JP', '434': 'TM', '436': 'KZ', '437': 'UZ',
    '438': 'JO', '440': 'KR', '441': 'KR', '443': 'PS', '445': 'KP',
    '447': 'KW', '450': 'LB', '451': 'KG', '453': 'MO', '455': 'MV',
    '457': 'MN', '459': 'NP', '461': 'OM', '463': 'PK', '466': 'QA',
    '468': 'SY', '470': 'AE', '471': 'AE', '472': 'TJ', '473': 'YE',
    '475': 'YE', '477': 'HK', '478': 'BA',
    '501': 'AQ', '503': 'AU', '506': 'MM', '508': 'BN', '510': 'FM',
    '511': 'PW', '512': 'NZ', '514': 'KH', '515': 'KH', '516': 'CX',
    '518': 'CK', '520': 'FJ', '523': 'CC', '525': 'ID', '529': 'KI',
    '531': 'LA', '533': 'MY', '536': 'MP', '538': 'MH', '540': 'NC',
    '542': 'NU', '544': 'NR', '546': 'PF', '548': 'PH', '553': 'PG',
    '555': 'PN', '557': 'SB', '559': 'AS', '561': 'WS', '563': 'SG',
    '564': 'SG', '565': 'SG', '566': 'SG', '567': 'TH', '570': 'TO',
    '572': 'TV', '574': 'VN', '576': 'VU', '577': 'VU', '578': 'WF',
    '601': 'ZA', '603': 'AO', '605': 'DZ', '607': 'TF', '608': 'IO',
    '609': 'BI', '610': 'BJ', '611': 'BW', '612': 'CF', '613': 'CM',
    '615': 'CG', '616': 'KM', '617': 'CV', '618': 'AQ', '619': 'CI',
    '620': 'KM', '621': 'DJ', '622': 'EG', '624': 'ET', '625': 'ER',
    '626': 'GA', '627': 'GH', '629': 'GM', '630': 'GW', '631': 'GQ',
    '632': 'GN', '633': 'BF', '634': 'KE', '635': 'AQ', '636': 'LR',
    '637': 'LR', '638': 'SS', '642': 'LY', '644': 'LS', '645': 'MU',
    '647': 'MG', '649': 'ML', '650': 'MZ', '654': 'MR', '655': 'MW',
    '656': 'NE', '657': 'NG', '659': 'NA', '660': 'RE', '661': 'RW',
    '662': 'SD', '663': 'SN', '664': 'SC', '665': 'SH', '666': 'SO',
    '667': 'SL', '668': 'ST', '669': 'SZ', '670': 'TD', '671': 'TG',
    '672': 'TN', '674': 'TZ', '675': 'UG', '676': 'CD', '677': 'TZ',
    '678': 'ZM', '679': 'ZW',
  };
  return midMap[mid] || 'Unknown';
}

// Military detection based on ship type and MMSI ranges
function detectMilitary(shipType: number | null | undefined, name: string): boolean {
  // AIS ship type 35 = Military ops
  if (shipType === 35) return true;
  // Check name for military keywords
  if (name) {
    const upper = name.toUpperCase();
    if (upper.includes('NAVY') || upper.includes('MILITARY') || upper.includes('WARSHIP') || upper.includes('HMS ') || upper.includes('USS ')) return true;
  }
  return false;
}

interface AISFeature {
  mmsi: number;
  type: string;
  geometry: {
    type: string;
    coordinates: [number, number];
  };
  properties: {
    mmsi: number;
    sog: number;
    cog: number;
    navStat: number;
    rot: number;
    posAcc: boolean;
    raim: boolean;
    heading: number;
    timestamp: number;
    timestampExternal: string;
  };
}

interface VesselMetadata {
  mmsi: number;
  name: string;
  shipType: number;
  callSign: string;
  imo: number;
  destination: string;
  draught: number;
  eta: number;
  posType: number;
  referencePointA: number;
  referencePointB: number;
  referencePointC: number;
  referencePointD: number;
  timestamp: number;
}

// In-memory metadata cache (refreshed less frequently)
let metadataCache = new Map<number, VesselMetadata>();
let lastMetadataFetch = 0;
const METADATA_REFRESH_INTERVAL = 10 * 60_000; // 10 minutes

async function fetchMetadata(): Promise<void> {
  const now = Date.now();
  if (now - lastMetadataFetch < METADATA_REFRESH_INTERVAL && metadataCache.size > 0) {
    return; // Use cached metadata
  }

  try {
    console.log('[Fetcher:Maritime] Fetching vessel metadata...');
    const res = await fetch(VESSELS_URL, {
      headers: { 'Accept-Encoding': 'gzip' },
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      console.error(`[Fetcher:Maritime] Metadata API error: ${res.status}`);
      return;
    }

    const vessels: VesselMetadata[] = await res.json();
    const newCache = new Map<number, VesselMetadata>();
    for (const v of vessels) {
      newCache.set(v.mmsi, v);
    }
    metadataCache = newCache;
    lastMetadataFetch = now;
    console.log(`[Fetcher:Maritime] Cached metadata for ${newCache.size} vessels`);
  } catch (error) {
    console.error('[Fetcher:Maritime] Metadata fetch error:', error);
  }
}

/** Returns true on success, false on failure. */
export async function fetchMaritime(): Promise<boolean> {
  const db = getDb();
  const startTime = Date.now();

  console.log('[Fetcher:Maritime] Fetching AIS vessel positions from Digitraffic...');

  try {
    // Fetch metadata first (cached, refreshes every 10 min)
    await fetchMetadata();

    // Fetch current positions
    const res = await fetch(LOCATIONS_URL, {
      headers: { 'Accept-Encoding': 'gzip' },
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const msg = `Digitraffic AIS API error: ${res.status}`;
      console.error(`[Fetcher:Maritime] ${msg}`);
      await updateFetcherState('maritime', msg);
      return false;
    }

    const data = await res.json();
    const features: AISFeature[] = data.features || [];

    if (features.length === 0) {
      console.warn('[Fetcher:Maritime] No vessel positions returned');
      await updateFetcherState('maritime', 'No positions returned');
      return false;
    }

    // Build vessel records by joining positions with metadata
    const vessels = features
      .filter(f => f.geometry?.coordinates?.[0] != null && f.geometry?.coordinates?.[1] != null)
      .map(f => {
        const mmsi = f.mmsi || f.properties.mmsi;
        const meta = metadataCache.get(mmsi);
        const name = meta?.name?.trim() || `MMSI ${mmsi}`;
        const shipTypeCode = meta?.shipType ?? null;

        return {
          mmsi: String(mmsi),
          name,
          longitude: f.geometry.coordinates[0],
          latitude: f.geometry.coordinates[1],
          heading: f.properties.heading > 360 ? null : f.properties.heading,
          speed: f.properties.sog > 102 ? null : f.properties.sog, // 102.3 = not available
          course: f.properties.cog > 360 ? null : f.properties.cog,
          shipType: mapShipType(shipTypeCode),
          navStatus: f.properties.navStat,
          destination: meta?.destination?.trim() || null,
          draught: meta?.draught ?? null,
          imo: meta?.imo ? String(meta.imo) : null,
          callsign: meta?.callSign?.trim() || null,
          flag: mmsiToFlag(String(mmsi)),
          isMilitary: detectMilitary(shipTypeCode, name),
          updatedAt: new Date(),
        };
      });

    console.log(`[Fetcher:Maritime] Parsed ${vessels.length} vessels with positions`);

    // Batch upsert
    const BATCH_SIZE = 500;
    for (let i = 0; i < vessels.length; i += BATCH_SIZE) {
      const batch = vessels.slice(i, i + BATCH_SIZE);
      await db.insert(vesselPositions).values(batch).onConflictDoUpdate({
        target: vesselPositions.mmsi,
        set: {
          name: sql`excluded.name`,
          longitude: sql`excluded.longitude`,
          latitude: sql`excluded.latitude`,
          heading: sql`excluded.heading`,
          speed: sql`excluded.speed`,
          course: sql`excluded.course`,
          shipType: sql`excluded.ship_type`,
          navStatus: sql`excluded.nav_status`,
          destination: sql`excluded.destination`,
          draught: sql`excluded.draught`,
          imo: sql`excluded.imo`,
          callsign: sql`excluded.callsign`,
          flag: sql`excluded.flag`,
          isMilitary: sql`excluded.is_military`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    }

    // Clean stale positions (> 24 hours old — keep data cached when fetcher restarts)
    await db.delete(vesselPositions).where(
      sql`${vesselPositions.updatedAt} < NOW() - INTERVAL '24 hours'`
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Fetcher:Maritime] Upserted ${vessels.length} vessel positions in ${elapsed}s`);

    await updateFetcherState('maritime', null);
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Fetcher:Maritime] Error: ${msg}`);
    await updateFetcherState('maritime', msg);
    return false;
  }
}

async function updateFetcherState(sourceId: string, error: string | null): Promise<void> {
  const db = getDb();
  await db.insert(fetcherState).values({
    sourceId,
    lastFetchAt: new Date(),
    lastSuccessAt: error ? undefined : new Date(),
    lastError: error,
    fetchCount: 1,
  }).onConflictDoUpdate({
    target: fetcherState.sourceId,
    set: {
      lastFetchAt: new Date(),
      ...(error ? { lastError: error } : { lastSuccessAt: new Date(), lastError: null }),
      fetchCount: sql`${fetcherState.fetchCount} + 1`,
    },
  });
}
