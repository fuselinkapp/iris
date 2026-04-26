import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import type * as schema from '@/db/schema';

// `IrisDb` is typed as the better-sqlite3 client because Drizzle's chainable
// query API does not narrow cleanly across the better-sqlite3 (sync) and D1
// (Promise) return-type pair when expressed as a union.
//
// At runtime both clients implement the same query builder shape, and ingest
// code `await`s every result — `await` on the sync value resolves immediately,
// `await` on the D1 Promise resolves when the query lands. So the Worker can
// safely pass a `drizzle-orm/d1` client cast to this type; runtime behavior
// is identical, only the static type is conservative.
export type IrisDb = BetterSQLite3Database<typeof schema>;
