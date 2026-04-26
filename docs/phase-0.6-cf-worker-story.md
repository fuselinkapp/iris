# Phase 0.6 — Cloudflare Email Routing Worker (story)

## Who & what

The vibe-code founder added `notebook.fyi` in 0.4, watched it land via the curl-driven ingest endpoint in 0.5, and now wants the Worker that will *actually* catch real mail when DNS points at it. They run `pnpm worker:test` against a sample `.eml` file and watch postal-mime parse it, then call the same `ingestMessage` the HTTP endpoint uses, and see the message land in the local D1 database — proving the production code path end-to-end without needing a Cloudflare account yet. When they're ready, `DEPLOY.md` walks them through `wrangler login`, creating the D1 + R2 resources, and `wrangler deploy`. Success: they can read `worker/index.ts` and `wrangler.toml` and trust that the moment the first real email hits CF Email Routing, it lands in Iris exactly the way the curl tests do.

## In scope

- **`worker/index.ts`** — Cloudflare Email Worker entry. Implements the `email(message, env, ctx)` handler.
- **`worker/handler.ts`** — Pure function `handleEmail(rawEml, recipients, from, env)` that:
  1. Parses the raw RFC822 with `postal-mime`.
  2. Maps the parsed result to an `IngestPayload`.
  3. Constructs a Drizzle D1 client from `env.IRIS_DB`.
  4. Calls `ingestMessage(payload, db)`.
- **Binding-aware DB factory** — refactor `lib/email/ingest.ts` so `ingestMessage` accepts a `db: IrisDb` parameter (a union type that covers both `BetterSQLite3Database` and `DrizzleD1Database` over the same schema). The HTTP route handler passes `getDb()` (better-sqlite3); the Worker passes `drizzle(env.IRIS_DB)`. This is the abstraction that's been deferred since phase 0.2.
- **`wrangler.toml`** — defines the Worker, an `IRIS_DB` D1 binding, an `IRIS_RAW` R2 binding (declared but not used yet — the parser stores nothing in R2 this phase; binding exists so the next phase can flip on raw-archive without a config change).
- **`postal-mime` dep** — small (~30KB), edge-runtime compatible MIME parser used by both the Worker and the local test harness.
- **`pnpm worker:test`** script — local test harness. Reads a `.eml` file from disk, runs it through the same `handleEmail` function the Worker uses, writes to the local `.iris/iris.db` (not D1; the harness uses the better-sqlite3 path so you can test without wrangler). Prints a summary of what landed.
- **`samples/inbound/raw/01-stripe.eml`** — one real-world-ish raw RFC822 fixture for the harness. Plain MIME, no attachments. Demonstrates the parser → ingest path.
- **`DEPLOY.md`** — walkthrough: `wrangler login`, create D1 (`wrangler d1 create iris-d1`), apply migrations (`wrangler d1 migrations apply iris-d1`), create R2 bucket, `wrangler deploy`, configure CF Email Routing for a domain to forward to the Worker. Flags the known steps that aren't automated.
- **No regression**: the `/api/ingest` HTTP endpoint and all four existing samples still work identically; the Worker is the second consumer of `ingestMessage`, not a replacement.

## Out of scope

- **Actually deploying.** No `wrangler deploy` execution this phase. No real CF account needed. The walkthrough exists; running it is the founder's call.
- **Pages deploy of the Next.js app.** This phase does not add `@cloudflare/next-on-pages` or wire the dashboard for edge runtime. The dashboard stays Node-only for now.
- **Raw `.eml` archival to R2.** R2 binding exists in `wrangler.toml` so the next phase can use it without a config change, but the parser does not write to R2.
- **Attachment extraction.** Schema supports it; the parser doesn't yet enumerate parts and write to the `attachments` table. Deferred.
- **HTML rendering / sandboxed iframe** — same status as 0.5: stored, not rendered.
- **DKIM/SPF re-verification of the parsed message.** We trust CF Email Routing's gate; it would not deliver to the Worker if the upstream check failed. Iris does not double-check.
- **Spam filtering / quarantine.**
- **Bounces / replies / outbound.**
- **Catch-all addresses, alias resolution, wildcard subdomains.** Same exact-match rule as 0.5.
- **Migrating local SQLite data to D1.** They are independent stores; the dev DB is separate from the production D1. Documented in DEPLOY.md.
- **Real-time push** to open browser sessions when new mail lands.
- **Cron triggers** for retries, sweeps, etc.
- **Per-domain Worker routing.** One Worker handles all domains.
- **Tests.** The `pnpm worker:test` script *is* the manual verification path; no Vitest yet.

## Constraints & assumptions

- **The Worker bundle must not pull in `better-sqlite3`.** That requires `lib/email/ingest.ts` to drop its current `import 'server-only'` (which is a Next-specific marker, not a runtime guard) and to drop its dependency on `@/lib/db/client` (which imports better-sqlite3). After this phase, ingest.ts is pure-Drizzle and runtime-agnostic.
- **`crypto.randomUUID()` instead of `node:crypto`** in ingest.ts. Both Node 19+ and Workers expose it on the global Web Crypto. Cross-runtime safe.
- **D1 is the same SQLite dialect** as better-sqlite3, so the migrations from `db/migrations/` apply unchanged via `wrangler d1 migrations apply`.
- **The `/api/ingest` route handler still works exactly as before.** It now passes `getDb()` to `ingestMessage` explicitly — internal refactor, no API change.
- **Worker bundling**: Wrangler's default esbuild. No custom build step.
- **`postal-mime` API**: `PostalMime.parse(raw)` returns `{ from, to, cc, subject, text, html, headers, inReplyTo, references, … }` — a near-perfect match to our `IngestPayload`. The handler does light field mapping.
- **D1 binding name**: `IRIS_DB`. R2 binding name: `IRIS_RAW`. Both documented in `wrangler.toml`.
- **Local D1 simulation** (`wrangler dev --local`) uses miniflare's SQLite at `.wrangler/state/v3/d1/...`. Separate from `.iris/iris.db`. The walkthrough explains the two paths.
- **Worker test harness uses the local SQLite path** (`.iris/iris.db`), not miniflare's D1. This is intentional: the harness exercises the parser + the same `ingestMessage` writer, but uses the same dev DB you've been using since 0.2 so threading and existing data work as expected. The Worker-on-D1 path is exercised by `wrangler dev` once the user opts in.
- **Assumption**: postal-mime's parsed output shape is stable across the bundled fixtures. The mapper handles missing optional fields (no text body, no headers, no inReplyTo) defensively.
- **Assumption**: it's OK that `wrangler` is added as a dev dep. ~50MB. Worth it for the local simulation and the `d1 migrations apply` command.
- **Assumption**: DEPLOY.md is durable enough to follow without further hand-holding. The user has run `wrangler` before or is comfortable reading the official docs as a fallback.

## Open implementation questions (planner-decidable)

- **Where the IrisDb union type lives**: `lib/db/types.ts`. Imported by `ingest.ts` (no Node deps), `lib/db/client.ts` (Node-only better-sqlite3), and the Worker (D1-only).
- **Shared code organization**: `worker/handler.ts` is pure (no Worker-runtime imports), `worker/index.ts` is the entry that pulls together the handler + env types. Keeps the testable bit separable from the Worker glue.
- **Postal-mime address mapping**: postal-mime returns `to: Array<{ name?: string; address: string }>`. We flatten to `string[]` (just addresses) for the IngestPayload.
- **Raw archive**: even though R2 isn't written this phase, the handler stuffs `rawR2Key: null` into the payload. The schema accepts it. The next phase wires the actual upload.
- **`worker:test` invocation**: takes a path arg — `pnpm worker:test samples/inbound/raw/01-stripe.eml`. Defaults to the sample if no arg.
- **Wrangler config**: declares `compatibility_date = "2025-04-01"` (recent), `compatibility_flags = ["nodejs_compat"]` only if needed (probably not).
- **Worker entry point in `wrangler.toml`**: `main = "worker/index.ts"`. Wrangler bundles TypeScript directly.
- **Routes / triggers in `wrangler.toml`**: no `routes` (this is an Email Worker, triggered by Email Routing, not HTTP). DEPLOY.md walks through configuring the Email Routing → Worker binding in the CF dashboard.
- **The HTTP `/api/ingest` endpoint stays.** Useful for testing without wrangler, useful as a fallback ingestion path, useful if someone wants to run Iris with Postmark instead.

## Resolved questions (verbatim Q&A from discovery)

- **Q: How far does this phase go on the deploy story?** A: wrangler dev only + DEPLOY.md doc (recommended).
- **Q: How should the Worker call the ingest pipeline?** A: Direct import of `ingestMessage` with D1 binding (recommended).
