import { fetchSatellites } from './fetchSatellites';
import { fetchAircraft } from './fetchAircraft';

// ============================================================================
// FETCHER ENTRY POINT
// Runs aircraft + satellite fetch loops via setInterval.
// ============================================================================

const AIRCRAFT_INTERVAL = 10_000;       // 10 seconds
const SATELLITE_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

let aircraftTimer: ReturnType<typeof setInterval> | null = null;
let satelliteTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = true;

async function runAircraftLoop() {
  if (!isRunning) return;
  try {
    await fetchAircraft();
  } catch (error) {
    console.error('[Fetcher] Aircraft loop error:', error);
  }
}

async function runSatelliteLoop() {
  if (!isRunning) return;
  try {
    await fetchSatellites();
  } catch (error) {
    console.error('[Fetcher] Satellite loop error:', error);
  }
}

async function main() {
  console.log('[Fetcher] Starting data fetcher...');
  console.log(`[Fetcher] Aircraft interval: ${AIRCRAFT_INTERVAL / 1000}s`);
  console.log(`[Fetcher] Satellite interval: ${SATELLITE_INTERVAL / 3600000}h`);

  // Run initial fetches
  console.log('[Fetcher] Running initial satellite fetch...');
  await runSatelliteLoop();

  console.log('[Fetcher] Running initial aircraft fetch...');
  await runAircraftLoop();

  // Start loops
  aircraftTimer = setInterval(runAircraftLoop, AIRCRAFT_INTERVAL);
  satelliteTimer = setInterval(runSatelliteLoop, SATELLITE_INTERVAL);

  console.log('[Fetcher] Fetch loops started. Press Ctrl+C to stop.');
}

function shutdown() {
  console.log('\n[Fetcher] Shutting down...');
  isRunning = false;
  if (aircraftTimer) clearInterval(aircraftTimer);
  if (satelliteTimer) clearInterval(satelliteTimer);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  console.error('[Fetcher] Fatal error:', err);
  process.exit(1);
});
