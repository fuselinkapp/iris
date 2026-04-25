# Phase 0.2 — DB schema + Grandma renders threads (plan)

**Story:** `docs/phase-0.2-db-and-grandma-story.md`

## Goal

Stand up the full v0 SQLite schema via Drizzle (D1-shaped, locally backed by better-sqlite3), seed it with believable fake mail, and wire `Grandma` mode to render a per-mailbox thread list driven by Server Components reading from the local DB.

## Changes

### Dependencies (`package.json`)

- Add: `drizzle-orm`, `better-sqlite3`, `@types/better-sqlite3` (dev), `drizzle-kit` (dev), `tsx` (dev — for running the seed script).
- Scripts: `db:generate` (drizzle-kit generate), `db:migrate` (custom node script applying SQL files), `db:seed` (`tsx db/seed.ts`), `db:reset` (rm db file, migrate, seed).

### `drizzle.config.ts` (new)

- Dialect `sqlite`, schema `./db/schema.ts`, out `./db/migrations`, dbCredentials pointing at `./.iris/iris.db`.

### `db/schema.ts` (new, ~140 LoC)

Full v0 model. All `id` columns `text` UUIDs, `created_at`/`updated_at` as `integer` Unix epochs.

- `domains` — `id`, `domain` (unique), `verified_at`, `dkim_status`, `created_at`.
- `mailboxes` — `id`, `domain_id` (FK → domains, on-delete cascade), `local_part`, `display_name`, `created_at`. Unique index on `(domain_id, local_part)`.
- `threads` — `id`, `mailbox_id` (FK), `subject`, `snippet`, `last_message_at`, `unread_count` (denormalized for cheap mailbox aggregates — yes, mild contradiction with story doc's "derive on read"; resolved in micro-decision 0.2.b below), `message_count`, `created_at`.
- `messages` — `id`, `thread_id` (FK cascade), `from_address`, `from_name`, `to_addresses` (text — JSON-stringified array), `cc_addresses`, `bcc_addresses`, `subject`, `html`, `text`, `headers` (text — JSON), `raw_r2_key`, `read_at` (nullable epoch), `received_at`.
- `attachments` — `id`, `message_id` (FK cascade), `filename`, `mime`, `size`, `r2_key`.
- `labels` — `id`, `mailbox_id` (FK cascade), `name`, `color`, `created_at`. Unique on `(mailbox_id, name)`.
- `message_labels` — junction `(message_id, label_id)` — composite PK, both FK cascade.
- `contacts` — `id`, `email` (unique), `name`, `last_seen_at`, `created_at`.

### `db/migrations/` (generated)

- One initial migration file emitted by `drizzle-kit generate`. Committed.
- `db/migrations/meta/` — drizzle's snapshot files. Committed.

### `db/migrate.ts` (new, ~25 LoC)

- Reads SQL files from `db/migrations/`, applies them in order against the local SQLite file. Idempotent (uses Drizzle's `migrate()` helper).
- Run via `tsx db/migrate.ts` from the `db:migrate` script.

### `db/seed.ts` (new, ~140 LoC)

- Opens local DB, transactionally:
  1. Truncates all tables (ordered by FK dep).
  2. Inserts 2 domains.
  3. Inserts 3 mailboxes.
  4. Inserts 18 threads spread across the mailboxes (10 / 5 / 3) with realistic subjects from a hand-written `SEEDS` array.
  5. Inserts 1 message per thread (no multi-message threads this phase — keeps seed simple, schema still supports them).
  6. Updates each thread's `last_message_at`, `message_count`, `unread_count` from the inserted messages.
- Subject seeds: real-product senders — Stripe payout notification, Vercel deploy succeeded, Postmark monthly invoice, GitHub PR review request, Linear issue assigned, "Re: pricing question" from a fake customer, calendar invite, Cloudflare alert, Anthropic billing receipt, "your password reset code" (single-use code), etc.
- Idempotent via the truncate.

### `lib/db/client.ts` (new, ~25 LoC)

- `getDb()` returns a Drizzle `BetterSQLite3Database<typeof schema>` instance.
- Uses module-level singleton (`let _db`) to avoid reopening the file per request in dev.
- Sets `pragma foreign_keys = ON` and `pragma journal_mode = WAL` on first open.
- Path resolved from `process.cwd() + '/.iris/iris.db'`. Creates the directory if missing.

### `lib/db/index.ts` (new, ~10 LoC)

- Re-exports `getDb` from `./client` and `* as schema` from `@/db/schema`.
- This is the single import surface for the rest of the app.

### `lib/db/queries.ts` (new, ~70 LoC)

- `listMailboxes()` — returns mailboxes with their domain joined and a derived `unreadCount` (from threads.unread_count sum). Used by the mailbox column.
- `listThreads(mailboxId | 'all')` — returns threads for the selected mailbox (or all), joined to `mailboxes` and `domains` for display, ordered by `last_message_at desc`.
- Both functions accept an optional `db` parameter for testability; default to `getDb()`.

### `lib/format-relative.ts` (new, ~20 LoC)

- `formatRelative(epochMs)` — returns `"just now"`, `"3m"`, `"2h"`, `"3d"`, or a `MMM d` date string for older. Hand-rolled, no Intl.

### `app/(app)/page.tsx` (modify)

- Becomes an `async` Server Component. Reads `mode` cookie (no — mode lives in localStorage, can't read on server). Resolution: keep the home view client-side for Focus/Triage as today, but **render the Grandma view via a child Server Component invoked when `mode === 'grandma'`**.
- Concretely: home page renders `<TodayView />` (existing client component) which conditionally swaps in `<GrandmaView />` (new client component) based on `useMode()`. `<GrandmaView />` itself fetches via a route segment — *no, wait, that drags in API routes*. **Plan delta resolved here, not later**: `<GrandmaView />` is a client component that calls a Server Action (`getGrandmaData`) on mount. Server Action reads from `getDb()`. This keeps mode state on the client, lets Grandma fetch from the DB, and avoids inventing an API surface this phase.
- `app/(app)/page.tsx` itself stays unchanged shape; the work happens in `<TodayView />` and the new `<GrandmaView />`.
- Add `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'` to the home page so it doesn't try to prerender (better-sqlite3 won't run on edge or at build).

### `app/actions/grandma.ts` (new, ~25 LoC)

- `'use server';` — exports `async function getGrandmaData(mailboxId: string | null)` returning `{ mailboxes, threads }`. Calls `listMailboxes()` and `listThreads(mailboxId)`.

### `components/today-view.tsx` (modify, ~+10 LoC)

- When `mode === 'grandma'`, render `<GrandmaView />` instead of the current empty-state markup. Keep the centered layout for Focus/Triage.

### `components/grandma-view.tsx` (new, ~110 LoC)

- Client component. On mount and on mailbox change, calls `getGrandmaData(mailboxId)` Server Action and stores result in local state.
- Renders a 2-column grid inside the main pane: mailbox list (left, ~240px) + thread list (right, fills).
- Mailbox list: "All inboxes" pseudo-entry on top, then domain headers with their mailboxes nested. Each row shows mailbox local-part, full address (muted), and unread count chip.
- Thread list: each row shows sender name (bold) + email (muted), subject, snippet (muted, 1 line truncate), relative time. Hover highlights row.
- Selected mailbox stored in URL via `useRouter` + `useSearchParams` (`?mailbox=...`).
- Empty state: if seeded DB is empty, render "No threads yet — run `pnpm db:seed`."

### `.gitignore` (modify)

- Add `.iris/` to ignore the local DB file.

### `next.config.ts` (modify)

- Add `serverExternalPackages: ['better-sqlite3']` so Next doesn't try to bundle the native module.

### `README.md` (modify, ~+12 LoC)

- Add a "Local development" section: install, `pnpm db:migrate && pnpm db:seed`, `pnpm dev`. Worth 12 lines.

## Micro-decisions (auto-resolved on superyolo)

- **0.2.a — Server Action vs API route for Grandma data fetch.** *Recommendation: Server Action.* Tradeoff: Server Actions feel "POST-y" for a read, but they let us co-locate the query with the consumer and avoid inventing `/api/grandma`. Phase 0.3 may revisit when real routes appear. **Resolved: take recommendation.**
- **0.2.b — Unread count: derived vs denormalized.** *Recommendation: denormalize on `threads.unread_count` (and `mailboxes` derives from sum of its threads on read).* Tradeoff: contradicts the story doc's lean ("derive on read"). Reason for flipping: with the schema already including a denorm `last_message_at` and `message_count` for sort order and counters, adding `unread_count` keeps the row coherent — and the seed writes them explicitly anyway. Phase 0.3's inbound handler will write all three together. **Resolved: take recommendation; story doc's lean was wrong, plan supersedes.**
- **0.2.c — Mailbox column inside Grandma view vs reusing sidebar.** *Recommendation: a dedicated mailbox column inside `<GrandmaView />`, NOT a modification to the existing sidebar.* Tradeoff: a tiny visual redundancy with the sidebar's existing "Mailboxes" placeholder, but keeps Grandma self-contained and the existing sidebar untouched (Focus/Triage stay minimal as the spec wants). The sidebar's "+ Add domain" placeholder stays disabled. **Resolved: take recommendation.**
- **0.2.d — UUID generation.** *Recommendation: `crypto.randomUUID()` everywhere (both seed and future writers), not Drizzle's `$defaultFn`.* Tradeoff: explicit ID at insert time vs auto-default. Explicit is easier to debug and test. **Resolved: take recommendation.**
- **0.2.e — Address fields (`to_addresses`, etc.) shape.** *Recommendation: TEXT column storing JSON-stringified `string[]` (parsed in app code).* Tradeoff: SQLite has no native JSON type but D1 supports `json_*` SQL functions; we don't need them yet. **Resolved: take recommendation.**
- **0.2.f — Migration runner.** *Recommendation: Drizzle's built-in `migrate()` from `drizzle-orm/better-sqlite3/migrator`.* Tradeoff: adds a tiny tsx script vs a custom file walker. Built-in is two lines and tracks history in a `__drizzle_migrations` table. **Resolved: take recommendation.**
- **0.2.g — `next.config.ts` external package config.** *Recommendation: `serverExternalPackages: ['better-sqlite3']`.* Tradeoff: required because better-sqlite3 ships a `.node` binary Next can't bundle; this is the documented escape hatch. **Resolved: take recommendation.**
- **0.2.h — Snippet length.** *Recommendation: 100-char truncation, written by seed.* Tradeoff: any number is arbitrary; 100 fits a single line in our typography. **Resolved: take recommendation.**

## NOT in this PR

- Reader pane / message body view.
- Real inbound (no Email Routing, no Postmark webhook).
- Outbound send (Resend integration).
- D1 production binding wiring (`wrangler.toml`, deploy config).
- Auth.
- Search, labels UI, attachment UI, contacts auto-extraction.
- Thread mutations (mark read, archive, delete).
- Pagination.
- `Focus` and `Triage` mode UI changes.
- Tests.
- Mobile responsive treatment of the Grandma column.

## Acceptance checklist

- [ ] `pnpm install` succeeds.
- [ ] `pnpm db:generate` re-creates the migration cleanly (no diff after).
- [ ] `pnpm db:migrate` creates `.iris/iris.db` and applies the schema.
- [ ] `pnpm db:seed` populates 2 domains, 3 mailboxes, 18 threads, 18 messages.
- [ ] `pnpm dev` boots without errors.
- [ ] Default mode (`Focus`) on `/` renders unchanged from phase 0.1.
- [ ] Switching to `Triage` renders unchanged from phase 0.1.
- [ ] Switching to `Grandma` shows a mailbox column with All inboxes + 2 domains + 3 mailboxes (with unread counts).
- [ ] Clicking a mailbox updates `?mailbox=` and renders threads only for that mailbox.
- [ ] "All inboxes" shows all 18 threads ordered by `last_message_at desc`.
- [ ] Each thread row shows sender, subject, snippet, relative time — no broken layout.
- [ ] Reload preserves the selected mailbox via the URL query.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm build` succeeds.
- [ ] `pnpm lint` clean.

## Line budget

Target: **~600 lines** of hand-written code (excluding generated migration SQL, package.json deltas, and lockfile). 25% tripwire: ~750 LoC. The bulk: schema (~140), seed (~140), Grandma view (~110), queries (~70), other (~140).
