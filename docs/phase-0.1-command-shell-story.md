# Phase 0.1 — Command-Center Shell (story)

## Who & what

A vibe-code founder lands on Iris for the first time. They are running 5–15 small products and are tired of inboxes that fight for their attention. What they want from Iris is **a calm command center that tells them what actually needs their action right now**, with a dial they can turn from "barely show me anything" to "show me my whole inbox." They do not want a Roundcube clone and they do not want another Gmail tab. Success in this phase is: they open the URL and immediately understand that Iris is an AI-first action surface, not a mail client. There is no real mail flowing yet — this phase delivers the shell, the modes, and the empty states that establish the product's voice.

## In scope

- A working Next.js 15 app at the repo root that boots locally with `pnpm dev` and is shaped to deploy to Cloudflare Pages.
- A `/` route rendering the **Today** command-center home: sidebar on the left, single content column on the right, empty state copy, keyboard-hint footer.
- A **Mode switcher** in the sidebar with three modes: **Focus** (default), **Triage**, **Grandma**. Mode is persisted in `localStorage` and reflected in URL-free state. Each mode renders its own empty state on the home view (no real data yet — the modes are visibly distinct so the concept reads, but they don't fetch anything).
- A `/settings` route with a left-nav and four placeholder tabs: **AI**, **Modes**, **Domains**, **Mailboxes**. Each tab renders a "coming soon" panel with a one-line description of what will live there.
- A `/compose` route as a placeholder modal/page: empty form (To, Subject, Body) with no send wiring. Triggered from the inbox via the `c` keyboard shortcut.
- Theme: dark default, light toggle, follows system on first load. Built on `next-themes`.
- Visual identity: Raycast/Arc command-bar feel **softened** — Geist Sans for UI (not mono), warm-tinted dark surface, soft rounded corners, generous shadows, a centered prominent "command bar" search input on the home view as the focal point. Avoid mono fonts in body text. Avoid hard 1px terminal borders everywhere; prefer subtle dividers and elevation.
- Tooling locked: pnpm, Next.js 15 App Router, TypeScript strict, Tailwind v4, shadcn/ui (only the components we actually use), Biome (lint + format), Vitest (config only, no tests yet).

## Out of scope

- Any real email data — no DB, no schema, no migrations, no inbound webhook, no outbound send.
- Cloudflare D1 / R2 / Workers integration. The app is *shaped* for Pages but does not bind to any Cloudflare resources yet.
- Authentication. No login screen, no password, no signed cookie. The URL is the trust boundary in this phase.
- AI features. The "AI" settings tab is a placeholder; no API keys, no model calls, no draft generation.
- Adding domains for real. The "Domains" settings tab is a placeholder; no DNS record generator.
- Mobile responsiveness beyond not-breaking. Desktop-first layouts only.
- Keyboard shortcuts beyond `c` (compose) and `?` (help). `j/k`, search, archive, etc. come later.
- Tests. Vitest config exists so future phases can add tests without re-scaffolding, but no unit/integration tests are written.

## Constraints & assumptions

- **Deploy target shape**: Cloudflare Pages + (eventually) Workers. This phase avoids Node-only APIs in route handlers so the app stays Pages-compatible. It does **not** add `wrangler.toml` or Pages config yet — that's the next phase's problem.
- **Single-tenant, no auth**: matches SPEC.md principle 2. No user_id columns anywhere (no DB anyway).
- **One-person UI**: no team-switcher, no avatars, no notification bell.
- **Visual reference**: Raycast/Arc command-bar aesthetic, softened. Not Linear (too dense), not Hey (too friendly-soft).
- **Repo layout**: single Next.js app at root, not a monorepo. `app/`, `components/`, `lib/` at the root. Refactor later if Workers split out.
- **Assumption**: shadcn/ui's Tailwind-v4 path is stable enough to use directly. If it isn't, fall back to plain Tailwind primitives — do not block on shadcn.
- **Assumption**: `next-themes` works correctly with Next.js 15 App Router server components (using the standard `<ThemeProvider>` wrapper in a client boundary).

## Open implementation questions (planner-decidable)

- **Mode persistence mechanism**: `localStorage` with a small client-side store (Zustand or just `useSyncExternalStore`). Lean: plain `useSyncExternalStore` to avoid a dep.
- **Sidebar collapse**: out of scope this phase.
- **Compose route shape**: a real `/compose` page (not a parallel-route modal). Lean: standalone page, opened via `router.push` on `c`. Modal/intercept later.
- **Empty-state copy per mode**: planner decides voice; keep it short (one line + one CTA).
- **Settings nav style**: vertical left nav inside `/settings`, segmented placeholder content.
- **Command-bar search input**: visible but disabled with placeholder "Search coming soon". Establishes the focal point without faking functionality.
- **Tailwind theme tokens**: warm-dark base (slate-with-a-touch-of-amber, not pure neutral). Single accent color — lean toward an amber/iris-purple hybrid; planner picks one and commits.
- **Font loading**: `next/font/google` for Geist Sans. No mono font in body.

## Resolved questions (verbatim Q&A from discovery)

- **Q: Phase 1 scope?** A: App scaffold only.
- **Q: Deploy target shape from day one?** A: Cloudflare-native (Pages + eventually Workers + D1 + R2).
- **Q: Tooling defaults (pnpm, Next 15 App Router, TS strict, Tailwind v4, shadcn, Biome, Vitest)?** A: Yes, defaults are fine.
- **Q: Repo layout?** A: Single Next.js app at repo root.
- **Q: Pages in scaffold? (multi-select; expected: `/`, `/settings`, `/compose`)** A: All three, **plus** a vision shift — *"imagine it to be AI-first. Like a command center: what does the user need to take action. I don't need to see emails and get distracted. I can choose the level of control. Brainstorm on this and come up with your own idea. Maybe later user can add API key to predraft emails. There might be a way to select grandma mode, with domains and its emails and a general inbox for all."*
- **Q: Theme behavior?** A: Dark default + light toggle.
- **Q: Concept confirmation — Today view + Focus/Triage/Grandma modes + Settings placeholder tabs?** A: Yes, ship this.
- **Q: Visual reference?** A: Raycast/Arc command-bar feel, **softer, not too terminal-looking**.
