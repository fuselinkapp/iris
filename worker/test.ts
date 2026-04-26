// Local harness for the Worker email handler. Reads a .eml file from disk,
// runs it through the same handleEmail() the Worker uses, but writes to the
// local better-sqlite3 file (.iris/iris.db) instead of D1. Lets you exercise
// the full parser → ingest path without spinning up wrangler.
//
// Usage:
//   pnpm worker:test                                    # default sample
//   pnpm worker:test samples/inbound/raw/01-stripe.eml  # explicit path

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/db/schema';

import { handleEmail } from './handler';

async function main() {
  const path = process.argv[2] ?? 'samples/inbound/raw/01-stripe.eml';
  const raw = readFileSync(resolve(process.cwd(), path), 'utf-8');

  const sqlite = new Database(resolve(process.cwd(), '.iris/iris.db'));
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });

  const result = await handleEmail(raw, db);
  console.log(JSON.stringify(result, null, 2));
  sqlite.close();

  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
