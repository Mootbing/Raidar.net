import { NextRequest, NextResponse } from 'next/server';

/**
 * Shipping Docks / Ports API
 *
 * Serves port/dock data. This is static data loaded from a dataset file.
 * Similar to the airports endpoint.
 *
 * Data sources:
 * - World Port Index (WPI): https://msi.nga.mil/Publications/WPI
 *   - ~3,700 ports worldwide with coordinates, type, capacity
 * - OpenStreetMap extract (more comprehensive but needs filtering)
 * - UN LOCODE: https://unece.org/trade/uncefact/unlocode
 *
 * Data file: /public/data/ports.json (to be created from WPI or OSM)
 *
 * Returns: { docks: DockEntity[] }
 */
export async function GET(_request: NextRequest) {
  // TODO: Load port dataset from /public/data/ports.json
  // Same pattern as /api/airports - load from static JSON file
  return NextResponse.json({ docks: [], source: 'placeholder' });
}
