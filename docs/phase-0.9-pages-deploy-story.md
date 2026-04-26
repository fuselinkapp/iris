# Phase 0.9 — Pages deploy + binding-aware Server Component reads (story)

## Who & what

The vibe-code founder ran the phase-0.6 walkthrough, deployed the inbound Worker, pointed `notebook.fyi` at it, and watched real mail flow into D1. Then they tried to read it. The dashboard is still local-only — it reads from `.iris/iris.db` via better-sqlite3. The production D1 is a black box from the UI side. This phase fixes that: the Next.js dashboard now builds for Cloudflare Pages, every DB-touching route runs on the edge runtime, and `getDb()` returns a D1-backed Drizzle client in production (via the same `IRIS_DB` binding the Worker already uses) and a wrangler-managed local D1 client in development. Success: the founder can `pnpm pages:build && pnpm exec wrangler pages deploy`, put Cloudflare Access in front of the URL, log in with their identity, and see the real mail their Worker has been catching.

The cost: local development's storage moves from `.iris/iris.db` (a plain better-sqlite3 file) to wrangler's local D1 simulator (a SQLite file under `.wrangler/state/v3/d1/...`). The dashboard reads the same file the Worker writes to. The seed and migrate scripts target this new location. `pnpm dev` still works the same way from the user's perspective — type, click, see — but under the hood it's running through next-on-pages's dev platform with the local D1 binding wired in.

## In scope

- **`@cloudflare/next-on-pages`** as the build adapter. Adds `pnpm pages:build` and `pnpm pages:dev` scripts. Generates Pages-Functions-compatible output that `wrangler pages deploy` can publish.
- **Edge runtime everywhere** for the dashboard. Every App Router route, Server Component, Server Action, and route handler that touches DB declares `runtime = 'edge'`. The handful of static settings pages (`/settings/ai`, `/settings/modes`, `/settings/mailboxes`) can stay default but follow the same pattern for consistency.
- **`setupDevPlatform()`** in `next.config.ts` so `getRequestContext()` works in `pnpm dev` against a local wrangler-managed D1 simulator. No more `.iris/iris.db`; the dev DB is now the same D1 file the deployed Worker would write to (when run under `wrangler dev`).
- **`getDb()` becomes async** and returns a `drizzle-orm/d1`-backed client. One path, both runtimes. The route handler / Server Action callers gain an `await`. The Worker keeps its own `dbFromD1()` (already D1-only).
- **Worker config consolidated**: the existing `wrangler.toml` now declares both the Pages project AND the existing inbound Worker, sharing the `IRIS_DB` binding. Two services, one D1 database, one config file.
- **Seed + migrate scripts retargeted** to the wrangler-managed local D1 file. `pnpm db:migrate` becomes `wrangler d1 migrations apply iris-d1 --local`. `pnpm db:seed` becomes a tsx script that opens the wrangler-local SQLite path with better-sqlite3 (still allowed in CLI scripts — they're Node, not edge) and writes seed rows directly. `pnpm db:reset` deletes `.wrangler/state/v3/d1/...` and re-runs migrate + seed.
- **`pnpm worker:test` retargeted** the same way. The harness now opens the wrangler-local SQLite file so a parsed `.eml` lands in the same place `pnpm dev` reads from.
- **`DEPLOY-PAGES.md`** walkthrough: install wrangler if needed, `wrangler login`, configure Pages project, set `RESEND_API_KEY` + `IRIS_INGEST_TOKEN` as Pages env vars, `pnpm pages:build && wrangler pages deploy`, point a custom domain at it, configure Cloudflare Access in front, optional. Mirrors the structure of `DEPLOY.md` for the Worker.
- **`DEPLOY.md` updated** to reference the new shared `wrangler.toml` and the consolidated D1 setup.
- **README + .env.example update** with the new local-dev story (no `.iris/` directory; `.wrangler/` is the dev state dir now).

## Out of scope

- **Actual `wrangler pages deploy` execution.** This phase ships the config + walkthrough; you run the deploy when your account is ready.
- **Cloudflare Access wiring.** Documented in DEPLOY-PAGES.md; not automated.
- **App-level auth** (single-password + signed cookie). Still deferred — the trust boundary in production is CF Access, not the app.
- **Pages custom-domain setup automation.** Walked through in the doc; not scripted.
- **Migrating existing local data** from `.iris/iris.db` (the old store) into the new wrangler-managed D1. The new location starts empty; you re-run `pnpm db:reset`.
- **Schema changes.** None.
- **Read replicas / caching for the dashboard.** D1 is the source of truth; reads go straight there.
- **Edge-runtime support for the Worker handler.** It's already a Worker, doesn't need next-on-pages.
- **Removing the HTTP `/api/ingest` endpoint.** Stays as a fallback ingestion path for tooling and tests.
- **Tests.** None.
- **Mobile responsive treatment of any new UI.** No new UI in this phase.

## Constraints & assumptions

- **`@cloudflare/next-on-pages` requires every route to be edge-runtime-compatible.** Anything Node-only (`fs`, `path`, `node:crypto` outside Web Crypto, `better-sqlite3`) cannot be reached from a route. This phase moves better-sqlite3 entirely out of the dashboard runtime path. CLI scripts (seed, migrate, worker:test) keep using better-sqlite3 — they run in `node`/`tsx`, not in a route bundle.
- **Dev DB path moves.** The wrangler local D1 store is a SQLite file at `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite`. The hash depends on the database id in `wrangler.toml`. The seed script needs to find this file — easiest via wrangler's CLI (`wrangler d1 execute --local`) for migrations, and for the seed we open the file directly via a small helper that resolves the path.
- **`getDb()` changes signature** from sync to async. Sites updated: `lib/db/queries.ts` (every function), `app/api/ingest/route.ts`, `app/actions/send.ts`. Server Actions in `app/actions/grandma.ts` already wrap async query functions, no signature change there.
- **`crypto.randomUUID()`** continues to work (Web Crypto, available in both Node 19+ and edge).
- **Resend client construction in `lib/email/send.ts`** — still works on edge (Resend SDK is fetch-based, no Node deps).
- **`better-sqlite3` excluded from edge bundles** via a `next.config.ts` webpack alias `'better-sqlite3': false` when `nextRuntime === 'edge'`. Belt-and-suspenders since the runtime branch in `getDb()` also avoids the import in edge.
- **Routes that already declared `runtime = 'nodejs'`** (`/`, `/settings/domains`, `/compose`, `/api/ingest`) flip to `runtime = 'edge'`.
- **`process.env.IRIS_INGEST_TOKEN` and `process.env.RESEND_API_KEY`** are still read directly from `process.env`. Cloudflare Pages exposes Pages env vars as `process.env` in the edge runtime, so no API change needed.
- **Assumption**: postal-mime works on edge (it's pure JS — already used in the Worker, so confirmed).
- **Assumption**: `setupDevPlatform()` is stable enough on next-on-pages 1.x to use as our dev story. (It's the documented path.)
- **Assumption**: switching to wrangler-managed local D1 doesn't break the existing dev experience — once the user runs `pnpm db:reset` after pulling, everything they used to do continues working.
- **Assumption**: it's OK that `.iris/` becomes orphaned in existing checkouts. Documented in the README's upgrade note; user can `rm -rf .iris` to clean up.

## Open implementation questions (planner-decidable)

- **Where the binding type lives** — `worker-configuration.d.ts` is autogenerated by wrangler. Add a manual `Env` type in `lib/db/types.ts` so route code can `as` cast safely.
- **How `getDb()` handles missing binding** — throw `IRIS_DB binding not configured` if `getRequestContext().env.IRIS_DB` is undefined. The route handler error boundary will surface a 500.
- **Server Action `getMailboxesForSend` and friends** — already returning Promises, no API change. Just the underlying `await getDb()` is added.
- **Seed script wrangler-local path resolution** — use `wrangler d1 execute iris-d1 --local --command "SELECT 1"` to ensure the file exists, then glob-find `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`. Pick the only one (we have one DB).
- **Whether to consolidate `wrangler.toml` for Worker + Pages** — yes. One file at the repo root with both `[[d1_databases]]` shared and the Worker's email handler config in a `[[email]]`-style block (Worker entry stays at `worker/index.ts`). Pages deploy uses a separate `pages_build_output_dir` config.
- **Pages env vars** — IRIS_INGEST_TOKEN and RESEND_API_KEY documented in DEPLOY-PAGES.md, set via `wrangler pages secret put`.
- **Compatibility flag**: `nodejs_compat` is needed by next-on-pages for some Node API shims (Buffer, etc.). Add it to `wrangler.toml`.

## Resolved questions (verbatim Q&A from discovery)

- **Q: Which Cloudflare Pages adapter for Next.js?** A: `@cloudflare/next-on-pages` (recommended).
- **Q: Does this phase actually execute `wrangler pages deploy`?** A: Ship config + DEPLOY-PAGES.md only, you run it later (recommended).
- **Q: Auth posture for the publicly-reachable Pages deploy?** A: Cloudflare Access in front, no app-level auth (recommended).
