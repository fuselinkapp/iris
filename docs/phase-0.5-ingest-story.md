# Phase 0.5 — Inbound ingest pipeline (story)

## Who & what

The vibe-code founder added `notebook.fyi` in phase 0.4. The DNS records are in place; status reads "Pending." Now they want to send a real test email and watch it land. This phase builds the *plumbing that catches mail and writes it into the inbox* — without yet building the Cloudflare Worker that will eventually call that plumbing in production. The founder runs the dev server, fires a `curl` at `POST /api/ingest` with a realistic message payload (or runs one of the bundled `samples/*.json` fixtures through curl), and watches three things happen at once: the message appears in Grandma under the right mailbox, threading kicks in (a `Re: pricing question` reply lands inside the original thread, not as a new one), and the destination domain's status badge flips from **Pending** to **Verified**. Success: they pipe-curl a sample, then a reply, then a second domain's first message, and Iris reflects all three correctly within ~100ms.

## In scope

- **`POST /api/ingest`** Next.js route handler. Accepts `Content-Type: application/json` with a parsed-message payload. Returns the resulting `{ threadId, messageId }` on success.
- **Auth on the endpoint**: a shared-secret `x-iris-ingest-token` header, value read from `IRIS_INGEST_TOKEN` env var. If the env var is unset, accept all requests in `NODE_ENV !== 'production'` and reject all in production. This protects the endpoint once Iris is deployed.
- **Payload shape** (the contract a future Worker will fulfil):
  ```ts
  {
    from: { name?: string; address: string };
    to: string[];                    // primary recipient list
    cc?: string[];
    bcc?: string[];
    subject: string;
    text?: string;                   // plain-text body
    html?: string;                   // HTML body, stored as-is, not rendered this phase
    headers?: Record<string, string>; // raw header map (case-insensitive on read)
    inReplyTo?: string;              // Message-ID this is a reply to
    references?: string[];           // chain of Message-IDs
    receivedAt?: number;             // epoch ms; defaults to server now
    rawR2Key?: string;               // for the future raw-archive path; not used this phase
  }
  ```
- **Recipient → mailbox resolution**: for each address in `to`, parse `local@domain`, look up `(domain, local_part) → mailbox.id`. Use the *first* matching mailbox as the message's home. If no recipient resolves, return `404 { error: 'unknown_recipient' }`. (Multi-mailbox fan-out is deferred — one message goes to one mailbox in this phase.)
- **Thread grouping (hybrid)**:
  1. If `inReplyTo` or any of `references` matches an existing `messages.headers['message-id']` value within the same mailbox → use that message's `thread_id`.
  2. Else, normalize the subject (strip leading `Re:`/`Fwd:`/`Fw:` repeated, collapse whitespace, lowercase) and look for a thread on the same mailbox with a matching normalized subject whose `last_message_at` is within the last 30 days → use it.
  3. Else, create a new thread.
- **Single transaction per ingest** that:
  1. Inserts the `messages` row (with `read_at = null`).
  2. Either creates a new `threads` row or updates the existing one's `last_message_at`, `message_count++`, `unread_count++`, `snippet` (first 100 chars of text body, or stripped HTML, or subject as fallback).
  3. If the recipient's domain has `verified_at = null`, sets `verified_at = now` and `dkim_status = 'verified'`.
  4. Upserts a `contacts` row keyed by `from.address` with `last_seen_at = receivedAt`.
- **Sample fixtures** in `samples/` directory: 3-4 realistic JSON payloads (a Stripe-style notification, a customer reply that exercises threading via `inReplyTo`, a Vercel deploy, a calendar invite). Each is a self-contained file you can curl directly.
- **README.md update**: short "Trying out inbound" section explaining how to set the token, run the dev server, and curl a sample.
- **No regression**: existing seed flow still works; Grandma view picks up new threads on the next `getGrandmaData` call (the user must navigate or refresh — no real-time push this phase).

## Out of scope

- **Cloudflare Worker** + `wrangler.toml` + the binding-aware `getDb()` factory. Phase 0.6.
- **Raw RFC822 (.eml) parsing**. The endpoint accepts pre-parsed JSON only; the Worker phase will own the MIME parsing.
- **R2 storage of raw .eml** (`rawR2Key` is accepted in the payload but not written or read).
- **Attachment ingestion**. Schema supports it; the parser phase doesn't pull attachments from MIME yet.
- **HTML body rendering**. Stored, not rendered. Reader pane stays text-only.
- **Real-time push** to open browser sessions. New mail appears on the next refresh / Server Action call.
- **DKIM/SPF verification** of incoming mail. We trust the payload (and the eventual Worker upstream).
- **Spam filtering / quarantine**.
- **Bounces / non-delivery / outbound replies**. Outbound is a separate phase.
- **Mailbox routing rules** (catch-all, alias resolution, wildcard subdomains). Exact `local@domain` match only.
- **Multi-recipient fan-out**. One message → one mailbox.
- **Thread merge / split UI**. Whatever the heuristic decides, the user lives with.
- **Idempotency on Message-ID** — if the same payload is curled twice, you get two messages. (Worker phase will add Message-ID dedupe; the schema can absorb it later.)
- **Pagination of threads in Grandma**. Same as before.
- **Auth beyond the shared-secret token**.

## Constraints & assumptions

- **Endpoint runtime**: Node.js (`export const runtime = 'nodejs'`) — uses the same `getDb()` better-sqlite3 path as the rest of the app.
- **No new dependencies**. Subject normalization, header lookup, snippet stripping, contact upsert all hand-rolled with the standard library.
- **The shared-secret token is a write-protection guard, not real auth.** Anyone with the token can inject arbitrary mail into the DB. Acceptable for v0; phase 1's auth pass replaces it.
- **Threading uses the `messages.headers` JSON column**: when a new message arrives, write `headers['message-id']` so future replies can match. If the payload has no Message-ID, generate one (`<uuid@iris.local>`).
- **Snippet derivation order**: `text` body → `html`-stripped → `subject`. Always 100-char cap.
- **Subject normalization for threading match**: regex strips leading `^(re|fwd?|fw)\s*:\s*` repeatedly, then `.trim().toLowerCase()`. Empty normalized subjects don't fall back to subject-grouping (always create a new thread).
- **30-day window** for subject-fallback matching is hardcoded as `THREAD_SUBJECT_FALLBACK_MS = 30 * 24 * 60 * 60_000`.
- **`unread_count` increment**: always 1 per ingest (the new message is unread). The denorm column is consistent with how `markThreadRead` resets it.
- **Domain verification flip is implicit**: no separate "verify now" UI. Adding the domain → configuring DNS → sending the first test mail → verified badge appears. That's the whole flow.
- **Assumption**: in dev, the user has set `IRIS_INGEST_TOKEN=dev` in `.env.local`, or relies on the dev-mode bypass. The README will document both.
- **Assumption**: the existing Grandma `useEffect` on mailbox change will pick up new threads — no SSE, no polling. User refreshes the page or switches mailboxes after curl-ing.

## Open implementation questions (planner-decidable)

- **Endpoint location**: `app/api/ingest/route.ts` (Next.js App Router route handler). Lean: yes.
- **Validation**: hand-rolled checks on payload shape (no zod). Each missing field returns a 400 with a specific `error` code.
- **Where the parser/threading lives**: `lib/email/ingest.ts` exports `ingestMessage(payload)` — pure function on top of `getDb()`. Reused by the Worker phase. Keeps the route handler thin.
- **Contacts upsert**: `INSERT … ON CONFLICT(email) DO UPDATE SET last_seen_at = excluded.last_seen_at WHERE excluded.last_seen_at > contacts.last_seen_at`. Or simpler: select-then-insert-or-update. Lean: SQL upsert via Drizzle's `.onConflictDoUpdate({...})`.
- **Address parsing**: simple `split('@')` with a regex check. No RFC 5321 strict parsing.
- **Header case**: lowercase keys when reading the `headers` map. Writes preserve original case if any.
- **Snippet HTML stripping**: 1-line regex (`<[^>]+>` → ` `) plus whitespace collapse. Adequate.
- **Sample fixtures**: put them in `samples/inbound/*.json`. Each shows a different code path: new thread, threaded reply, third domain (triggers verify flip), Stripe-style transactional.
- **Dev-mode bypass behavior**: if `IRIS_INGEST_TOKEN` is unset and `NODE_ENV !== 'production'`, log a warning on first request and accept the payload.

## Resolved questions (verbatim Q&A from discovery)

- **Q: Phase scope: how much of the inbound stack ships in 0.5?** A: Ingest pipeline only, curl-driven (recommended).
- **Q: How should messages be grouped into threads?** A: Hybrid: In-Reply-To/References headers, fallback to subject (recommended).
- **Q: HTML body handling for incoming mail?** A: Store both, render text only (recommended).
- **Q: When does a Pending domain flip to Verified?** A: On first inbound message (recommended).
