# Phase 1.0 — Resend per-domain verification (plan)

**Story:** `docs/phase-1.0-resend-verification-story.md`

## Goal

Add two nullable columns to `domains` (`resend_domain_id`, `resend_verified_at`), wire two new Server Actions (`setupSendingForDomain`, `checkResendVerification`) that drive Resend's `domains.create` / `domains.get` API, surface a per-domain "Sending: not set up / pending / ready" badge + button row in `/settings/domains` with a Resend DKIM TXT record displayed alongside CF's records, and update `sendMessage` to use real From when the chosen mailbox's domain is Resend-verified.

## Changes

### `db/schema.ts` (modify, +4 LoC)

Add to `domains` table:
```ts
resendDomainId: text('resend_domain_id'),
resendVerifiedAt: epoch('resend_verified_at'),
```
No index — both queried by domain ID, which is the PK.

### `db/migrations/0001_*.sql` (new — generated)

Run `pnpm db:generate`. Single ALTER TABLE adding two nullable columns. Safe / idempotent / no data touched.

### `lib/resend/client.ts` (new, ~25 LoC)

Consolidates the existing module-local Resend client in `lib/email/send.ts`:
```ts
import { Resend } from 'resend';

let cached: Resend | null | undefined;

export function getResendClient(): Resend | null {
  if (cached !== undefined) return cached;
  const key = process.env.RESEND_API_KEY;
  cached = key ? new Resend(key) : null;
  return cached;
}
```

### `lib/resend/domains.ts` (new, ~80 LoC)

Pure server functions wrapping the Resend domains API.

```ts
import 'server-only';
import { getResendClient } from './client';

export type ResendDkimRecord = {
  type: 'TXT' | 'MX';
  name: string;
  value: string;
  status?: string;
  priority?: number;
};

export type RegisterResult =
  | { ok: true; resendDomainId: string; records: ResendDkimRecord[] }
  | { ok: false; reason: 'no_api_key' | 'api_error'; detail?: string };

export type StatusResult =
  | { ok: true; status: 'verified' | 'pending' | 'failure' | string; records: ResendDkimRecord[] }
  | { ok: false; reason: 'no_api_key' | 'api_error' | 'not_found'; detail?: string };

export async function registerDomain(name: string): Promise<RegisterResult>;
export async function getDomainStatus(resendDomainId: string): Promise<StatusResult>;
```

Implementation notes:
- `registerDomain`: calls `client.domains.create({ name })`. On 409 / "already exists", calls `client.domains.list()`, finds by name, calls `domains.get(id)` to fetch records.
- Filters records to DKIM TXT only (`type === 'TXT'` && `name.includes('_domainkey')`).
- Errors mapped to friendly messages; full Resend error in `detail`.

### `app/actions/domains.ts` (modify, ~+50 LoC)

Add two new actions:

```ts
// TODO(auth): gate on session + validate domainId UUID before phase 1.1.
export async function setupSendingForDomain(domainId: string): Promise<{
  ok: true; resendDomainId: string; records: ResendDkimRecord[];
} | { ok: false; reason: 'no_api_key' | 'unknown_domain' | 'api_error'; detail?: string }>;

export async function checkResendVerification(domainId: string): Promise<{
  ok: true; verified: boolean; status: string;
} | { ok: false; reason: 'no_api_key' | 'unknown_domain' | 'not_setup' | 'api_error'; detail?: string }>;
```

Both flow: read the local `domains` row → call Resend → write back updated columns → return UI-friendly payload.

### `lib/db/queries.ts` (modify, ~+50 LoC)

- Extend `DomainRow` with `resendDomainId: string | null` and `resendVerifiedAt: number | null`.
- `listDomains`: select the new columns, map them through.
- New `getDomainById(domainId)` — tiny helper for the new actions.
- New `setDomainResend(domainId, { resendDomainId, resendVerifiedAt? })` — used by the actions.
- Extend `MailboxWithDomain` with `resendVerified: boolean`. `listMailboxes` derives it from the joined domain.

### `app/actions/grandma.ts` (modify, ~+5 LoC)

`getMailboxesForSend()` returns `{ id, address, resendVerified }` so the compose form knows which mailboxes are sandbox vs real.

### `lib/email/send.ts` (modify, ~+25 LoC, ~-10 LoC)

- Replace the local Resend client construction with `getResendClient` from `lib/resend/client`.
- Read `domains.resend_verified_at` for the sender's domain. The existing sender-resolution query already joins domains; extend to select `resend_verified_at`.
- `from` field on the Resend payload: `${sender.localPart}@${sender.domain}` if `sender.resendVerifiedAt` is set, else `onboarding@resend.dev`.
- Reply-To still always set to the sender's actual address (now redundant for verified domains, harmless).
- `dryRun` semantics unchanged.
- Add `sandboxMode: boolean` to the `SendResult` so the UI can show "sent from sandbox" vs "sent from your real address" feedback later (currently unused, but a free signal).

### `components/dns-records-panel.tsx` (modify, ~+40 LoC)

Two-section panel. Props extended:
```ts
type Props = {
  resendRecords?: ResendDkimRecord[]; // null/empty = section hidden
};
```

Render:
- "For receiving" header + existing CF records (unchanged).
- "For sending" header + `resendRecords` if present, with a small intro line ("Adds a DKIM signature so recipients know mail from this domain is really from you.").
- Same copy-button affordance per record.

### `components/domains-list.tsx` (modify, ~+90 LoC)

For each domain row:
- Compute `sendingState`: `'not_setup'` (no `resendDomainId`), `'pending'` (`resendDomainId` set, `resendVerifiedAt` null), or `'ready'` (`resendVerifiedAt` set).
- Sub-badge under the receiving badge: `Sending: not set up / pending / ready`.
- Action button next to the existing "Show DNS":
  - `not_setup` → **Set up sending** (calls `setupSendingForDomain`, on success expands DNS panel with the new section, calls `router.refresh()`).
  - `pending` → **Check verification** (calls `checkResendVerification`, on success either flips the badge to ready via `router.refresh()` or shows a "still pending" inline note).
  - `ready` → no button (the ready state is its own affordance).
- Local state for: pending action per row, error message per row.
- Each domain row tracks its own `resendRecords` after Set-up-sending so the DNS panel renders them without a refetch.

### `components/compose-form.tsx` (modify, ~+10 LoC)

- Sandbox notice gate: instead of always-on `showSandboxNotice`, derive from the *currently-selected* mailbox's `resendVerified` flag. Pass mailboxes-with-verified through props (already present after the action shape change).
- Notice now shows only when the active From mailbox is sandbox-only.

### `app/compose/page.tsx` (modify, ~+1 LoC)

- `mailboxes` now carries `resendVerified`; pass as-is to the form.

### `db/seed.ts` (modify, ~+0 — no changes needed)

The two new columns default to `null`. Seeded domains stay Resend-unverified, which means they continue to send via sandbox in dev — exactly what we want.

### `worker/index.ts`, `worker/handler.ts`, `worker/test.ts`

- **No changes.** Worker is inbound-only.

### `app/api/ingest/route.ts`

- **No changes.** Ingest doesn't touch the new columns.

### `lib/db/types.ts`, `lib/db/client.ts`, `lib/db/local-path.ts`

- **No changes.**

### `next.config.ts`, `wrangler.toml`

- **No changes.**

### `package.json`

- **No new deps.** Resend SDK already includes `resend.domains`.

### `README.md` (modify, ~+8 LoC)

In the "Sending mail" section, replace the sandbox-only paragraph with a brief "set up sending per domain" explanation pointing at `/settings/domains`.

### `DEPLOY-PAGES.md` (modify, ~+6 LoC)

Remove the lingering "outbound is sandbox-only" caveat. Add a one-line note that per-domain sending is configured in `/settings/domains` after deploy.

### `docs/phase-0.7-outbound-resend-story.md`, `DEPLOY.md`

- **No changes.** Historical docs stay as-is; the new story doc supersedes the sandbox caveat.

## Micro-decisions (auto-resolved on superyolo)

- **1.0.a — Schema migration: nullable vs default values.** *Recommendation: nullable, no default.* Tradeoff: every code path checks `if (resendVerifiedAt) {}` instead of relying on a sentinel — clearer intent. **Resolved: take recommendation.**
- **1.0.b — Single Resend client singleton vs one-per-module.** *Recommendation: single shared `lib/resend/client.ts`.* Cleaner; the existing `lib/email/send.ts` migrates to use it. **Resolved: take recommendation.**
- **1.0.c — DKIM record extraction: keep the whole records array vs filter to DKIM-only.** *Recommendation: filter to DKIM TXT only.* Tradeoff: Resend's response sometimes includes MX records that conflict with CF Email Routing's MX (the user must NOT add Resend's MX, since CF handles inbound). Filtering avoids the footgun. **Resolved: take recommendation.**
- **1.0.d — Idempotent Set-up-sending behavior.** *Recommendation: if the local row already has `resendDomainId`, return the existing record (call `getDomainStatus` to refresh the DKIM record), don't re-create.* **Resolved: take recommendation.**
- **1.0.e — `domains.create` 409 handling.** *Recommendation: list + get by name to recover the existing ID.* Tradeoff: two extra API calls in the rare race; cleaner than asking the user to manually type the ID. **Resolved: take recommendation.**
- **1.0.f — Verification check rate-limit handling.** *Recommendation: surface 429 as a one-line "Resend rate-limited the check; try again in a moment" inline.* No automatic retry. **Resolved: take recommendation.**
- **1.0.g — `from_address` recorded in `messages` for verified-domain sends.** *Recommendation: still the user's chosen mailbox address.* Same as 0.7 — the UI must read coherently. The wire-level From is now the same as the recorded From (no lie anymore for verified domains). **Resolved: take recommendation.**
- **1.0.h — Migration ordering: schema change committed in same PR as code that depends on it.** *Recommendation: yes — the PR is atomic.* If anyone applies the code without the migration, queries fail loudly with "no such column"; we don't try to gracefully degrade. **Resolved: take recommendation.**
- **1.0.i — Compose form's mailbox dropdown showing verified status.** *Recommendation: don't show explicit "verified" indicator next to each option.* The sandbox notice (visible/hidden based on selected From) is sufficient signal. Keeps the dropdown clean. **Resolved: take recommendation.**

## NOT in this PR

- Auto-polling or webhook-based verification.
- Importing existing Resend domains via UI.
- Per-mailbox sending toggle.
- DoH-based DNS verification beyond what Resend reports.
- Removing a domain from Resend / unverifying.
- DKIM key rotation UI.
- SPF / DMARC record display.
- Outbound from the Worker.
- App-level auth.
- `from_name` selection.
- Tests.
- Mobile responsive treatment.

## Acceptance checklist

- [ ] `pnpm install` succeeds.
- [ ] `pnpm db:generate` produces a new migration; `pnpm db:migrate` applies it locally without errors.
- [ ] `pnpm db:reset` rebuilds the local DB with the new columns; domains have `resend_domain_id = NULL` and `resend_verified_at = NULL`.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` clean.
- [ ] `pnpm build` succeeds.
- [ ] `pnpm pages:build` succeeds.
- [ ] `pnpm dev`: `/settings/domains` renders with each seeded domain showing "Sending: not set up" + a "Set up sending" button.
- [ ] With `RESEND_API_KEY` unset, clicking Set up sending shows a clear inline error.
- [ ] With `RESEND_API_KEY` set: clicking Set up sending calls Resend, stores the ID, expands the DNS panel with a "For sending" DKIM TXT record visible. The badge becomes "Sending: pending."
- [ ] Clicking Check verification calls Resend's status endpoint; if Resend says verified, the badge flips to "Sending: ready."
- [ ] Once a domain is "Sending: ready", composing from a mailbox on that domain shows no sandbox notice, and the actual Resend send uses real From.
- [ ] Composing from an unverified-domain mailbox still shows the sandbox notice; sends still use `onboarding@resend.dev` with Reply-To.
- [ ] Calling Set up sending on a domain that already has `resendDomainId` returns the existing record without re-registering (no duplicate API call).
- [ ] No regression: domain-add, ingest, reader, reply, HTML rendering, worker:test, all unchanged.

## Line budget

Target: **~340 lines** of hand-written code (schema +4, migration generated, resend/client 25, resend/domains 80, actions 50, queries 50, send 25, dns-records-panel 40, domains-list 90, compose-form 10, compose page 1, README +8, DEPLOY-PAGES +6). 25% tripwire: **~425 LoC**. The risk is `domains-list.tsx` growing past 90 LoC of delta because of the dual-action button + per-row state.
