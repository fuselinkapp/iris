# Phase 0.6 — CF Email Worker (plan)

**Story:** `docs/phase-0.6-cf-worker-story.md`

## Goal

Make the existing `ingestMessage` pipeline runtime-agnostic, then build the Cloudflare Email Worker that parses raw RFC822 with postal-mime and calls it with a D1 binding — testable locally via `pnpm worker:test` against `.eml` fixtures, deployable later via the bundled `DEPLOY.md` walkthrough.

## Changes

### `lib/db/types.ts` (new, ~12 LoC)

- Exports `IrisDb` — the Drizzle union type covering both runtimes.
  ```ts
  import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
  import type { DrizzleD1Database } from 'drizzle-orm/d1';
  import type * as schema from '@/db/schema';
  export type IrisDb = BetterSQLite3Database<typeof schema> | DrizzleD1Database<typeof schema>;
  ```
- Pure types only — type-only imports, no value-level pull-in of either runtime.

### `lib/email/ingest.ts` (modify, ~+10 / -5 LoC)

- Drop `import 'server-only'` (the Worker bundle pulls this file in; `server-only` is a Next-only marker and would error in a Worker context).
- Drop `import { randomUUID } from 'node:crypto'`. Use the global `crypto.randomUUID()` everywhere — works in Node 19+ and in Workers without an import.
- Drop `import { getDb } from '@/lib/db/client'` — caller now passes the DB.
- Change signature: `export async function ingestMessage(payload: IngestPayload, db: IrisDb): Promise<IngestResult>`.
- Remove the internal `const db = getDb();` line.
- Subtle: the better-sqlite3 transaction is sync, the D1 transaction is async. Drizzle abstracts this with `db.transaction(async (tx) => ...)` or `db.transaction((tx) => ...)`. Currently the code uses sync. **Both runtimes accept the sync form** (D1 just returns a Promise; sync callbacks return values that get wrapped). Verify in implementation.

### `lib/db/client.ts` (modify, ~+1 LoC)

- Add `import 'server-only'` at top — server-only stays in *this* file (the Node-only one), since this is what guards the better-sqlite3 import from leaking into client bundles. Already present? Confirm during implementation.

### `app/api/ingest/route.ts` (modify, ~+2 LoC)

- Import `getDb` from `@/lib/db/client`.
- Pass `getDb()` as the second arg to `ingestMessage(body, getDb())`. No other changes.

### `worker/handler.ts` (new, ~70 LoC)

Pure mapping function — does not touch CF env globals, so it's importable by the test harness.

```ts
import PostalMime from 'postal-mime';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '@/db/schema';
import { ingestMessage, type IngestPayload, type IngestResult } from '@/lib/email/ingest';
import type { IrisDb } from '@/lib/db/types';

export async function handleEmail(rawEml: string, db: IrisDb): Promise<IngestResult> {
  const parsed = await PostalMime.parse(rawEml);
  const payload: IngestPayload = {
    from: parsed.from
      ? { address: parsed.from.address, name: parsed.from.name }
      : undefined,
    to: (parsed.to ?? []).map((a) => a.address),
    cc: (parsed.cc ?? []).map((a) => a.address),
    bcc: (parsed.bcc ?? []).map((a) => a.address),
    subject: parsed.subject ?? '',
    text: parsed.text ?? null,
    html: parsed.html ?? null,
    headers: Object.fromEntries(
      (parsed.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]),
    ),
    inReplyTo: parsed.inReplyTo ?? undefined,
    references: parsed.references
      ? Array.isArray(parsed.references)
        ? parsed.references
        : [parsed.references]
      : undefined,
    receivedAt: parsed.date ? new Date(parsed.date).getTime() : Date.now(),
  };
  return ingestMessage(payload, db);
}

export function dbFromD1(d1: D1Database): IrisDb {
  return drizzle(d1, { schema });
}
```

### `worker/index.ts` (new, ~50 LoC)

Worker entry. Implements the CF email handler.

```ts
import { handleEmail, dbFromD1 } from './handler';

export interface Env {
  IRIS_DB: D1Database;
  IRIS_RAW: R2Bucket;  // declared, unused this phase
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    const raw = await new Response(message.raw).text();
    const db = dbFromD1(env.IRIS_DB);
    const result = await handleEmail(raw, db);
    if (!result.ok) {
      // Reject delivery so CF retries / surfaces the failure.
      message.setReject(`ingest_failed:${result.reason}`);
      console.error('[iris worker] ingest failed:', result);
      return;
    }
    console.log('[iris worker] landed:', {
      threadId: result.threadId,
      messageId: result.messageId,
      verifiedDomain: result.verifiedDomain,
    });
  },
};
```

`ForwardableEmailMessage`, `D1Database`, `R2Bucket`, `ExecutionContext` types come from `@cloudflare/workers-types` (transitive dep of `wrangler`).

### `worker/test.ts` (new, ~50 LoC)

- Reads a `.eml` path from `process.argv[2]` (default: `samples/inbound/raw/01-stripe.eml`).
- Opens `.iris/iris.db` via better-sqlite3 (the same path the dev server uses).
- Calls `handleEmail(raw, db)`.
- Pretty-prints the result.

```ts
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '@/db/schema';
import { handleEmail } from './handler';

async function main() {
  const path = process.argv[2] ?? 'samples/inbound/raw/01-stripe.eml';
  const raw = readFileSync(path, 'utf-8');
  const sqlite = new Database('.iris/iris.db');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  const result = await handleEmail(raw, db);
  console.log(JSON.stringify(result, null, 2));
  sqlite.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

### `samples/inbound/raw/01-stripe.eml` (new, ~30 LoC)

A minimal but real RFC822 message. Plain text body, basic headers (From, To, Subject, Date, Message-ID). Recipient is `hello@catnap.dev` so it lands in the existing seed.

### `wrangler.toml` (new, ~25 LoC)

```toml
name = "iris-mail-worker"
main = "worker/index.ts"
compatibility_date = "2025-04-01"

# D1 binding for the inbox database. Create once with:
#   wrangler d1 create iris-d1
# then paste the database_id below and apply migrations:
#   wrangler d1 migrations apply iris-d1
[[d1_databases]]
binding = "IRIS_DB"
database_name = "iris-d1"
database_id = "REPLACE_WITH_YOUR_D1_ID"
migrations_dir = "db/migrations"

# R2 binding for raw .eml archive (declared now, written by the next phase).
# Create once with: wrangler r2 bucket create iris-raw
[[r2_buckets]]
binding = "IRIS_RAW"
bucket_name = "iris-raw"
```

### `package.json` (modify, ~+5 LoC, +2 deps)

- Add deps:
  - `postal-mime` (runtime — used by Worker and test harness)
  - `wrangler` (devDep — local sim + d1 migrations apply)
- Add scripts:
  - `worker:test`: `tsx worker/test.ts`
  - `worker:dev`: `wrangler dev`

### `DEPLOY.md` (new, ~80 LoC of prose, excluded from line budget)

Walkthrough:

1. Install Wrangler globally or use the project's: `pnpm exec wrangler --version`.
2. Authenticate: `pnpm exec wrangler login`.
3. Create the D1 database: `pnpm exec wrangler d1 create iris-d1`. Copy the `database_id` from the output into `wrangler.toml`.
4. Apply migrations to D1: `pnpm exec wrangler d1 migrations apply iris-d1`.
5. Create the R2 bucket: `pnpm exec wrangler r2 bucket create iris-raw`.
6. Deploy the Worker: `pnpm exec wrangler deploy`.
7. In the Cloudflare dashboard:
   - Add your domain to Email Routing (must already be on Cloudflare DNS).
   - Create a catch-all or per-address rule that forwards to the `iris-mail-worker` Worker.
   - Optionally enable DKIM via the dashboard.
8. Send a test email to `hello@yourdomain.com`. Check `pnpm exec wrangler tail` for the `[iris worker] landed:` log line.

Includes a "Local development" section explaining `wrangler dev --local` and `wrangler d1 migrations apply iris-d1 --local` for the local D1 simulator.

### `.gitignore` (modify, +2 LoC)

Add `.wrangler/` and `worker-configuration.d.ts` (autogenerated by wrangler types).

### `tsconfig.json` (modify, +1 LoC)

Add `worker/` to `include`. The path alias `@/*` already covers it.

### `next.config.ts`

- **No changes.** Postal-mime is pure JS and doesn't need to be externalized.

### `db/schema.ts`, `db/seed.ts`, `lib/email/cloudflare-records.ts`, `app/(app)/**`, `components/**`

- **No changes.**

### `README.md` (modify, +12 LoC)

Append a "Production deploy" section pointing at `DEPLOY.md`. Two-line stub.

## Micro-decisions (auto-resolved on superyolo)

- **0.6.a — IrisDb union vs generic.** *Recommendation: union type.* Tradeoff: generics would let each call site narrow to the runtime, but Drizzle's query builder is structurally compatible across both, so the union is enough and reads cleaner. **Resolved: take recommendation.**
- **0.6.b — `crypto.randomUUID()` vs `node:crypto` import.** *Recommendation: global `crypto.randomUUID()`.* Tradeoff: the global is universal in Node 19+ and Workers; a Node-specific import would break the Worker bundle. **Resolved: take recommendation.**
- **0.6.c — Drop `'server-only'` from ingest.ts.** *Recommendation: yes.* Tradeoff: ingest.ts is now imported by both the Next route handler AND the Worker. `'server-only'` was never enforcing a runtime guarantee — better-sqlite3 was the actual guardrail, and that's now in `lib/db/client.ts` only. **Resolved: take recommendation.**
- **0.6.d — `worker/handler.ts` vs inlined into `worker/index.ts`.** *Recommendation: split.* Tradeoff: an extra file, but keeps the testable bit (`handleEmail`) separate from the Worker entry that needs CF runtime types. **Resolved: take recommendation.**
- **0.6.e — Reject vs accept on ingest failure.** *Recommendation: `message.setReject(reason)` so CF Email Routing surfaces the failure (the sender gets a bounce).* Tradeoff: silently dropping mail is worse than bouncing — at least the sender knows something failed. **Resolved: take recommendation.**
- **0.6.f — postal-mime version.** *Recommendation: latest stable (`^2`).* The `parsed.headers` shape is `Array<{ key, value }>` in v2; the mapper handles that. **Resolved: take recommendation.**
- **0.6.g — Migrations folder for D1.** *Recommendation: reuse `db/migrations/` (the Drizzle output).* Wrangler's `d1 migrations apply` reads SQL files from any folder; pointing at the existing one means no duplication. **Resolved: take recommendation.**
- **0.6.h — D1 binding name.** *Recommendation: `IRIS_DB`.* Matches the worker handler's `env.IRIS_DB` access. **Resolved: take recommendation.**
- **0.6.i — R2 binding declared but unused this phase.** *Recommendation: yes, declare now.* Tradeoff: a tiny bit of dead config, but the next phase (raw-archive) becomes a one-line write rather than a config + write. **Resolved: take recommendation.**
- **0.6.j — `wrangler` as a project devDep vs global.** *Recommendation: project devDep so DEPLOY.md commands are reproducible.* **Resolved: take recommendation.**

## NOT in this PR

- `wrangler deploy` execution; real CF account; real domain pointed at the Worker.
- Pages deploy of the Next.js app / `@cloudflare/next-on-pages`.
- Raw `.eml` archive to R2 (binding declared, not written).
- Attachment extraction.
- HTML rendering / sandboxed iframe.
- DKIM/SPF re-verification.
- Spam, bounces, replies, outbound.
- Catch-all / aliases / wildcard subdomains.
- Local SQLite ↔ D1 data migration.
- Real-time push / cron triggers.
- Per-domain Worker routing.
- Tests (the `worker:test` harness IS the manual verification).

## Acceptance checklist

- [ ] `pnpm install` succeeds.
- [ ] `pnpm typecheck` passes (including `worker/` after `tsconfig.json` include).
- [ ] `pnpm lint` clean.
- [ ] `pnpm build` (Next.js) succeeds — proves the refactor of `ingest.ts` didn't break the HTTP path.
- [ ] `pnpm db:reset && pnpm dev` boots; the existing `samples/inbound/01-stripe-payout.json` curl still lands as expected (no regression).
- [ ] `pnpm worker:test samples/inbound/raw/01-stripe.eml` parses and lands the message in `.iris/iris.db`. Result has `ok: true` and a `verifiedDomain` boolean.
- [ ] Inspecting the DB after the worker:test run shows the message in `messages`, the thread in `threads`, the contact in `contacts`.
- [ ] `wrangler.toml` validates: `pnpm exec wrangler types --dry-run` (or `wrangler --version` if types subcommand isn't available).
- [ ] `DEPLOY.md` reads top-to-bottom as a runnable walkthrough; commands are copy-pasteable.
- [ ] The Worker entry (`worker/index.ts`) typechecks against `@cloudflare/workers-types`.
- [ ] No regression: Focus / Triage / Grandma / reader pane / domain-add / curl ingest / settings tabs all unchanged.

## Line budget

Target: **~370 lines** of hand-written code (worker/index 50, worker/handler 70, worker/test 50, ingest.ts delta ~+5/-5, types 12, route.ts delta ~+2, sample .eml 30, wrangler.toml 25, package.json delta ~5, .gitignore +2, README +12, tsconfig +1, plus ingest.ts internal touch-ups). DEPLOY.md (~80 LoC) excluded as documentation. 25% tripwire: **~470 LoC**. If we blow past, surface and stop — likely candidate for the trip is postal-mime API surprises forcing a bigger mapper.
