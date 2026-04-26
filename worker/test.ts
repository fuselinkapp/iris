// Local harness for the Worker email handler. Reads a .eml file from disk,
// runs it through the same handleEmail() the Worker uses, but writes to the
// wrangler-managed local D1 SQLite (the same file `pnpm dev` reads from)
// instead of going through wrangler dev. Exercises the full parser → ingest
// path without spinning up the Worker runtime.
//
// Usage:
//   pnpm worker:test                                    # default sample
//   pnpm worker:test samples/inbound/raw/01-stripe.eml  # explicit path

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/db/schema';
import { resolveLocalD1Path } from '@/lib/db/local-path';
import type { IrisDb } from '@/lib/db/types';

import { handleEmail } from './handler';

async function main() {
  const path = process.argv[2] ?? 'samples/inbound/raw/01-stripe.eml';
  const raw = readFileSync(resolve(process.cwd(), path), 'utf-8');

  const sqlite = new Database(resolveLocalD1Path());
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema }) as unknown as IrisDb;

  const result = await handleEmail(raw, db);
  console.log(JSON.stringify(result, null, 2));
  sqlite.close();

  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
