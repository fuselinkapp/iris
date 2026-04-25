# Iris

> Self-hosted email for people who run too many projects.

**Codename:** Iris (Greek messenger goddess; the iris is also what you look through — fitting for an inbox).

---

## The problem

Running multiple side-projects / products means juggling Gmail accounts at ~$7/user/month each, or stuffing everything into aliases that forward into one Gmail and lose their identity. Existing alternatives (Migadu, Zoho, Fastmail) are cheap but feel like 2010 webmail. Hey.com / Shortwave are pretty but locked-in and pricey.

Iris is the third option: **own your domains, own your data, own the UI** — without rebuilding the deliverability stack from scratch.

---

## Who this is for

**Vibe-code founders.** People shipping 5–15 small products at once, each needing its own domain and `hello@thing.com`. They don't want to pay $7/mo per project to Google Workspace, they don't want six Gmail tabs, and they don't want to babysit a mail server. One person, many domains, one inbox.

This shapes everything below — there is exactly one user. No teams, no RLS, no auth provider. It's your inbox; if someone has the cookie, they're you.

## Principles

1. **Don't reinvent SMTP.** Lean on Cloudflare Email Routing / Postmark for inbound, Resend for outbound. The product is the UX layer, not MX records.
2. **Single-tenant by default.** No multi-user plumbing in v0. One password, one cookie, done.
3. **Multi-domain first.** Every project gets a real `hello@project.com` in one unified inbox.
4. **Free-tier friendly.** A founder running 10 projects should pay $0–$5/mo total, not $70.
5. **Beautiful by default.** If it looks like Roundcube, it has failed.
6. **Local-first feel.** Fast, keyboard-driven, no spinners.
7. **Open source.** MIT. See "Open source / tool?" below.

---

## Architecture (v0) — Cloudflare-native

The whole thing runs on Cloudflare's free tier. No server to manage, no Supabase, no Postgres. Deploy and forget — it matches the vibe-code energy.

```
  Domains (Cloudflare DNS, MX → Email Routing)
        │
        ▼
  Cloudflare Email Routing  ──▶  Email Worker
                                       │
                                       ▼
                                  D1 (SQLite)  ◀──┐
                                       │          │
                                       ▼          │
                                  R2 (raw .eml,   │
                                  attachments)    │
                                                  │
  Iris Web (Next.js on Pages or Hono on Worker) ──┘
        │
        ▼
  Resend API (outbound)
```

**Stack:**
- **Inbound:** Cloudflare Email Routing → Email Worker (free, unlimited domains)
- **DB:** Cloudflare D1 (SQLite) — free tier: 5GB, 25M reads/day, 50k writes/day. Plenty.
- **Blobs:** Cloudflare R2 — raw RFC822 + attachments. Free tier: 10GB, no egress fees.
- **Frontend:** Next.js 15 + Tailwind + shadcn, deployed to Cloudflare Pages
- **Backend:** Hono on Workers (or Next.js route handlers if we stay on Pages)
- **Outbound:** Resend (3k/mo free, pluggable to Postmark/SES later)
- **Auth:** Single password + signed cookie. Or put Cloudflare Access in front and skip auth entirely.
- **Search:** D1 FTS5 (SQLite full-text). Switch to Typesense only if it ever gets slow (it won't, for one user).

**Total cost for a founder running 10 projects:** $0/mo until you exceed free tiers. Compare to ~$70/mo on Google Workspace.

### Alt path: "I don't want to be Cloudflare-locked"

For self-hosters who'd rather run a single Node process on a $5 VPS:

- **Inbound:** Postmark inbound webhook (free tier)
- **DB:** SQLite file + `litestream` replicating to S3/R2 for backup
- **Blobs:** Local disk or any S3-compatible bucket
- **Backend:** Hono or Next.js, single Node process
- **Hosting:** Hetzner / Fly.io / a Raspberry Pi in a closet

Same code, swappable adapters for inbound/blob/db. The Cloudflare path is the recommended default; this one exists so the project doesn't die if Cloudflare changes its mind.

---

## Data model (rough)

Single-tenant — no `user_id` columns. SQLite-shaped (D1 or local file).

```sql
domains       (id, domain, verified_at, dkim_status, ...)
mailboxes     (id, domain_id, local_part, display_name)  -- hello@x.com
threads       (id, mailbox_id, subject, last_message_at, snippet, ...)
messages      (id, thread_id, from, to, cc, bcc, html, text, headers, raw_r2_key)
attachments   (id, message_id, filename, mime, size, r2_key)
labels        (id, mailbox_id, name, color)
message_labels(message_id, label_id)
contacts      (id, email, name, last_seen_at)
```

Raw RFC822 + attachments live in R2 (or any S3-compatible bucket on the alt path); structured/searchable fields live in D1.

---

## v0 scope (the weekend build)

- [ ] Add domain → show DNS records to paste into Cloudflare
- [ ] Receive mail via Postmark inbound → store + show in inbox
- [ ] Threaded inbox view, one mailbox at a time, with switcher
- [ ] Read message (HTML iframe, sanitized)
- [ ] Reply / compose / send via Resend
- [ ] Keyboard shortcuts (`j/k`, `e` archive, `r` reply, `c` compose, `/` search)
- [ ] Search (Postgres FTS)

## v0.5

- [ ] Unified inbox across mailboxes
- [ ] Labels / archive / snooze
- [ ] Contacts auto-extracted from threads
- [ ] Attachments
- [ ] Mobile responsive

## v1

- [ ] Multi-user (per-domain ACLs)
- [ ] Custom signatures per mailbox
- [ ] Templates / canned responses
- [ ] Rules engine ("if from:stripe.com → label Billing")
- [ ] Calendar invite parsing
- [ ] Push / web notifications

## Later, maybe

- AI triage ("what actually needs a reply today")
- Threaded TODOs (Hey-style "Reply Later")
- Native macOS app via Tauri
- Self-hostable Docker compose

---

## Open source / tool? — yes, both

**Recommendation: open core.**

- **Open source (MIT) repo** — the whole web app, schema, inbound/outbound adapters. Anyone can clone, point at their own Postmark + Supabase, and run it. This is the "tool" version.
- **Hosted version** — `iris.email` or similar. Same code, plus billing, onboarding, managed DNS verification, support. Free tier (1 domain, 1k msgs/mo), paid tiers for more.
- **License consideration:** AGPL if we want to prevent a big provider forking and SaaS-ing it without contributing back. MIT if we want maximum adoption. Default to MIT for now; can re-license before v1 if needed.

This is the same playbook as Cal.com, Plausible, Dub, Documenso — open source the product, monetize the hosting + premium features.

**Why this works for Iris specifically:**
- The deliverability moat lives at Postmark/Resend, not in our code → safe to open-source.
- Self-hosters become the best evangelists.
- Sensitive data (people's email!) → users *want* the option to self-host. Open source is a trust signal, not a giveaway.

---

## Non-goals

- Replacing Gmail for everyone. This is for indie devs and small teams with N domains.
- Running our own SMTP servers / IP warming. We delegate that.
- Calendar / docs / chat. Email only. Maybe forever.
- Mobile-first. Desktop keyboard-driven first; mobile later.

---

## Open questions

1. AGPL vs MIT? (Bias: start MIT.)
2. Build our own component system or shadcn? (Bias: shadcn for v0, swap pieces as the design language emerges.)
3. Do we need an iOS app for v1, or is mobile web enough?
4. Pricing model if hosted: per-domain, per-mailbox, or per-message?
5. Is Cloudflare Email Routing's parsing (raw MIME passed to Worker) good enough, or do we still want Postmark inbound as the primary path for richer parsed JSON?

---

## Status

Day 0. Spec only. No code yet.
