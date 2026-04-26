# Phase 0.7 — Outbound via Resend (plan)

**Story:** `docs/phase-0.7-outbound-resend-story.md`

## Goal

Wire `/compose` and a new reader-pane Reply button to actually send via Resend (in sandbox mode), record the sent message in the DB so it threads with the recipient's eventual reply, and provide a `<ComposeForm />` shared between both surfaces — without solving Resend's per-domain DKIM verification this phase.

## Changes

### `package.json` (modify, +1 dep)

- Add `resend` runtime dep.
- No new scripts.

### `.env.example` (modify, +3 lines)

```
# Resend API key for outbound mail. Optional in dev — when unset the
# compose form runs in dry-run mode (DB write happens, no actual send).
RESEND_API_KEY=
```

### `lib/email/send.ts` (new, ~115 LoC)

Pure outbound logic. Two-stage:

1. Validate input (To has `@`, subject + body non-empty).
2. Resolve sender mailbox (`SELECT … FROM mailboxes JOIN domains WHERE mailboxes.id = ?`). Return `{ ok: false, reason: 'unknown_mailbox' }` if not found.
3. Construct headers: own `Message-ID` (`<uuid@iris.local>`), and if reply context: `In-Reply-To` + `References` from the source message.
4. If `RESEND_API_KEY` is set:
   - `await resend.emails.send({ from: 'onboarding@resend.dev', to, subject, text, replyTo: senderAddress, headers: { 'In-Reply-To': ..., 'References': ... } })`
   - On Resend error → `{ ok: false, reason: 'send_failed', detail }`. No DB write.
5. Open transaction-equivalent (sequential writes, same pattern as ingest):
   - If `replyTo.threadId`: UPDATE thread (`message_count + 1`, `last_message_at`, `snippet`).
   - Else: INSERT new thread (mailboxId = sender.mailboxId, subject, snippet, `unread_count: 0`, `message_count: 1`, `last_message_at = now`).
   - INSERT message (`from_address` = sender's address, `from_name` = null, `to_addresses` = `[to]`, `subject`, `text`, `html` = null, `headers` JSON-stringified, `read_at = now`, `received_at = now`).
6. Return `{ ok: true, threadId, messageId, sandboxMode: !apiKey }`.

Exports:
```ts
export type SendInput = {
  fromMailboxId: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: { threadId: string; messageId: string };
};
export type SendResult =
  | { ok: true; threadId: string; messageId: string; dryRun: boolean }
  | { ok: false; reason: 'invalid_input' | 'unknown_mailbox' | 'send_failed'; detail?: string };
export async function sendMessage(input: SendInput, db: IrisDb): Promise<SendResult>;
```

Reuses `normalizeSubject` from `lib/email/ingest.ts` (re-export from there or inline a copy — lean: inline a small copy here, ~5 LoC, to keep ingest.ts independent of send concerns).

### `app/actions/send.ts` (new, ~30 LoC)

```ts
'use server';

import { getDb } from '@/lib/db/client';
import { type SendInput, type SendResult, sendMessage } from '@/lib/email/send';

// TODO(auth): gate on session + validate mailboxId/threadId/messageId UUIDs.
export async function sendAction(input: SendInput): Promise<SendResult> {
  return sendMessage(input, getDb());
}
```

### `app/actions/grandma.ts` (modify, ~+10 LoC)

Add `getMailboxesForSend()` Server Action — same as `listMailboxes()` but without the unread-count join (we just need addresses). Or simpler: re-export `getGrandmaData` and let the form filter. Lean: a tiny new action that returns `Array<{ id, address }>`.

### `components/compose-form.tsx` (new, ~180 LoC)

The shared form, used by both `/compose` and the reader-pane reply panel.

Props:
```ts
type ComposeFormProps = {
  mailboxes: Array<{ id: string; address: string }>;  // for the dropdown
  defaultMailboxId?: string;                            // default selection
  lockedMailboxId?: string;                             // reply context: hides dropdown
  defaultTo?: string;
  defaultSubject?: string;
  replyTo?: { threadId: string; messageId: string };
  onSent?: (result: { threadId: string; messageId: string }) => void;
  onCancel?: () => void;                                // shown only if provided (reply context)
  showSandboxNotice: boolean;                           // true in /compose, false-or-true in reply
};
```

State: `from`, `to`, `subject`, `text`, `error`, `pending`. All client component.

Submit:
- Calls `sendAction({...})` via `useTransition`.
- On `ok: true`: clears form, calls `onSent` if provided, otherwise (standalone /compose) does `router.push('/?mailbox=...&thread=...')`.
- On `ok: false`: sets the error message under the relevant field.

UI:
- If `lockedMailboxId`: show the address as a static label ("From: hello@catnap.dev").
- Else: dropdown of mailboxes.
- To, Subject inputs (Subject pre-filled from `defaultSubject` if provided).
- Textarea for body (`min-h-[160px]`, font-sans, no monospace).
- Sandbox notice card above Send button when `showSandboxNotice`.
- Send button (primary), Cancel button (ghost, only if `onCancel` provided).

### `app/compose/page.tsx` (rewrite, ~30 LoC)

```tsx
import { redirect } from 'next/navigation';

import { ComposeForm } from '@/components/compose-form';
import { getMailboxesForSend } from '@/app/actions/grandma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function ComposePage() {
  const mailboxes = await getMailboxesForSend();
  if (mailboxes.length === 0) redirect('/settings/domains?add=1');

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-6 py-10">
      <Link href="/" className="...">Back</Link>
      <Card className="p-6">
        <h1 className="text-lg font-medium tracking-tight">New message</h1>
        <ComposeForm
          mailboxes={mailboxes}
          defaultMailboxId={mailboxes[0].id}
          showSandboxNotice
        />
      </Card>
    </div>
  );
}
```

### `components/reader-pane.tsx` (modify, ~+60 LoC)

- Add a Reply button to the reader header (next to the existing X close button).
- Track `replyOpen: boolean` local state.
- When `replyOpen && data` and the thread has at least one message: render an inline `<ReplyPanel />` below the messages list.
- `<ReplyPanel />` is a small inline component (or just an instance of `<ComposeForm />` with reply-context props) that:
  - Locks From to the thread's mailbox.
  - Pre-fills To from the original first message's `from_address`.
  - Pre-fills Subject from the thread's subject (with `Re: ` prefix unless already present, via `normalizeSubject` + prefix).
  - Passes `replyTo: { threadId, messageId: lastMessage.headers['message-id'] }`.
  - On `onSent`, calls `onChanged()` (the existing `onMarkedRead` callback renamed in the parent so it covers any thread-list-affecting change), and collapses the panel.
  - On `onCancel`, collapses the panel.

### `components/grandma-view.tsx` (modify, ~+1 LoC)

- Rename `onMarkedRead` callback prop on `<ReaderPane />` to `onChanged` (and the corresponding handler — same `refetch` body). Then send-from-reply also fires it.

### `samples/inbound/05-reply-to-iris.json` (new, ~12 LoC)

A sample payload simulating someone replying to a sent Iris message:

```json
{
  "from": { "name": "Test Recipient", "address": "alice@example.com" },
  "to": ["hello@catnap.dev"],
  "subject": "Re: My test from Iris",
  "text": "Hey — got your message. Reply works.",
  "headers": { "message-id": "<reply-from-alice@example.com>" },
  "inReplyTo": "<REPLACE-WITH-MESSAGE-ID-FROM-SENT-MESSAGE@iris.local>",
  "references": ["<REPLACE-WITH-MESSAGE-ID-FROM-SENT-MESSAGE@iris.local>"]
}
```

Documented in README + DEPLOY.md as the round-trip test path.

### `app/(app)/settings/ai/page.tsx` (tiny modify, ~+1 LoC of copy)

Mention `RESEND_API_KEY` env var in the description. Stays a placeholder otherwise.

### `README.md` (modify, ~+18 LoC)

New "Sending mail" section after "Trying out inbound":

```
## Sending mail

Outbound is via Resend. Set RESEND_API_KEY in `.env.local` (or skip — without
the key the compose form runs in dry-run mode: DB write happens, no actual
send).

Hit `c` from anywhere or click Compose, fill the form, hit Send. Sent messages
appear in your own inbox under the From mailbox you picked.

Reply lives inside the reader pane: click Reply, type, hit Send. The reply
threads with the original via In-Reply-To headers — when the recipient replies
back via real inbound, it merges into the same thread.

Outbound currently runs in **sandbox mode**: recipients see
`onboarding@resend.dev` as From; their replies route back to your real mailbox
via the Reply-To header. Real per-domain From requires verifying each domain
at Resend (separate from Cloudflare Email Routing). That's a future phase.
```

### `DEPLOY.md` (modify, ~+25 LoC)

New "Outbound via Resend" section explaining:
- The sandbox-mode current state.
- What "real" outbound needs (domain verified at Resend with their DKIM records).
- The relevant env-var setup for production: setting `RESEND_API_KEY` as a Cloudflare Pages env var when the dashboard deploys.

### `lib/db/queries.ts`

- **No changes.** `listMailboxes()` already exists; the new send action either reuses it or adds a thinner variant in `app/actions/grandma.ts`.

### `db/schema.ts`, `db/migrations/`, `db/seed.ts`

- **No changes.** Schema already supports everything outbound needs (`messages.from_address`, `headers`, `read_at`, `to_addresses`, etc.).

### `next.config.ts`

- **No changes.**

## Micro-decisions (auto-resolved on superyolo)

- **0.7.a — Single shared `ComposeForm` vs two separate components.** *Recommendation: shared.* Tradeoff: a couple of extra props (`lockedMailboxId`, `onCancel`, `showSandboxNotice`) but the form logic is 95% the same. **Resolved: take recommendation.**
- **0.7.b — Reply panel inline vs new route.** *Recommendation: inline at the bottom of the reader.* Tradeoff: the reader pane gets bigger; alternative is `/compose?reply=…` but that loses the visual context. **Resolved: take recommendation.**
- **0.7.c — Sandbox From hardcoded vs configurable.** *Recommendation: hardcoded `onboarding@resend.dev`.* Tradeoff: not configurable per-user but matches Resend's docs exactly and avoids a config knob nobody needs. **Resolved: take recommendation.**
- **0.7.d — Dry-run when key unset.** *Recommendation: yes — DB write proceeds, Resend call skipped.* Tradeoff: developers can exercise the full UI/threading flow without burning a Resend free tier. **Resolved: take recommendation.**
- **0.7.e — `messages.from_address` records the user's mailbox or the sandbox?** *Recommendation: the user's mailbox.* The UI must read coherently as a thread between the user and their recipient. Documented inline. **Resolved: take recommendation.**
- **0.7.f — Inline `normalizeSubject` copy in send.ts vs export from ingest.ts.** *Recommendation: tiny inline copy.* Tradeoff: a few lines of duplication, but keeps ingest.ts free of outbound dependencies. **Resolved: take recommendation.**
- **0.7.g — Thread updates on send: increment `unread_count`?** *Recommendation: NO. Sent messages are always read.* Tradeoff: none. **Resolved: take recommendation.**
- **0.7.h — Resend `Reply-To` header.** *Recommendation: always set to the sender's mailbox address.* Tradeoff: none — recipients' replies route via CF Email Routing back to the right mailbox. **Resolved: take recommendation.**
- **0.7.i — Subject normalization on reply.** *Recommendation: strip leading `Re:`/`Fwd:` from the original subject, prepend a single `Re: `.* Tradeoff: none. **Resolved: take recommendation.**
- **0.7.j — Get mailboxes for compose: new action vs reuse `getGrandmaData`.** *Recommendation: tiny new `getMailboxesForSend()` returning `[{ id, address }]`.* Tradeoff: minor duplication, but `getGrandmaData` couples the compose page to the Grandma data shape and runs unnecessary thread queries. **Resolved: take recommendation.**

## NOT in this PR

- Resend per-domain DKIM verification UI / Resend API integration for adding domains.
- CC / BCC inputs.
- Attachment uploads.
- Drafts (save/load).
- Send-later / scheduling.
- HTML composition.
- Signatures / templates / canned responses.
- Address autocomplete from `contacts`.
- Outbound from the Worker.
- `from_name` selection / per-mailbox display name picker.
- Bounce webhook handler from Resend.
- Send idempotency (double-click protection).
- Auth.
- Tests.
- Mobile responsive treatment of the reply panel.

## Acceptance checklist

- [ ] `pnpm install` succeeds.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` clean.
- [ ] `pnpm build` succeeds.
- [ ] `/compose` renders the new form with mailbox dropdown populated from seed (3 entries).
- [ ] With `RESEND_API_KEY` unset: filling the form and hitting Send writes the message to the DB (visible in Grandma) without making a network call. A "(dry-run)" notice is visible.
- [ ] With `RESEND_API_KEY` set to a real key: Send actually delivers via Resend (sandbox From), DB row written, redirect to the new thread.
- [ ] Sandbox notice is visible in compose UI.
- [ ] Clicking Reply in the reader opens an inline panel with To/Subject pre-filled, Body empty.
- [ ] On reply send, the new message lands inside the same thread (`message_count` goes up), reader refetches and shows it stacked under the original.
- [ ] Subject prefix de-dupes: replying to `Re: pricing question` keeps a single `Re:` prefix, not `Re: Re:`.
- [ ] Dropdown locked on reply (cannot change From mailbox).
- [ ] Cancel collapses the reply panel.
- [ ] Curling `samples/inbound/05-reply-to-iris.json` (after replacing the placeholder Message-ID with a real one from a sent message) merges the reply into the original thread via header threading.
- [ ] Outbound from a domain whose mailbox doesn't exist returns `{ ok: false, reason: 'unknown_mailbox' }`.
- [ ] Form validation: empty To / Subject / Body shows inline error.
- [ ] No regression: Focus / Triage / Grandma / reader pane / domain-add / settings tabs / inbound HTTP + Worker all unchanged.

## Line budget

Target: **~370 lines** of hand-written code (send.ts ~115, send action 30, compose-form ~180, compose page rewrite ~30 net, reader-pane delta ~+60, grandma-view delta ~+1, getMailboxesForSend ~10, sample JSON 12, env example +3, settings/ai copy +1). DEPLOY.md (~25 LoC) and README (~18 LoC) excluded as documentation. 25% tripwire: **~460 LoC**. The bulk is the form component and the send.ts logic. If the tripwire trips, likely candidate is the `ComposeForm` growing because of the dual-context flexibility.
