# Phase 0.9 — Pages deploy + binding-aware getDb (plan)

**Story:** `docs/phase-0.9-pages-deploy-story.md`

## Goal

Make the Next.js dashboard build for Cloudflare Pages with `@cloudflare/next-on-pages`, switch every DB-touching route to the edge runtime, refactor `getDb()` to return a D1-backed Drizzle client (via `getRequestContext()`), retarget local dev / seed / migrate / worker:test to wrangler's local D1 store, and ship a `DEPLOY-PAGES.md` walkthrough — all without executing the actual deploy.

## Changes

### `package.json` (modify, +2 deps, +3 scripts)

- Add devDeps: `@cloudflare/next-on-pages`, `vercel` (next-on-pages depends on @vercel/build internally — it's bundled as a transitive dep, no explicit add needed actually, double-check and skip if so).
- Scripts:
  - `pages:build`: `next-on-pages`
  - `pages:dev`: `wrangler pages dev .vercel/output/static --d1=IRIS_DB --binding RESEND_API_KEY=$RESEND_API_KEY --binding IRIS_INGEST_TOKEN=$IRIS_INGEST_TOKEN`
  - Update `db:migrate`: `wrangler d1 migrations apply iris-d1 --local`
  - Update `db:seed`: `tsx db/seed.ts` (script body changes to target wrangler local D1 path)
  - Update `db:reset`: `rm -rf .wrangler/state/v3/d1&& pnpm db:migrate && pnpm db:seed`
  - Update `worker:test`: `tsx worker/test.ts` (body retargets to wrangler-local SQLite)

### `wrangler.toml` (modify, ~+15 LoC)

Consolidate Worker + Pages config:

```toml
name = "iris-mail-worker"
main = "worker/index.ts"
compatibility_date = "2025-04-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "IRIS_DB"
database_name = "iris-d1"
database_id = "REPLACE_WITH_YOUR_D1_ID"
migrations_dir = "db/migrations"

[[r2_buckets]]
binding = "IRIS_RAW"
bucket_name = "iris-raw"

# Pages config — consumed by `wrangler pages deploy` and `wrangler pages dev`.
# Bindings under [pages_build_output_dir] aren't first-class TOML; the deploy
# command takes them via flags or via the Pages dashboard. The shared D1
# binding above is referenced from the Pages project via the dashboard or
# `wrangler pages project create --d1=IRIS_DB`.
pages_build_output_dir = ".vercel/output/static"
```

(Note: the Pages config in wrangler.toml is constrained — most binding wiring happens via `wrangler pages deploy --d1 IRIS_DB=iris-d1` flags or the dashboard. Document in DEPLOY-PAGES.md.)

### `next.config.ts` (modify, ~+15 LoC)

```ts
import type { NextConfig } from 'next';

if (process.env.NODE_ENV === 'development') {
  const { setupDevPlatform } = await import('@cloudflare/next-on-pages/next-dev');
  await setupDevPlatform();
}

const config: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['better-sqlite3'],
  webpack: (cfg, { nextRuntime }) => {
    if (nextRuntime === 'edge') {
      cfg.resolve = cfg.resolve ?? {};
      cfg.resolve.alias = {
        ...(cfg.resolve.alias as Record<string, unknown> | undefined),
        'better-sqlite3': false,
        'node:fs': false,
        'node:path': false,
      };
    }
    return cfg;
  },
};

export default config;
```

### `lib/db/types.ts` (modify, ~+10 LoC)

```ts
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type * as schema from '@/db/schema';

// IrisDb stays typed as the better-sqlite3 client for Drizzle's chainable
// API to narrow cleanly. Both runtimes are structurally compatible at runtime.
export type IrisDb = BetterSQLite3Database<typeof schema> | DrizzleD1Database<typeof schema>;
// (was: just BetterSQLite3Database. Re-add the union now that we actually use D1 from the dashboard too.)
// Wait — in 0.6 we kept it as just BetterSQLite3 because of chain narrowing. Let's keep that and
// keep the "as unknown as IrisDb" cast in the Worker, plus a similar cast in client.ts.
export type Env = {
  IRIS_DB: D1Database;
  IRIS_RAW?: R2Bucket;
};
```

Decision: keep `IrisDb = BetterSQLite3Database<typeof schema>` per phase 0.6's reasoning. Add `Env` as a separate export.

### `lib/db/client.ts` (rewrite, ~50 LoC)

```ts
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
    const [{ getRequestContext }, { drizzle }, schema] = await Promise.all([
      import('@cloudflare/next-on-pages'),
      import('drizzle-orm/d1'),
      import('@/db/schema'),
    ]);
    const env = getRequestContext().env as { IRIS_DB?: D1Database };
    if (!env.IRIS_DB) throw new Error('[iris] IRIS_DB binding not configured');
    return drizzle(env.IRIS_DB, { schema }) as unknown as IrisDb;
  }

  // Node runtime (CLI scripts only — every dashboard route is `runtime = 'edge'`).
  // Kept for the seed/migrate/worker-test path so we can still open the wrangler-local SQLite directly.
  const [{ default: Database }, { drizzle }, { mkdirSync }, { resolve, dirname }, schema] = await Promise.all([
    import('better-sqlite3'),
    import('drizzle-orm/better-sqlite3'),
    import('node:fs'),
    import('node:path'),
    import('@/db/schema'),
  ]);

  const dbPath = resolveLocalD1Path();
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');
  return drizzle(sqlite, { schema });
}

function resolveLocalD1Path(): string {
  // Wrangler stores local D1 at .wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite
  // We have one DB in this project; pick the first .sqlite file.
  // Falls back to .iris/iris.db only if wrangler hasn't been run yet (transitional).
  const fs = require('node:fs');
  const path = require('node:path');
  const wranglerDir = path.resolve(process.cwd(), '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  if (fs.existsSync(wranglerDir)) {
    const files = fs.readdirSync(wranglerDir).filter((f: string) => f.endsWith('.sqlite'));
    if (files[0]) return path.join(wranglerDir, files[0]);
  }
  return path.resolve(process.cwd(), '.iris/iris.db');
}
```

### `lib/db/queries.ts` (modify, every `getDb()` → `await getDb()`)

- 6 callsites. No other changes.

### `app/api/ingest/route.ts` (modify, +1 LoC)

- `runtime = 'edge'` (was nodejs).
- `ingestMessage(body, getDb())` → `ingestMessage(body, await getDb())`.

### `app/(app)/page.tsx`, `app/compose/page.tsx`, `app/(app)/settings/domains/page.tsx`

- All flip `export const runtime = 'nodejs'` → `export const runtime = 'edge'`.
- The `/settings/domains` page calls `listDomains()` which calls `getDb()` internally; the existing `await listDomains()` already handles the new async-DB.

### `app/actions/grandma.ts`, `app/actions/send.ts`, `app/actions/domains.ts`

- Server Actions are bundled into the route they're imported from. With routes flipped to edge, the actions run on edge. They already wrap async query functions; no signature change.
- `app/actions/send.ts`: `sendMessage(input, getDb())` → `sendMessage(input, await getDb())`.

### `db/seed.ts` (rewrite resolution path, ~+15 LoC)

- Replace the hard-coded `.iris/iris.db` path with the wrangler-local resolver from `lib/db/client.ts`. Or duplicate a small `resolveLocalD1Path()` helper since seed runs in tsx, not via `getDb()`.
- Add a pre-flight: if no `.wrangler/state/v3/d1/.../...sqlite` exists, instruct the user to run `pnpm db:migrate` first (which now goes through `wrangler d1 migrations apply --local` and creates the file).
- Drop the `.iris/` references.

### `db/migrate.ts` (delete or stub)

- Replaced by `wrangler d1 migrations apply iris-d1 --local`. Keep the file as a one-liner that prints "Use pnpm db:migrate (which calls wrangler) — db/migrate.ts is deprecated."
- Cleaner: delete the file and remove from any references.

### `worker/test.ts` (modify, ~+10 LoC)

- Change the SQLite path from `.iris/iris.db` to the wrangler-resolved path (same helper as seed/client).

### `.gitignore` (modify, ~+2 LoC)

- Remove `.iris/` (no longer used).
- `.wrangler/` already covered by phase 0.6.
- Add `.vercel/` (next-on-pages output).
- Document the change in the README.

### `DEPLOY.md` (modify, ~+5 LoC)

- Update the section on `wrangler.toml` to mention it now also covers Pages config.
- Add a note pointing at `DEPLOY-PAGES.md` for the dashboard deploy.

### `DEPLOY-PAGES.md` (new, ~90 LoC of prose)

Walkthrough:

1. **One-time setup** (assumes the Worker phase 0.6 setup has already been done):
   - `pnpm exec wrangler login` (already done if you deployed the Worker).
   - The D1 + R2 from `DEPLOY.md` are reused — don't recreate.

2. **Build for Pages**:
   ```bash
   pnpm pages:build
   # Output lands in .vercel/output/static
   ```

3. **Create the Pages project**:
   ```bash
   pnpm exec wrangler pages project create iris-dashboard --production-branch main
   ```

4. **Set Pages env vars**:
   ```bash
   pnpm exec wrangler pages secret put RESEND_API_KEY --project-name iris-dashboard
   pnpm exec wrangler pages secret put IRIS_INGEST_TOKEN --project-name iris-dashboard
   ```

5. **Bind D1**:
   - In the Cloudflare dashboard: Pages → iris-dashboard → Settings → Functions → D1 bindings → Add: variable name `IRIS_DB`, database `iris-d1`.
   - (Wrangler CLI doesn't yet support setting Pages D1 bindings via CLI for Pages-managed projects — dashboard is the documented path.)

6. **Deploy**:
   ```bash
   pnpm exec wrangler pages deploy .vercel/output/static --project-name iris-dashboard
   ```

7. **Custom domain** (optional): in the Cloudflare dashboard, Pages → iris-dashboard → Custom domains → add `mail.yourdomain.com` (or wherever).

8. **Cloudflare Access in front** (recommended — single-tenant beta, no app-level auth):
   - Cloudflare Zero Trust → Access → Applications → Add an application → Self-hosted.
   - Application domain: your Pages URL.
   - Identity provider: One-time PIN to your email (free) or Google / GitHub.
   - Policy: allow only your email.
   - Save. Anyone hitting the URL now goes through CF Access first.

9. **Local development**:
   ```bash
   pnpm pages:dev    # next-on-pages with miniflare bindings
   # OR
   pnpm dev          # standard Next dev with the same dev-platform setup
   ```

10. **Re-deploy after changes**:
    ```bash
    pnpm pages:build && pnpm exec wrangler pages deploy .vercel/output/static --project-name iris-dashboard
    ```

### `README.md` (modify, ~+15 LoC)

Update the local-development section:
- Migration note: previous `.iris/iris.db` → wrangler-managed local D1 at `.wrangler/state/v3/d1/...`.
- The first `pnpm db:reset` after pulling sets things up.
- Add a "Production deploy" subsection pointing at both DEPLOY.md (Worker) and DEPLOY-PAGES.md (dashboard).

### `next.config.ts` already covered above

### `app/api/ingest/route.ts` already covered

### `worker/index.ts`, `worker/handler.ts`, `worker/test.ts`

- `worker/index.ts` — no changes (already an edge Worker).
- `worker/handler.ts` — no changes.
- `worker/test.ts` — retarget the SQLite path.

## Micro-decisions (auto-resolved on superyolo)

- **0.9.a — `IrisDb` union vs single type.** *Recommendation: union (better-sqlite3 + D1).* In phase 0.6 we made it just better-sqlite3 because chain narrowing was painful. With the dashboard now actually using D1, the union is more honest; we keep the "as unknown as IrisDb" casts at the boundaries. **Resolved: take recommendation — flip to union, document the cast pattern.**
- **0.9.b — One config file or two.** *Recommendation: one `wrangler.toml` covering Worker + Pages.* Pages config in wrangler.toml is limited; bindings happen via dashboard or deploy flags. The shared D1 entry is the key win. **Resolved: take recommendation.**
- **0.9.c — Local D1 path resolution strategy.** *Recommendation: filesystem-glob the `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite` directory.* Tradeoff: relies on wrangler's internal directory layout, which is documented but not formally stable. Alternative is `wrangler d1 execute --local --json` per query, which is much slower for seed scripts. **Resolved: take recommendation.**
- **0.9.d — `setupDevPlatform()` in `next.config.ts` always or only in dev.** *Recommendation: only in dev (`NODE_ENV === 'development'`).* It's a no-op in production builds anyway, but explicit is better. **Resolved: take recommendation.**
- **0.9.e — `getDb()` async vs sync with eager init.** *Recommendation: async, lazy.* Sync would require eager top-level await on the binding which doesn't work at module load in edge. **Resolved: take recommendation.**
- **0.9.f — Drop or keep the old `db/migrate.ts` script.** *Recommendation: delete.* Wrangler's `d1 migrations apply` does it; keeping a parallel script invites drift. **Resolved: take recommendation.**
- **0.9.g — Pages env vars: `wrangler pages secret put` vs dashboard.** *Recommendation: CLI in the doc, dashboard as fallback.* Reproducible. **Resolved: take recommendation.**
- **0.9.h — `nodejs_compat` flag.** *Recommendation: yes — next-on-pages needs Buffer / process polyfills.* **Resolved: take recommendation.**

## NOT in this PR

- Actually executing `wrangler pages deploy`.
- Cloudflare Access automated configuration.
- App-level auth (single-password + signed cookie).
- Custom-domain automation.
- Migrating data from `.iris/iris.db` into wrangler-managed D1.
- Schema changes.
- Read replicas / caching.
- Removing `/api/ingest` HTTP endpoint.
- Tests.

## Acceptance checklist

- [ ] `pnpm install` succeeds.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` clean.
- [ ] `pnpm build` succeeds (standard Next build still works).
- [ ] `pnpm pages:build` succeeds (next-on-pages produces `.vercel/output/static`).
- [ ] `pnpm db:reset` (post-refactor): runs `wrangler d1 migrations apply --local`, then the seed script populates the wrangler-local SQLite. No `.iris/iris.db` is created.
- [ ] `pnpm worker:test` parses the sample `.eml` and writes to the wrangler-local D1; the row is visible to `pnpm dev`.
- [ ] `pnpm dev` boots; `/`, `/settings/domains`, `/compose` all render with data from the wrangler-local D1.
- [ ] `pnpm exec wrangler deploy --dry-run --outdir=/tmp/x` (the existing Worker deploy check) still bundles cleanly.
- [ ] DEPLOY-PAGES.md reads top-to-bottom as a runnable walkthrough.
- [ ] No regression: Focus / Triage / Grandma / reader pane / domain-add / settings tabs / inbound HTTP + Worker / outbound compose all work.
- [ ] No `(no text body)` regression on HTML threads.

## Line budget

Target: **~310 lines** of hand-written code (next.config.ts ~25, client.ts rewrite ~70, queries.ts +6, route handlers +6, action +2, seed.ts ~+15, worker/test.ts +10, wrangler.toml +20, DEPLOY-PAGES.md prose excluded, README +15, .gitignore +2, package.json scripts +6). DEPLOY-PAGES.md (~90 LoC) excluded as documentation. 25% tripwire: **~390 LoC**. The risk is `getDb()` getting hairy or `setupDevPlatform()` requiring more shimming than the docs suggest.
