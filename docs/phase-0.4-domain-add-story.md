# Phase 0.4 — Domain-add UI (story)

## Who & what

The vibe-code founder has been clicking around the seeded Grandma view and wants to add a domain they actually own — `notebook.fyi`, say — so future real mail starts flowing into Iris. They open Settings → Domains, type the domain, hit Add, and Iris responds with a row in the domain list plus a clean panel showing the exact DNS records they need to paste into Cloudflare's DNS tab. Status reads "pending" until those records propagate; that's expected. Behind the scenes the domain row is persisted, a default `hello@<domain>` mailbox is auto-created so the new domain immediately appears in Grandma's mailbox column, and the next phase (real inbound) has somewhere to write incoming mail. Success: the founder adds two domains in 30 seconds, sees both appear in Grandma's sidebar with their auto-created `hello@` mailboxes, and walks away with the DNS records visible if they want to come back to them.

## In scope

- **`/settings/domains` upgraded** from a "coming soon" placeholder to a real page with:
  - A list of existing domains, each row showing: domain name, status badge (`Pending` / `Verified`), date added, and a "Show DNS" button that expands the per-domain DNS-records panel.
  - An empty state shown when no domains exist yet.
  - An "Add domain" button at the top right.
- **Add-domain form** (modal or inline panel — planner's call) with one input: the domain name. Client-side validation: lowercase, valid hostname-ish (`/^[a-z0-9.-]+\.[a-z]{2,}$/`), no leading/trailing dots, no whitespace. Server-side validation runs the same check before persisting.
- **`addDomain(domain: string)` Server Action** that, in a single transaction:
  1. Normalizes input (trim, lowercase).
  2. Validates format.
  3. Checks for an existing row with the same domain → returns `{ ok: false, reason: 'duplicate' }`.
  4. Inserts a new `domains` row with `verified_at = null`, `dkim_status = 'pending'`.
  5. Inserts a default mailbox at `hello@<domain>` with `display_name = <domain>`.
  6. Returns `{ ok: true, domain: { id, domain, addedAt }, mailbox: { id, address } }`.
- **DNS records panel** rendered per-domain. Three records, each with the actual values to paste, plus a copy-to-clipboard button per record:
  - **MX** `route1.mx.cloudflare.net` priority 1
  - **MX** `route2.mx.cloudflare.net` priority 2
  - **TXT** `v=spf1 include:_spf.mx.cloudflare.net ~all`
  - A short prose paragraph above the records pointing the user to Cloudflare's "DNS" tab.
- **Sidebar wiring**: the disabled "+ Add domain" button in the main sidebar (currently a placeholder from phase 0.1) becomes a `<Link href="/settings/domains">` and renders enabled. Clicking it lands on the domains settings page.
- **Grandma view picks up the new mailbox automatically** — no special handling needed; the `getGrandmaData` Server Action already lists all mailboxes/threads on each call. The new domain shows up in the sidebar's mailbox column with its `hello@` mailbox under it, with zero threads.

## Out of scope

- **Real DNS verification** (DoH lookup against Cloudflare 1.1.1.1, propagation polling). Records are display-only; status stays `pending` until real inbound mail lands in phase 0.5 (which will flip the row, separately).
- **Mailbox management** beyond auto-create: no UI to add a second mailbox, no rename, no delete. The auto-created `hello@` is the only mailbox per domain in this phase.
- **Domain delete / un-verify**. Domains added cannot be removed in this phase.
- **Multi-provider support**. Cloudflare Email Routing only; the Postmark and SES paths are deferred (and may never ship if CF stays the recommended default).
- **DKIM key generation**. CF Email Routing provides DKIM via its own setup; we don't generate keys.
- **Cloudflare API integration** (using a CF API token to actually configure Email Routing on the user's behalf). User pastes records manually for now.
- **Onboarding flow** that surfaces "you have no domains yet — add one" on first visit to `/`. Settings/domains is the only entry point.
- **Validation polish**: punycode/IDN domains, deeply nested subdomains, TLD list verification. Basic regex only.
- **Real-time clipboard feedback animation** beyond a brief "Copied" affordance.
- **Email-routing-specific subdomain handling** (e.g. routing for `*.example.com`). One row per exact domain.
- **Auth / per-user domain ownership**. Single-tenant v0 — the domains table has no `user_id`.

## Constraints & assumptions

- **Schema is unchanged**. `domains` and `mailboxes` already exist with the right columns; this phase only writes to them. No new migration.
- **Cloudflare-shaped from day one**: the DNS records hardcoded in the UI are the literal values the CF Email Routing dashboard shows. Sourcing them from a config object (see micro-decisions) keeps phase 0.5 cheap when the worker handler needs the same constants.
- **Server Action pattern**: identical to `addDomain` follows the same `getGrandmaData` / `markThreadRead` shape — `'use server'`, returns plain JSON, marked with `// TODO(auth)`.
- **Local-first DB writes**: all writes hit the same local SQLite via `getDb()`. No Cloudflare API calls.
- **Form rendering**: stays inside the existing `(app)` shell so the sidebar + theme + mode switcher all stay in view. The form does *not* take over the whole screen.
- **No new deps**. Form state can be vanilla React `useState` + `useTransition`; no react-hook-form, no zod (validation is one regex + one duplicate check).
- **Assumption**: the user is technical enough to find the DNS tab of their registrar/Cloudflare dashboard — copy is direct, not hand-holding tutorial. Matches the "vibe-code founder" target.
- **Assumption**: a domain row + a mailbox row inserted in the same transaction is atomic enough — if either fails, both roll back. This avoids the half-state where a domain exists with no mailboxes.
- **Assumption**: clicking "Add domain" while a domain with the same name already exists shows an inline error in the form, not a destructive overwrite.

## Open implementation questions (planner-decidable)

- **Form shape**: inline panel that appears above the domain list when "Add domain" is clicked, vs. a modal dialog. Lean: inline panel — simpler, no focus trap to build, matches the calm aesthetic.
- **DNS records as a constant**: a `lib/email/cloudflare-records.ts` exporting `CLOUDFLARE_EMAIL_ROUTING_RECORDS` so the UI and (eventually) phase 0.5's worker share one source of truth. Lean: yes.
- **Status badge styling**: a small pill (`Pending` warm gray, `Verified` accent green). Reuse the existing `accent` token for verified.
- **Date added formatting**: `Apr 24` style via the existing `formatRelative` if recent, or `MMM d, yyyy` if older. Lean: just `MMM d, yyyy` — settings is not a hot scan surface.
- **Copy button affordance**: a small button next to each record. On click, write to clipboard and swap label to "Copied" for ~1.5s.
- **Mailbox display name default**: the bare domain (e.g. `notebook.fyi`). The seed script uses friendly names like "Catnap" — for user-added domains we default to the domain itself, user can rename later (out of scope).
- **`/settings/domains` page becomes a Server Component** that lists domains via a direct DB query. Add/refresh actions trigger a client refetch via `router.refresh()`. Lean: yes — matches Next 15 conventions, simpler than a full client component.
- **Form clears on success**, panel collapses, list refreshes.
- **Sidebar's "+ Add domain"** becomes a `<Link>` to `/settings/domains?add=1` so the form opens automatically when arriving from the sidebar. Lean: yes — small UX win, no extra state.
- **Error surface**: a single inline error message under the input field (e.g. "Already added", "Invalid format"). No toast system this phase.

## Resolved questions (verbatim Q&A from discovery)

- **Q: Which inbound provider should the DNS records target?** A: Cloudflare Email Routing (recommended).
- **Q: How should DNS verification work?** A: Display only, mark 'pending' (recommended).
- **Q: When a domain is added, what about its first mailbox?** A: Auto-create `hello@` as default (recommended).
- **Q: Where does the domain-add form live?** A: Upgrade `/settings/domains` in place (recommended).
