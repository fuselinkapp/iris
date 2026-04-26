# Phase 0.5 — Inbound ingest pipeline (plan)

**Story:** `docs/phase-0.5-ingest-story.md`

## Goal

Add `POST /api/ingest` and a pure `ingestMessage(payload)` function that takes a parsed mail payload, resolves the recipient mailbox, hybrid-threads it, writes message + thread rows transactionally, flips a `Pending` domain to `Verified` on first hit, and upserts the `from` contact — testable end-to-end with `curl` against bundled `samples/inbound/*.json` fixtures.

## Changes

### `lib/email/ingest.ts` (new, ~180 LoC)

The pipeline core. All other ingest paths (this phase's HTTP route, phase 0.6's Worker) call this function.

- Exports:
  - `type IngestPayload` — the shape from the story doc.
  - `type IngestResult = { ok: true; threadId: string; messageId: string; mailboxId: string; verifiedDomain: boolean } | { ok: false; reason: 'unknown_recipient' | 'invalid_payload'; detail?: string }`.
  - `async function ingestMessage(payload: IngestPayload): Promise<IngestResult>`.
- Internal helpers (private to the file):
  - `validatePayload(p): { ok: true; value: NormalizedPayload } | { ok: false; reason: 'invalid_payload'; detail }`. Hand-rolled checks: `from.address` non-empty string, `to` non-empty array, `subject` string. Returns a normalized object (lowercased addresses, default `receivedAt = Date.now()`, default `headers = {}`).
  - `resolveMailbox(tx, addresses): { id, domainId, hasPendingDomain } | null`. For each address, parses `local@domain`, queries the join `mailboxes ⋈ domains`. Returns the first match.
  - `findThreadId(tx, mailboxId, subject, inReplyTo, references): string | null`. Header-first: query `messages` where `headers->>'message-id'` matches any candidate, restricted to threads of `mailboxId`. better-sqlite3 supports `json_extract(headers, '$.message-id')`. If none found, normalize subject and look for thread within the 30-day window; return its id or null.
  - `normalizeSubject(s): string`. Repeats `^(re|fwd?|fw)\s*:\s*` strip, then `.trim().toLowerCase()`. Returns `''` if empty.
  - `deriveSnippet(text?, html?, subject): string`. Returns first 100 chars of body (text preferred), with HTML stripped via `replace(/<[^>]+>/g, ' ')` + whitespace collapse, fallback to subject.
  - `ensureMessageId(payload): string`. Returns existing `headers['message-id']` (case-insensitive read) or generates `<${randomUUID()}@iris.local>`.
- The transaction:
  ```
  db.transaction(tx => {
    const mailbox = resolveMailbox(tx, [...to, ...cc])
    if (!mailbox) return { ok: false, reason: 'unknown_recipient' }
    const messageId = randomUUID()
    const headerMap = { ...payload.headers, 'message-id': ensureMessageId(payload) }
    const existingThreadId = findThreadId(tx, mailbox.id, subject, inReplyTo, references)
    const threadId = existingThreadId ?? randomUUID()
    if (!existingThreadId) {
      tx.insert(threads).values({ id: threadId, mailboxId, subject, snippet, lastMessageAt, messageCount: 1, unreadCount: 1 })
    } else {
      tx.update(threads).set({ snippet, lastMessageAt, messageCount: sql`message_count + 1`, unreadCount: sql`unread_count + 1` }).where(eq(threads.id, threadId))
    }
    tx.insert(messages).values({ id: messageId, threadId, fromAddress, fromName, toAddresses: JSON.stringify(to), ccAddresses: JSON.stringify(cc), bccAddresses: JSON.stringify(bcc), subject, html, text, headers: JSON.stringify(headerMap), readAt: null, receivedAt })
    let verifiedDomain = false
    if (mailbox.hasPendingDomain) {
      tx.update(domains).set({ verifiedAt: new Date(receivedAt), dkimStatus: 'verified' }).where(eq(domains.id, mailbox.domainId))
      verifiedDomain = true
    }
    tx.insert(contacts).values({ id: randomUUID(), email: fromAddress, name: fromName ?? null, lastSeenAt: new Date(receivedAt) }).onConflictDoUpdate({ target: contacts.email, set: { name: fromName ?? sql`name`, lastSeenAt: sql`max(last_seen_at, excluded.last_seen_at)` } })
    return { ok: true, threadId, messageId, mailboxId: mailbox.id, verifiedDomain }
  })
  ```

### `app/api/ingest/route.ts` (new, ~70 LoC)

- `export const runtime = 'nodejs';` `export const dynamic = 'force-dynamic';`
- `POST(req)`:
  1. Auth check: read `IRIS_INGEST_TOKEN` from `process.env`. If set, require matching `x-iris-ingest-token` header → 401 otherwise. If unset and `process.env.NODE_ENV !== 'production'`, log a one-time warning to stderr and proceed. If unset in production → 401.
  2. Parse body as JSON; on parse error → 400 `{ error: 'invalid_json' }`.
  3. Call `ingestMessage(body)`.
  4. Map result to HTTP: `ok: true` → 200 with `{ threadId, messageId, mailboxId, verifiedDomain }`. `unknown_recipient` → 404. `invalid_payload` → 400 with detail.
- One-time warning state: module-level `let warned = false`.

### `samples/inbound/` (new directory)

- `samples/inbound/01-stripe-payout.json` — to: `hello@catnap.dev`, from Stripe, transactional. Triggers new-thread path.
- `samples/inbound/02-customer-reply.json` — to: `hello@catnap.dev`, from Maya Chen, `inReplyTo: <existing-message-id-from-seed>`. Triggers thread-merge via header. **Note:** seed messages don't currently set Message-ID headers (they default to `'{}'`). To make this fixture work, the *seed itself* needs a tiny tweak — see below.
- `samples/inbound/03-third-domain.json` — to: `hello@notebook.fyi`. Triggers `unknown_recipient` 404 unless the user added that domain in 0.4. README explains.
- `samples/inbound/04-vercel-deploy.json` — to: `hello@catnap.dev`, no In-Reply-To. Triggers subject-fallback grouping with the existing seeded "Production deploy succeeded" thread.

### `db/seed.ts` (small modify, ~+8 LoC)

For the `02-customer-reply.json` sample to actually thread, the seeded `Re: pricing question` message needs a stable Message-ID in its `headers` column.

- After inserting the message in the seed loop, also write `headers = JSON.stringify({ 'message-id': '<seed-${seedIndex}@iris.local>' })` for each seed.
- The customer-reply fixture references one of those IDs in its `inReplyTo` field.

### `README.md` (modify, ~+18 LoC)

Append a "Trying out inbound" section after "Local development":

```
## Trying out inbound

The ingest endpoint accepts pre-parsed messages so you can test the pipeline
without a Cloudflare Worker yet.

```bash
# (Optional) set a token; otherwise dev mode bypasses auth
echo 'IRIS_INGEST_TOKEN=dev' >> .env.local

# Start the dev server
pnpm dev

# In another terminal, fire a sample at it
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -H "x-iris-ingest-token: dev" \
  -d @samples/inbound/01-stripe-payout.json
```

Then refresh Grandma view to see the message land. Phase 0.6 will add the
Cloudflare Email Routing Worker that calls this same endpoint.
```

### `.env.local` and `.env.example` (new file: `.env.example`)

- `.env.example` (committed): documents the `IRIS_INGEST_TOKEN` variable.
- `.env.local` (gitignored, user-created): dev-mode is the default; user opts in by setting the token.

### `lib/db/queries.ts`, `app/(app)/page.tsx`, `components/grandma-view.tsx`, `components/reader-pane.tsx`

- **No changes.** Grandma's `useEffect` re-runs on `selectedMailbox` change and on initial mount; new messages appear on next visit/refresh. Real-time push is out of scope.

## Micro-decisions (auto-resolved on superyolo)

- **0.5.a — Endpoint vs Server Action.** *Recommendation: Next.js route handler at `/api/ingest`.* Tradeoff: Server Actions can't be called from outside the app (no curl). The Worker phase needs an HTTP endpoint anyway. **Resolved: take recommendation.**
- **0.5.b — Validation library.** *Recommendation: hand-rolled checks, no zod.* Tradeoff: zod would be safer but pulls a dep for one route handler. The shape is small enough. **Resolved: take recommendation.**
- **0.5.c — Threading: header storage.** *Recommendation: write `headers` as JSON-stringified object on every ingest, lookup via `json_extract(headers, '$.message-id')` in SQLite.* Tradeoff: schema's `headers` column is text; SQLite has json1 functions natively. Avoids a new column. **Resolved: take recommendation.**
- **0.5.d — Subject normalization regex.** *Recommendation: `^(re|fwd?|fw)\s*:\s*` repeated.* Catches `Re:`, `RE:`, `Re :`, `Fwd:`, `Fw:`, and chains like `Re: Re: Fwd:`. **Resolved: take recommendation.**
- **0.5.e — Multi-recipient fan-out.** *Recommendation: pick the first matching `to/cc` address, ignore the rest for routing.* Tradeoff: technically wrong for cc'd messages, but one-message-one-mailbox keeps the data model honest until phase 0.7+. **Resolved: take recommendation.**
- **0.5.f — Token in dev: bypass vs require.** *Recommendation: bypass in dev when unset, require in production.* Tradeoff: a footgun if someone runs the dev build in prod, but `NODE_ENV` checks catch the common case. **Resolved: take recommendation.**
- **0.5.g — Seed message-id back-fill.** *Recommendation: add stable IDs to seed messages so threading samples actually thread.* Tradeoff: bumps the seed file by ~8 LoC; existing data shape unchanged (still JSON in the `headers` column). **Resolved: take recommendation.**
- **0.5.h — Snippet HTML stripping.** *Recommendation: 1-line regex (`<[^>]+>` → ` `, then whitespace collapse). No library.* Tradeoff: doesn't decode HTML entities (`&amp;` stays literal). For a 100-char preview that's tolerable. **Resolved: take recommendation.**
- **0.5.i — Contacts upsert.** *Recommendation: Drizzle `.onConflictDoUpdate({...})`.* `last_seen_at` uses `MAX(existing, excluded)` so out-of-order ingest doesn't regress the column. **Resolved: take recommendation.**
- **0.5.j — Verified flip transactional with the message insert.** *Recommendation: yes — same `db.transaction`. Either both or neither.* Tradeoff: a transient failure of the verified-flip would otherwise leave a domain Verified with no actual landed mail. **Resolved: take recommendation.**

## NOT in this PR

- Cloudflare Worker, `wrangler.toml`, binding-aware `getDb()` factory.
- Raw RFC822 parsing.
- R2 storage of raw messages.
- Attachments.
- HTML rendering / sanitized iframe.
- Real-time push to open browsers.
- DKIM/SPF verification of incoming mail content.
- Spam filtering / quarantine.
- Outbound send.
- Mailbox routing rules / catch-all / aliases.
- Multi-recipient fan-out.
- Message-ID dedupe / idempotency.
- Auth beyond the shared-secret token.
- Tests.
- Mobile responsive treatment.

## Acceptance checklist

- [ ] `pnpm db:reset && pnpm dev` boots; the new endpoint is reachable.
- [ ] `curl -X POST .../api/ingest -d @samples/inbound/01-stripe-payout.json` returns `200 { threadId, messageId, mailboxId, verifiedDomain: false }`.
- [ ] After that curl, navigating to `/?mailbox=<hello@catnap.dev>` (or all inboxes) shows the new Stripe message at the top of the thread list.
- [ ] `02-customer-reply.json` lands inside the existing `Re: pricing question` thread (thread count for that mailbox unchanged; message_count for that thread incremented; unread_count incremented; snippet refreshed).
- [ ] `03-third-domain.json` (with `to: hello@notebook.fyi`) returns `404 { error: 'unknown_recipient' }` if the user hasn't added the domain; if they have, the domain's badge flips to **Verified** in `/settings/domains`.
- [ ] `04-vercel-deploy.json` (no In-Reply-To, subject `Re: ✓ Production deploy succeeded — catnap.dev`) merges into the existing Vercel thread via subject-fallback.
- [ ] Without the `x-iris-ingest-token` header in production mode → 401.
- [ ] In dev mode without the env var, the request succeeds and a warning is logged to stderr.
- [ ] Posting an invalid payload (missing `from.address`) → 400 `{ error: 'invalid_payload', detail: ... }`.
- [ ] Posting twice with the same payload → two messages persisted (idempotency intentionally not handled this phase).
- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm build` all pass.
- [ ] No regression: Focus / Triage / Grandma / reader pane / settings / domain-add all unchanged.

## Line budget

Target: **~330 lines** of hand-written code (ingest.ts ~180, route.ts ~70, seed delta ~8, samples ~30, README delta ~18, .env.example ~5, tiny refactor surface). 25% tripwire: **~410 LoC**. The ingest core is the bulk; route handler is glue.
