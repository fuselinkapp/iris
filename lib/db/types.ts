/// <reference types="@cloudflare/workers-types" />

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import type * as schema from '@/db/schema';

// `IrisDb` is typed as the better-sqlite3 client because Drizzle's chainable
// query API (especially `.select({ alias: table })` named projections) does
// not narrow cleanly when expressed as a union of better-sqlite3 + D1.
//
// Both clients implement the same query-builder shape at runtime, and ingest
// / queries code `await`s every result — `await` on a sync value resolves
// immediately, `await` on the D1 Promise resolves when the query lands. So
// the edge runtime can pass a `drizzle-orm/d1` client cast to this type;
// runtime is identical, only the static type is conservative.
export type IrisDb = BetterSQLite3Database<typeof schema>;

export type Env = {
  IRIS_DB: D1Database;
  IRIS_RAW?: R2Bucket;
};
