# Phase 0.2 — DB schema + Grandma renders threads (story)

## Who & what

The same vibe-code founder from phase 0.1 returns to Iris. The shell looks great but it's empty — there's no signal that this thing actually holds email. They flip the Mode dial to **Grandma** expecting "the classic inbox view" the copy promised, and they want to see something that reads as *real*: their domains in the sidebar, mailboxes underneath, a list of threads with subjects and sender snippets that look like the kind of mail an indie founder actually gets (Stripe payouts, Vercel deploy notifications, a Postmark invoice, a customer reply, a calendar invite). No real mail is flowing yet — this phase ships the shape of the data, the database that holds it, and the seeded reality that proves the next phase (real inbound) can wire into something coherent.

Success: `pnpm dev` boots, switching to Grandma mode shows a left-side mailbox list (per-domain, plus "All inboxes"), and clicking a mailbox renders a believable thread list. The data lives in a real SQLite database that mirrors the production D1 binding, populated by a one-shot seed script.

## In scope

- **Drizzle ORM + drizzle-kit** as the database layer. Schema-first, type-safe, matches the Cloudflare D1 ecosystem.
- **Full v0 schema from `SPEC.md`**: `domains`, `mailboxes`, `threads`, `messages`, `attachments`, `labels`, `message_labels`, `contacts`. All tables exist with appropriate indices and foreign keys, even where Grandma only reads a subset.
- **Local dev DB** via `better-sqlite3` against `./.iris/iris.db` (gitignored). Same SQL dialect as D1, so the same Drizzle schema and migrations work in both environments.
- **drizzle-kit migrations** generated from the schema, committed to `db/migrations/`. A `pnpm db:migrate` script applies them locally.
- **Seed script** (`pnpm db:seed`) that populates 2 domains (`catnap.dev`, `vibehq.com`), 3 mailboxes across them (`hello@catnap.dev`, `billing@catnap.dev`, `founder@vibehq.com`), and ~18 threads with realistic subjects and senders. Idempotent — drops and re-creates seed rows on each run.
- **DB binding abstraction** (`lib/db/index.ts`): a single `getDb()` function that returns a Drizzle client. Locally backed by better-sqlite3; in production it will swap to `drizzle-orm/d1` (the swap is preparatory in this phase — the prod path exists and typechecks but is not exercised since we're not deployed yet).
- **Grandma mode UI**: when `mode === 'grandma'`, the home view replaces its empty state with:
  - A second sidebar column (or sub-section in the existing sidebar) listing **All inboxes** + each mailbox grouped by domain. Each entry shows mailbox name and unread count (mock — derive from seed).
  - A main pane showing a flat thread list for the selected mailbox: each row has sender name + email, subject, snippet, and relative timestamp. Click does nothing yet (no reader pane this phase).
  - Selection persists in URL query (`?mailbox=hello@catnap.dev`) so reload keeps the view.
- **Server Components fetch threads** directly via Drizzle (no API route). Pages stay static-renderable in build but the home route flips to dynamic since it reads from DB.

## Out of scope

- Reader pane / message body view. Click-to-read comes in a later phase.
- Compose wiring beyond the placeholder that already exists.
- Real inbound mail (no webhook, no Email Routing handler).
- Outbound send / Resend integration.
- Auth — still single-tenant, no login.
- Cloudflare D1 binding actually exercised (no `wrangler.toml`, no deploy). The prod adapter exists for typechecking only.
- Search, labels UI, attachments UI, contacts auto-extraction.
- Thread mutation (mark read, archive, delete).
- Pagination — seed is small enough to render all threads at once.
- Mobile responsive treatment of the new mailbox column.
- The `Focus` and `Triage` mode empty states change. They keep the copy from phase 0.1.

## Constraints & assumptions

- **Local DB path**: `./.iris/iris.db`. Directory is created by the migrate/seed scripts; gitignored.
- **Cloudflare-shaped from day one**: schema is SQLite-compatible (matches D1). No `JSON` columns that D1 doesn't support, no Postgres-isms. Timestamps stored as Unix epoch integers (`integer` mode `'timestamp'` in Drizzle).
- **Foreign keys on**: `pragma foreign_keys = ON` in the better-sqlite3 connection.
- **Server Components only**: home view fetches in a Server Component. No `"use client"` for data fetching. Client components stay for interactivity (Mode switcher, etc.).
- **Assumption**: Drizzle's `drizzle-orm/better-sqlite3` and `drizzle-orm/d1` adapters present an identical query API for the operations we need (`select`, `insert`, `where`, `orderBy`). Confirmed — they share the SQLite core.
- **Assumption**: `next/cache` cache invalidation is not needed this phase since data only changes via the seed script (one-shot CLI).
- **Assumption**: edge runtime compatibility deferred — server components reading from a local SQLite file via `better-sqlite3` only run in Node. The prod D1 adapter will run on edge, but we don't deploy this phase. We mark the home route `export const runtime = 'nodejs'` to make this explicit and avoid a confusing Pages-edge error later.

## Open implementation questions (planner-decidable)

- **Schema column types**: `id` columns as `text` (UUID-ish via `crypto.randomUUID()`) or `integer autoincrement`? Lean: `text` UUIDs — match D1 best practices, friendlier in URLs.
- **Snippet generation**: store snippet as a column on `threads` (denormalized from the latest message body) or compute on read? Lean: store on the row, written by the seed; phase 0.3 will write it on inbound.
- **Unread count**: derive from `messages.read_at IS NULL` aggregated per mailbox, or denormalize on `mailboxes.unread_count`? Lean: derive on read — small N, no perf concern, no denorm staleness risk.
- **Relative timestamp formatting**: `Intl.RelativeTimeFormat` vs hand-rolled `Xm/Xh/Xd ago`. Lean: hand-rolled, ~10 lines, no Intl edge-runtime gotchas.
- **Mailbox column placement**: a second sidebar column to the right of the existing sidebar (so layout becomes `sidebar | mailbox-list | content`), OR replace the existing sidebar's "Mailboxes" section. Lean: second column visible only in Grandma mode — keeps Focus/Triage minimal, makes Grandma feel substantial.
- **Selected mailbox state**: URL query param `?mailbox=` (decided above) with default = `all`. Server-component reads `searchParams`.
- **Drizzle-kit config**: SQLite dialect, schema at `db/schema.ts`, migrations at `db/migrations/`, journalMode = WAL for better local concurrency.
- **Seeded thread realism**: subject lines pulled from a hand-written list (Stripe payout, Vercel deploy success, Postmark invoice, "Re: pricing question," calendar invite, GitHub PR review, Linear issue assigned, etc.). Sender names match the brand (Stripe, Vercel, etc.). Bodies are short one-liners — Grandma list doesn't render them this phase, but the data should be plausible.

## Resolved questions (verbatim Q&A from discovery)

- **Q: Database / ORM approach?** A: Drizzle on D1 + local SQLite (recommended).
- **Q: How much of the spec's schema should this phase materialize?** A: Full v0 model from SPEC.md (recommended).
- **Q: Seed data style?** A: Believable fake threads (recommended).
- **Q: Grandma mode UI ambition for this phase?** A: Mailbox switcher + thread list, no reader pane (recommended).
