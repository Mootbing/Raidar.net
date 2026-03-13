import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

let _db: ReturnType<typeof createDb> | null = null;

function createDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}

/** Get a Drizzle DB instance (singleton for the process lifetime). */
export function getDb() {
  if (!_db) {
    _db = createDb();
  }
  return _db;
}
