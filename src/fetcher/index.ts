import * as fs from 'fs';
import * as path from 'path';

// Load .env.local manually (tsx doesn't auto-load it like Next.js does)
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

import { fetchSatellites } from './fetchSatellites';
import { fetchAircraft } from './fetchAircraft';
import { startMaritimeStream } from './fetchMaritime';
import { fetchNews } from './fetchNews';

// ============================================================================
// FETCHER ENTRY POINT
// Runs aircraft + satellite + maritime fetch loops with exponential backoff.
// ============================================================================

const AIRCRAFT_BASE_INTERVAL = 10_000;  // 10 seconds on success
const AIRCRAFT_MAX_INTERVAL = 5 * 60_000; // 5 minutes max backoff
const SATELLITE_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours
const NEWS_BASE_INTERVAL = 5 * 60_000;   // 5 minutes on success
const NEWS_MAX_INTERVAL = 15 * 60_000;   // 15 minutes max backoff

let isRunning = true;
let aircraftConsecutiveErrors = 0;
let newsConsecutiveErrors = 0;

function getAircraftInterval(): number {
  if (aircraftConsecutiveErrors === 0) return AIRCRAFT_BASE_INTERVAL;
  const backoff = AIRCRAFT_BASE_INTERVAL * Math.pow(2, Math.min(aircraftConsecutiveErrors, 5));
  return Math.min(backoff, AIRCRAFT_MAX_INTERVAL);
}

function getNewsInterval(): number {
  if (newsConsecutiveErrors === 0) return NEWS_BASE_INTERVAL;
  const backoff = NEWS_BASE_INTERVAL * Math.pow(2, Math.min(newsConsecutiveErrors, 3));
  return Math.min(backoff, NEWS_MAX_INTERVAL);
}

async function aircraftLoop() {
  while (isRunning) {
    try {
      const success = await fetchAircraft();
      if (success) {
        aircraftConsecutiveErrors = 0;
      } else {
        aircraftConsecutiveErrors++;
      }
    } catch (error) {
      aircraftConsecutiveErrors++;
      console.error('[Fetcher] Aircraft loop error:', error);
    }

    const interval = getAircraftInterval();
    if (aircraftConsecutiveErrors > 0) {
      console.log(`[Fetcher] Aircraft backoff: ${(interval / 1000).toFixed(0)}s (${aircraftConsecutiveErrors} consecutive errors)`);
    }
    await sleep(interval);
  }
}

let maritimeStream: { stop: () => void } | null = null;

async function maritimeLoop() {
  maritimeStream = startMaritimeStream();
  // Keep alive until shutdown
  while (isRunning) {
    await sleep(5000);
  }
  maritimeStream.stop();
}

async function satelliteLoop() {
  while (isRunning) {
    try {
      await fetchSatellites();
    } catch (error) {
      console.error('[Fetcher] Satellite loop error:', error);
    }
    await sleep(SATELLITE_INTERVAL);
  }
}

async function newsLoop() {
  while (isRunning) {
    try {
      const success = await fetchNews();
      if (success) {
        newsConsecutiveErrors = 0;
      } else {
        newsConsecutiveErrors++;
      }
    } catch (error) {
      newsConsecutiveErrors++;
      console.error('[Fetcher] News loop error:', error);
    }

    const interval = getNewsInterval();
    if (newsConsecutiveErrors > 0) {
      console.log(`[Fetcher] News backoff: ${(interval / 1000).toFixed(0)}s (${newsConsecutiveErrors} consecutive errors)`);
    }
    await sleep(interval);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    // Allow shutdown to interrupt sleep
    const check = setInterval(() => {
      if (!isRunning) {
        clearTimeout(timer);
        clearInterval(check);
        resolve();
      }
    }, 1000);
  });
}

async function main() {
  console.log('[Fetcher] Starting data fetcher...');
  console.log(`[Fetcher] Aircraft base interval: ${AIRCRAFT_BASE_INTERVAL / 1000}s (with exponential backoff on error)`);
  console.log(`[Fetcher] Satellite interval: ${SATELLITE_INTERVAL / 3600000}h`);
  console.log(`[Fetcher] Maritime: AISStream.io WebSocket (real-time global AIS)`);
  console.log(`[Fetcher] News base interval: ${NEWS_BASE_INTERVAL / 1000}s (with exponential backoff on error)`);

  // Run all loops concurrently
  await Promise.all([
    satelliteLoop(),
    aircraftLoop(),
    maritimeLoop(),
    newsLoop(),
  ]);
}

function shutdown() {
  console.log('\n[Fetcher] Shutting down...');
  isRunning = false;
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  console.error('[Fetcher] Fatal error:', err);
  process.exit(1);
});
