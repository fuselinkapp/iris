# Phase 0.4 — Domain-add UI (plan)

**Story:** `docs/phase-0.4-domain-add-story.md`

## Goal

Upgrade `/settings/domains` from placeholder to a working list+form that persists a `domains` row and an auto-created `hello@<domain>` mailbox, then displays the Cloudflare Email Routing DNS records the user needs to paste.

## Changes

### `lib/email/cloudflare-records.ts` (new, ~30 LoC)

- Exports `CLOUDFLARE_EMAIL_ROUTING_RECORDS` as a typed `readonly` array of records `{ type: 'MX' | 'TXT'; host: '@'; value: string; priority?: number; note: string }`.
- Two MX entries (priority 1 + 2 → `route1.mx.cloudflare.net`, `route2.mx.cloudflare.net`) and one TXT (`v=spf1 include:_spf.mx.cloudflare.net ~all`).
- Phase 0.5 will import the same constant from the worker handler.

### `lib/db/queries.ts` (modify, ~+55 LoC)

- Add `listDomains()` returning `Array<{ id: string; domain: string; verifiedAt: number | null; createdAt: number; mailboxCount: number }>`. Single Drizzle query joining `mailboxes` to derive the mailbox count, ordered `domain asc`.
- Add `addDomain(input: string)` returning `{ ok: true; domainId: string; mailboxId: string } | { ok: false; reason: 'invalid' | 'duplicate' }`. In a transaction:
  1. Normalize: `input.trim().toLowerCase()`.
  2. Validate: regex `/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/`. Return `{ ok: false, reason: 'invalid' }` if it fails.
  3. Check for existing row: `SELECT id FROM domains WHERE domain = ?`. Return `{ ok: false, reason: 'duplicate' }` if found.
  4. Insert new domain with UUID, `verifiedAt: null`, `dkimStatus: 'pending'`.
  5. Insert `hello@<domain>` mailbox with the new `domainId`.
  6. Return success payload.
- Domain-name regex enforces: lowercase only (post-normalize), no leading/trailing hyphen per label, at least one dot, TLD min 2 chars (the regex covers it via `(\.[a-z0-9]...)+`).

### `app/actions/domains.ts` (new, ~25 LoC)

- `'use server';`
- `getDomains()` — wraps `listDomains()`. `// TODO(auth)` marker.
- `addDomain(domain: string)` — wraps the query. `// TODO(auth)` marker.
- Both return plain JSON-safe payloads.

### `app/(app)/settings/domains/page.tsx` (rewrite, ~80 LoC)

- Becomes a **Server Component**. Reads via `getDomains()` directly (server context, fine to call from a server component).
- Accepts `searchParams: { add?: string }` so arriving from the sidebar with `?add=1` auto-opens the add panel.
- Renders:
  - Page header: "Domains" title + "Add domain" button (a client component that toggles the form panel).
  - `<DomainsList domains={domains} />` (client component) — receives the server-fetched list as props, manages local "show DNS for which row" state, renders the form panel when toggled, calls `router.refresh()` after a successful add.
- If no domains: empty state ("Add your first domain to start receiving mail at hello@yourthing.com").

### `components/domains-list.tsx` (new, ~140 LoC)

- Client component. Props: `initialDomains`, `autoOpenForm: boolean`.
- State: `showForm`, `domain` (input value), `error`, `pending` (via `useTransition`), and `expandedDomainId` (which row's DNS panel is open).
- Form panel: input + Add button + Cancel button. Submit calls `addDomain(domain)`; on success → `router.refresh()`, clear form, collapse panel; on error → set `error` from the action result.
- Domain row: domain name, status pill, "Show DNS" button (toggles `expandedDomainId`), date added.
- Renders `<DnsRecordsPanel domain={domain.domain} />` when expanded.
- Status pill: `Pending` muted gray; `Verified` accent.
- Date format: `MMM d, yyyy` via a tiny inline formatter (no new helper file — one line).

### `components/dns-records-panel.tsx` (new, ~80 LoC)

- Client component (needs clipboard). Props: `domain: string`.
- Imports `CLOUDFLARE_EMAIL_ROUTING_RECORDS`.
- Renders a short prose intro: "Paste these into the DNS tab of your registrar (or Cloudflare DNS, if your domain is on Cloudflare). Records can take up to 24 hours to propagate."
- Renders a 4-column grid for each record: Type / Host / Value / Copy.
- Copy button uses `navigator.clipboard.writeText(value)`; swap label to "Copied" for 1.5s via local state.
- Subtle visual treatment: monospace value column for the records themselves, ghost-button copy actions.

### `components/sidebar.tsx` (modify, ~-3 LoC, +5 LoC)

- Replace the disabled `<button>` for "+ Add domain" with a `<Link href="/settings/domains?add=1">` styled the same way (enabled state, no `disabled` attr, hover behavior). Keep the icon and text.

### `app/(app)/page.tsx`, `lib/db/client.ts`, etc.

- **No changes.** The Grandma view's `getGrandmaData` already lists all mailboxes, so newly added ones appear automatically.

### `next.config.ts`, `package.json`

- **No new deps.**

## Micro-decisions (auto-resolved on superyolo)

- **0.4.a — Form shape: inline panel vs modal.** *Recommendation: inline panel above the list, slides open on toggle.* Tradeoff: less "premium" than a modal but no focus-trap to build, and the Settings shell already gives context. **Resolved: take recommendation.**
- **0.4.b — `getDomains` Server Action vs direct query in the Server Component.** *Recommendation: direct call from the page (`const domains = await listDomains()`), `getDomains` Server Action also exposed for future client-side refetches if needed.* Tradeoff: redundancy is minimal and the symmetry with phase 0.2's `getGrandmaData` is worth keeping. The page uses the direct call; the action exists for parity. **Resolved: take recommendation — but skip exposing the action if unused. Reading on second thought: skip the action entirely; one path, the direct query.** Final: page Server Component imports `listDomains` directly, no `getDomains` action. The plan above lists the action as defensive — *amended here*: remove `getDomains` from the action file. Only `addDomain` ships in the action.
- **0.4.c — Auto-open the form when arriving from sidebar.** *Recommendation: `?add=1` query param read by the page, passed as `autoOpenForm` to the client component.* Tradeoff: a small URL pollution but clearer than a one-shot client-side flag. **Resolved: take recommendation.**
- **0.4.d — Sidebar link styling.** *Recommendation: mirror existing sidebar item styles (px-3 py-2 rounded-xl, muted → text + bg-elevated on hover).* No more disabled appearance. **Resolved: take recommendation.**
- **0.4.e — Validation regex strictness.** *Recommendation: the regex above (lowercase, label rules, ≥1 dot, TLD ≥2 chars).* Tradeoff: rejects punycode, IDN, single-label hostnames. Acceptable for v0; the founder is adding `notebook.fyi`-style domains. **Resolved: take recommendation.**
- **0.4.f — `router.refresh()` vs full page navigation.** *Recommendation: `router.refresh()` after successful add — re-runs the Server Component's query without losing client state.* **Resolved: take recommendation.**
- **0.4.g — DNS records source of truth.** *Recommendation: `lib/email/cloudflare-records.ts` constant imported by the UI; phase 0.5's worker will import the same.* **Resolved: take recommendation.**
- **0.4.h — Default mailbox display name.** *Recommendation: the bare domain (`notebook.fyi`).* Tradeoff: not as friendly as the seed's "Catnap" / "Vibe HQ" but consistent and trivially renameable later. **Resolved: take recommendation.**

## NOT in this PR

- Real DNS verification (DoH lookup, propagation polling).
- Mailbox management UI (add second mailbox, rename, delete).
- Domain delete or edit.
- Multi-provider support.
- DKIM key generation.
- Cloudflare API integration (token-based DNS automation).
- First-run onboarding flow on `/`.
- Punycode / IDN / TLD list validation.
- Toast notifications.
- Route-group `*` subdomain handling.
- Auth / per-user ownership.
- Tests.

## Acceptance checklist

- [ ] `pnpm dev` boots; `/settings/domains` renders without the placeholder copy.
- [ ] With no domains beyond the seed: list shows the 2 seeded domains (`catnap.dev`, `vibehq.com`) with `Verified` badges (seed sets `verifiedAt` non-null).
- [ ] Clicking "Add domain" reveals the inline form.
- [ ] Submitting `notebook.fyi` adds it to the list within ~100ms; status reads `Pending`; "Show DNS" expands a panel with 3 records and copy buttons.
- [ ] Submitting an already-existing domain (e.g. `catnap.dev`) shows an inline "Already added" error and doesn't insert.
- [ ] Submitting an invalid string (e.g. `not a domain`, `example`, `.com`) shows an inline format error.
- [ ] Adding a new domain auto-creates a `hello@<domain>` mailbox visible in Grandma's mailbox column on next visit / refresh.
- [ ] Sidebar "+ Add domain" button is enabled, links to `/settings/domains?add=1`, and the form is open on arrival.
- [ ] Each DNS-record copy button writes to the clipboard and shows "Copied" briefly.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm build` succeeds.
- [ ] `pnpm lint` clean.
- [ ] No regression: Grandma, Focus, Triage modes; reader pane; existing settings sub-tabs all work.

## Line budget

Target: **~250 lines** of hand-written code (queries +55, action +25, page rewrite +80 / -8 placeholder, domains-list 140, dns-records-panel 80, sidebar delta +2, cloudflare-records 30 = ~410 raw additions but ~250 net after subtracting boilerplate the placeholder consumed). 25% tripwire: **~310 LoC**. If the actual edit blows past 310 net LoC, surface and stop.
