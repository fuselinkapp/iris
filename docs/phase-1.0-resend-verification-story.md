# Phase 1.0 — Resend per-domain verification (story)

## Who & what

The vibe-code founder has been using Iris in the deployed Pages dashboard for a few weeks. Inbound mail flows in via the Worker, the dashboard reads it cleanly from D1, they reply and the conversation threads correctly. The one thing that still feels half-built is sending: every outbound goes from `onboarding@resend.dev` because the domain isn't verified at Resend yet. Recipients get confused, replies still route back via Reply-To but the experience is amateurish. This phase closes that gap. The founder opens `/settings/domains`, clicks **Set up sending** on `notebook.fyi`, Iris talks to Resend's API behind the scenes, and a new DKIM TXT record appears in the panel alongside the existing CF Email Routing records. They paste it into their DNS, wait, click **Check verification**, and the badge flips from "Sending pending" to "Sending ready." The next email they send goes from `hello@notebook.fyi`. Nothing else changes.

This is the v1.0 ship. After this, recipients see real From addresses; the product is genuinely a thing someone else could use.

## In scope

- **Schema change** (the first since phase 0.2): two new nullable columns on `domains` —
  - `resend_domain_id` (text) — the ID Resend returns when we register the domain on the user's behalf.
  - `resend_verified_at` (epoch ms) — set when Resend's verification check first reports `verified`.
  - A drizzle-kit-generated migration that's safe on the wrangler-local DB AND on production D1 (additive only — no data loss).
- **Resend domains API wrapper** at `lib/resend/domains.ts` — three calls used: `resend.domains.create({ name })`, `resend.domains.get(id)`, and a small mapper that pulls the DKIM TXT record out of the create/get response.
- **`setupSendingForDomain(domainId)` Server Action** — looks up the local domain row, calls `resend.domains.create({ name })`, stores the returned `resend_domain_id`, returns the DKIM record for the UI to display. Handles the case where Resend already has the domain registered (returns existing ID) and the case where the API key is missing.
- **`checkResendVerification(domainId)` Server Action** — looks up the local row, calls `resend.domains.get(resendDomainId)`, and if status is `verified`, sets `resend_verified_at` to now. Returns the new status.
- **`/settings/domains` UI extensions**:
  - Each domain row gains a **Sending status** sub-badge: `Sending: not set up` / `Sending: pending` / `Sending: ready`.
  - When sending is not set up: a **Set up sending** button. Click → `setupSendingForDomain` → expand the DNS panel with the new section visible.
  - When sending is pending: a **Check verification** button. Click → `checkResendVerification` → flip the badge if the API agrees.
  - The DNS records panel now has two sections:
    1. **For receiving** (existing CF Email Routing records — unchanged).
    2. **For sending** (Resend's DKIM TXT record — visible only after Set up sending completes).
- **`send.ts` updated** so `sendMessage` reads the sender domain's `resend_verified_at`. If set, the Resend payload uses `from: 'hello@yourdomain.com'` (the actual mailbox address). If null, falls back to the existing sandbox From `onboarding@resend.dev` with Reply-To.
- **Compose UI updates**: the sandbox notice in `<ComposeForm />` is shown only when the *currently-selected* From mailbox's domain is unverified at Resend. Verified domains: no notice (it just sends from the real address).
- **Seed update**: seeded domains stay Resend-unverified. They're fake (`catnap.dev`, `vibehq.com`); the Set-up-sending flow remains visible and clickable in dev so the user can exercise it (it'll fail with a clear error if `RESEND_API_KEY` is unset, otherwise actually call Resend's sandbox).
- **`DEPLOY-PAGES.md` updated** to remove the lingering "outbound is sandbox-only" caveat and explain the new per-domain setup flow.
- **`README.md` updated** — Sending mail section reflects the verified-domain story.
- **No regression**: every existing flow unchanged for domains that haven't gone through Set up sending. Sandbox mode still works for the dev-without-API-key case.

## Out of scope

- **Auto-polling** for verification status. Check-now button only — no background timers, no webhook endpoint.
- **Webhook endpoint** for Resend notifications. The check-verification button is the trigger.
- **Importing existing Resend domains** that the user might already have registered. If the user calls Set up sending on a domain Resend already knows about, Resend's API returns the existing ID — we just store that. But there's no UI for "I already have these domains at Resend, link them up."
- **Per-mailbox sending toggle**. All mailboxes on a verified domain send real; all on an unverified domain go sandbox. No granular override.
- **DNS verification beyond what Resend reports.** We trust Resend's status — we don't independently DoH-lookup the DKIM record.
- **Removing a domain from Resend.** Once registered, the resend_domain_id stays in the row. No "unverify" / "remove from Resend" UI.
- **DKIM key rotation.** Resend's choice; we display whatever record they give us.
- **SPF / DMARC records.** Resend's free tier just uses DKIM for outbound. We don't surface SPF/DMARC instructions in this phase.
- **Outbound sending from the Worker.** Still dashboard-only.
- **App-level auth.** CF Access remains the trust boundary in production.
- **Tests.** None.
- **Mobile responsive treatment of the new buttons.**

## Constraints & assumptions

- **`RESEND_API_KEY` is required** for any of the new buttons to work. The same key used for sending (already an env var since phase 0.7). If unset:
  - Set-up-sending button shows a small "Set RESEND_API_KEY first" inline error.
  - Existing sandbox-mode sending continues to work the same way.
  - The check-verification button is hidden for any domain that doesn't have a `resend_domain_id` (because you couldn't have set one without the key).
- **Schema migration runs on first deploy**. The plan-doc spells out how the user applies it to production D1 (`wrangler d1 migrations apply iris-d1`). Local: `pnpm db:migrate` already does this.
- **No new dependencies**. The `resend` SDK is already a dep since 0.7; it has `resend.domains` baked in.
- **Resend free-tier limits** apply. Domains API calls count against the standard rate limit; the Set-up-sending and Check-verification buttons both fire one API call each, manually. No cost concern.
- **The `from` address on send is the chosen mailbox's local-part + domain.** No `from_name` (still null per phase 0.7). A future phase adds display-name selection.
- **Assumption**: Resend's `domains.create` is idempotent in practice — calling it twice with the same name returns either the existing entry or a 409, which we treat as "already exists, fetch it." We handle both.
- **Assumption**: Resend's `domains.get(id)` returns a `status` field whose `verified` value means "DKIM has propagated and Resend can send via this domain." If their semantics drift, the badge is visually stale until we adjust.
- **Assumption**: it's OK that the local seeded domains don't actually work for outbound. They're fake; the user understands the flow without sending real mail to themselves.
- **Assumption**: the "Sending: pending" → "Sending: ready" badge transition is sufficient feedback for the verification flow. No animation, no toast.

## Open implementation questions (planner-decidable)

- **Where the Resend client lives** — `lib/resend/client.ts` exports `getResendClient()` (lazy singleton, returns `Resend | null` if `RESEND_API_KEY` is unset). Reused by `lib/email/send.ts` (currently has its own version) and `lib/resend/domains.ts`. Worth consolidating.
- **`lib/resend/domains.ts` shape** — pure functions: `registerDomain(name)`, `getDomainStatus(resendDomainId)`. Each returns `{ ok: true, ... }` or `{ ok: false, reason, detail? }` like the rest of the app.
- **DKIM record shape from Resend** — Resend's `domains.create` returns `{ id, name, records: [{ record, name, type, value, ttl, status, priority? }] }`. We pick the DKIM TXT record (the one with `type: 'TXT'` and `name` containing `_domainkey`) and surface it. Newer Resend responses sometimes include MX/SPF too; we filter to the DKIM TXT only since CF Email Routing handles the MX side.
- **Schema migration name** — let drizzle-kit auto-name; commit it as-is.
- **Two columns vs JSON blob** — two columns. Searchable, indexable, simpler.
- **Sub-badge styling** — same style as the existing receive-status badge but smaller, sits under the row title.
- **Compose sandbox-notice gating** — pass `isSandboxFor(mailboxId)` boolean into `<ComposeForm />` from the page. The page already knows the mailboxes and their domains' verified status (extend `getMailboxesForSend` to include `resendVerified`).
- **Error from Resend API** — surface inline in the row. Common cases: 401 (bad key), 422 (invalid domain name), 429 (rate limit). Map each to a user-readable line.
- **Idempotency of Set-up-sending** — if the row already has a `resend_domain_id`, the action returns the existing record without re-calling Resend. The button hides in this case anyway (Check verification takes its place).

## Resolved questions (verbatim Q&A from discovery)

- **Q: How does the user register a domain at Resend?** A: Iris calls Resend's API to register (recommended).
- **Q: How is the verification status checked?** A: Manual "Check now" button per domain (recommended).
- **Q: What does send do once a domain is Resend-verified?** A: Auto-use real From for verified domains, sandbox for pending (recommended).
