import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

/**
 * Shipping Docks / Ports API
 *
 * Serves port/dock data from a static JSON dataset.
 * Data is cached in memory after first read (static data, never changes).
 *
 * Returns: { docks: DockEntity[] }
 */

let cache: any[] | null = null;

export async function GET(_request: NextRequest) {
  try {
    if (!cache) {
      const filePath = path.join(process.cwd(), 'public', 'data', 'ports.json');
      const raw = await readFile(filePath, 'utf-8');
      cache = JSON.parse(raw);
      console.log(`[Docks API] Loaded ${cache!.length} ports`);
    }
    return NextResponse.json({ docks: cache });
  } catch (error) {
    console.error('[Docks API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load port data', docks: [] },
      { status: 500 }
    );
  }
}
