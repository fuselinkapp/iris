import 'server-only';

import type { IrisDb } from './types';

let cached: IrisDb | null = null;

export async function getDb(): Promise<IrisDb> {
  if (cached) return cached;
  cached = await constructDb();
  return cached;
}

async function constructDb(): Promise<IrisDb> {
  if (process.env.NEXT_RUNTIME === 'edge') {
    return constructEdgeDb();
  }
  return constructNodeDb();
}

async function constructEdgeDb(): Promise<IrisDb> {
  const [{ getRequestContext }, { drizzle }, schema] = await Promise.all([
    import('@cloudflare/next-on-pages'),
    import('drizzle-orm/d1'),
    import('@/db/schema'),
  ]);
  const env = getRequestContext().env as { IRIS_DB?: D1Database };
  if (!env.IRIS_DB) {
    throw new Error(
      '[iris] IRIS_DB binding not configured. ' +
        'In dev: ensure setupDevPlatform() is wired in next.config.ts. ' +
        'In prod: bind D1 to the Pages project (see DEPLOY-PAGES.md).',
    );
  }
  // D1 client is structurally compatible with the (sync) better-sqlite3 surface
  // for the operations used here; consumers await everything.
  return drizzle(env.IRIS_DB, { schema }) as unknown as IrisDb;
}

async function constructNodeDb(): Promise<IrisDb> {
  // CLI scripts only — every dashboard route is `runtime = 'edge'`. Kept so
  // seed / migrate / worker:test can open the wrangler-managed local SQLite.
  const [{ default: Database }, { drizzle }, { resolveLocalD1Path }, schema] = await Promise.all([
    import('better-sqlite3'),
    import('drizzle-orm/better-sqlite3'),
    import('./local-path'),
    import('@/db/schema'),
  ]);

  const dbPath = resolveLocalD1Path();
  const sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');
  return drizzle(sqlite, { schema });
}
