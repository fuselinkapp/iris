# Phase 0.7 — Outbound via Resend (story)

## Who & what

The vibe-code founder has been reading mail in Iris but couldn't reply or compose anything new — the `/compose` page from 0.1 was a placeholder, and the reader had no Reply button. This phase closes the loop: they hit `c` (or click Reply on a thread), type a message, hit Send, and Resend dispatches it. The sent message is recorded in their own inbox under the right mailbox so the thread reads as a real two-way conversation. When the recipient replies *back*, phase 0.6's Email Worker catches it, ingest's header threading matches the In-Reply-To against the outbound's Message-ID, and the reply lands inside the same thread. The whole conversation lives in one place. Success: they fire a real send to a real address from `hello@catnap.dev`, see "Sent" in the thread, then ping themselves a reply and watch it merge into the same thread within seconds.

This phase ships outbound in **sandbox mode** — Resend's account-default `onboarding@resend.dev` envelope is used regardless of which mailbox the user picks. The user's chosen mailbox is recorded as `from_address` in our DB (so the UI reads correctly) and as `Reply-To` on the wire (so replies route back to CF Email Routing → Worker → Iris). Real Resend per-domain DKIM verification is its own future phase. The trade-off is documented loudly in the compose UI and in `DEPLOY.md`.

## In scope

- **`RESEND_API_KEY` env var** — read from `process.env`. If unset in `NODE_ENV !== 'production'`, fall back to a "send-disabled" UI that previews the payload but doesn't actually call Resend (lets you test the form flow without a real key). If unset in production, the Send button is disabled with a clear message.
- **`lib/email/send.ts`** — pure send function. Takes `{ from: { mailboxId, address }, to, subject, text, replyTo? }`, calls Resend (sandbox From), records the sent message in the DB.
- **`app/actions/send.ts`** — Server Action wrapping `send.ts`. `// TODO(auth)` marker like the other writes.
- **`/compose` page upgrade** — replace the placeholder with a real form. Fields: From mailbox (dropdown, populated from `listMailboxes()`, default = first), To (single address), Subject, Body. Send button. On success, redirect to `/?mailbox=<from-mailbox-id>&thread=<new-thread-id>` so the user lands in Grandma viewing the sent thread.
- **Reply UI in the reader pane** — a Reply button in the reader header. Clicking it expands an inline reply panel below the message body with To/Subject pre-filled (To = the original `from`, Subject = `Re: <original subject>` if not already prefixed). Body field, Cancel + Send buttons. From is locked to the mailbox the thread is in. On send, the new message lands inside the *same* thread; the reader refetches to show it.
- **A shared `<ComposeForm />` component** used by both the standalone `/compose` page and the inline reply panel. Different defaults / locked fields per surface, same submit path.
- **DB write on send** — message row with the user's chosen mailbox as `from_address`, `read_at = now` (you don't have unread sent mail), `headers['message-id']` set to whatever Resend returns (or a generated `<uuid@iris.local>` if Resend doesn't return one). Thread is either the existing `replyTo.threadId` (reply context) or a new thread created with the recipient's address copied into a single-element `to` array. `unread_count` is NOT incremented for sent messages.
- **In-Reply-To header on the wire** — when in reply context, the Resend payload includes `in_reply_to` and `references` headers pointing at the original message's stored Message-ID. This is how the eventual return-reply gets threaded by ingest.
- **Sandbox banner in the compose UI** — small one-line note: "Sending in sandbox mode. Recipients see `onboarding@resend.dev` as From. Replies route back to your mailbox via Reply-To." Plus a link to where to read more (the relevant `DEPLOY.md` section once written).
- **`samples/inbound/05-reply-to-iris.json`** — a sample payload simulating a recipient replying back to a sent Iris message via the `/api/ingest` curl path. Demonstrates round-trip threading.
- **README + DEPLOY updates** — short outbound section in README, and a new `DEPLOY.md` section explaining what's needed for real (non-sandbox) outbound (verifying the domain at Resend) so the user knows what's still ahead.
- **No regression** — existing inbound, reader, domain-add, settings, modes all unchanged.

## Out of scope

- **Real Resend per-domain DKIM verification.** Resend requires each From-domain to be verified separately (they generate DKIM records). Adding a domain-at-Resend flow + DKIM display + verification polling is its own phase. This phase punts via sandbox mode.
- **Multiple From addresses on one send.** One mailbox per send.
- **CC / BCC.** Schema supports them; UI doesn't surface them this phase.
- **Attachments.** Schema supports; UI doesn't.
- **Drafts.** Hit Send or discard. No save-draft button (the existing placeholder draft button stays disabled).
- **Send-later / scheduling.**
- **HTML composition.** Plain-text only — both the form input and the Resend payload's `text` field. No rich text editor, no markdown rendering.
- **Signatures, templates, snippets.**
- **Address autocomplete from `contacts` table.** Schema is populated by ingest; UI doesn't suggest yet.
- **Outbound from the Worker.** Send only happens from the dashboard via the Server Action (Node runtime). The Worker remains inbound-only.
- **`from_name` selection.** We send with just the address; `from_name` is null on outbound DB rows for now.
- **Bounce handling.** If Resend returns a bounce or 4xx/5xx, we surface it as an inline form error and don't write to the DB. Bounce *webhooks* (Resend → us) come later.
- **Send-from-an-existing-address you don't own.** UI restricts From to the mailboxes-you-have-in-Iris dropdown.
- **Idempotency on retried sends.** If the user double-clicks Send, two messages may be sent and recorded.
- **Auth.** Same `// TODO(auth)` posture as every other write.

## Constraints & assumptions

- **`resend` npm package** added as a runtime dep. Officially supported, ~30KB.
- **Compose route stays Node runtime** — same as everything else. Edge runtime not needed.
- **Send Server Action runs server-side** — never expose `RESEND_API_KEY` to the client. The Server Action boundary is the entire defense.
- **Sandbox From = `onboarding@resend.dev`** — Resend's default for any account that hasn't verified a domain. We hardcode it for this phase; the real per-domain From comes when the verification phase ships.
- **Reply-To is honored by Resend** — confirmed via Resend docs; included in the outbound headers so recipients' replies route back to the user's actual mailbox.
- **Threading via `in_reply_to` / `references` headers** — Resend's API takes these as top-level fields (or via `headers`). When present, we set them; ingest already matches against them on inbound.
- **`messages.from_address` records the user's chosen mailbox**, not the sandbox. This is technically a small lie (the actual SMTP envelope used `onboarding@resend.dev`), but it's the right thing for the UI — the thread reads as "from hello@catnap.dev." Documented inline.
- **Sent messages are pre-read** — `read_at = now`, `unread_count` not incremented.
- **Send with no `RESEND_API_KEY` in dev** — the form still works, the Server Action still writes to the DB, but the `Resend` client call is skipped. A "(dry-run, no Resend key set)" banner shows in the form. Lets you exercise the full UI flow during development without burning your free Resend tier.
- **Assumption**: it's OK that the outbound message uses the sandbox envelope — recipients will see `onboarding@resend.dev` as the apparent sender, with Reply-To = the user's mailbox. For a single-user beta this is acceptable; for product launch, the real-domain-verification phase becomes a hard prerequisite.
- **Assumption**: a recipient's mail client honors `Reply-To` (every major one does).
- **Assumption**: `crypto.randomUUID()` is available in the Node runtime route handler context (already used elsewhere this codebase).

## Open implementation questions (planner-decidable)

- **Reply panel placement** — inline at the bottom of the reader pane, expanded below the messages list. Lean: yes, simpler than a modal/route.
- **Reply close behavior** — Cancel button collapses the panel; Esc handler? No keyboard yet (still deferred). Plain button.
- **Send success state** — on standalone compose, redirect to the new thread in Grandma. On reply, refetch the thread inside the open reader (already supported via `onMarkedRead` pattern; rename callback to `onChanged` or similar).
- **Form validation** — client-side: To is non-empty + has `@`, Subject non-empty, Body non-empty. Server-side: same checks plus rate-limit guard? Skip rate limit this phase.
- **Resend client construction** — module-level singleton, lazy-init from env. Only constructed when actually sending.
- **`from_name` on outbound** — `null` for now; future phase adds per-mailbox display name.
- **Subject prefix on reply** — strip existing `Re:` (use `normalizeSubject` from ingest) then add a single `Re: ` prefix.
- **Thread row updates on send** — if reply: increment `message_count`, update `last_message_at` and `snippet` (no `unread_count++` since we sent it). If new thread: create it with `unread_count: 0`.
- **Headers on outbound DB row** — store `{ 'message-id': <generated-or-resend-id>, ...if reply: 'in-reply-to': <orig-id>, 'references': <orig-id> }`.

## Resolved questions (verbatim Q&A from discovery)

- **Q: Which send surface ships in 0.7?** A: Both — standalone compose AND reply.
- **Q: How should the From mailbox get picked?** A: Dropdown of all mailboxes, default = first (recommended).
- **Q: Where does the Resend API key come from?** A: `RESEND_API_KEY` env var only (recommended).
- **Q: Resend domain verification gap — how do we handle?** A: Test/sandbox mode only — send via `onboarding@resend.dev` (recommended).
