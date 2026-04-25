# Phase 0.1 — Command-Center Shell (plan)

**Story:** `docs/phase-0.1-command-shell-story.md`

## Goal

Stand up a Cloudflare-Pages-shaped Next.js 15 app at the repo root with a softened Raycast/Arc command-center shell — Today view, Focus/Triage/Grandma mode switcher, Settings placeholder, Compose placeholder, dark-default theme — establishing Iris's voice with zero real email plumbing.

## Changes

### Project root config

- `package.json` — name `iris`, `private: true`, scripts: `dev`, `build`, `start`, `lint`, `format`, `typecheck`, `test`. Deps: `next@^15`, `react@^19`, `react-dom@^19`, `next-themes`, `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`. Dev deps: `typescript`, `@types/node`, `@types/react`, `@types/react-dom`, `tailwindcss@^4`, `@tailwindcss/postcss`, `postcss`, `@biomejs/biome`, `vitest`, `@vitejs/plugin-react`.
- `pnpm-workspace.yaml` — omitted (single app, not a monorepo).
- `tsconfig.json` — strict, `moduleResolution: bundler`, `paths: { "@/*": ["./*"] }`.
- `next.config.ts` — minimal; `reactStrictMode: true`. No `output: 'export'` — we'll use `@cloudflare/next-on-pages` later.
- `postcss.config.mjs` — `@tailwindcss/postcss`.
- `biome.json` — formatter + linter, 2-space indent, single quotes, semicolons as needed; ignore `node_modules`, `.next`, `docs`.
- `vitest.config.ts` — react plugin, `environment: 'jsdom'`, no actual test files yet.
- `.gitignore` — Next.js + node + Biome cache + `.env*.local` + `.vercel` + `.wrangler`.

### App routes (App Router)

- `app/layout.tsx` — html/body, Geist Sans via `next/font/google`, `<ThemeProvider>` from `components/theme-provider.tsx`, root background applies warm-dark token.
- `app/globals.css` — Tailwind v4 `@import "tailwindcss"`; CSS variables for tokens (`--bg`, `--surface`, `--surface-elevated`, `--border-subtle`, `--text`, `--text-muted`, `--accent` = warm amber `#d4a574`, `--accent-fg`); light + dark variants via `[data-theme]` selectors set by `next-themes`. No pure-black backgrounds.
- `app/page.tsx` — server component; renders `<AppShell>` wrapping a `<TodayView>` client component.
- `app/settings/page.tsx` — server component; renders `<AppShell>` with the settings inner layout.
- `app/settings/layout.tsx` — settings sub-layout: vertical left nav (AI / Modes / Domains / Mailboxes) + content area; default tab redirects to `/settings/ai`.
- `app/settings/ai/page.tsx`, `app/settings/modes/page.tsx`, `app/settings/domains/page.tsx`, `app/settings/mailboxes/page.tsx` — each a small server component with title + one-line "coming soon" description.
- `app/compose/page.tsx` — client component; standalone page with a back button, To/Subject/Body fields (uncontrolled, no submit handler), centered max-width card.

### Components

- `components/theme-provider.tsx` — client wrapper for `next-themes` `<ThemeProvider attribute="data-theme" defaultTheme="dark" enableSystem>`.
- `components/app-shell.tsx` — client component; two-column grid (sidebar 240px / content 1fr); renders `<Sidebar>` + children. Listens for `keydown`: `c` → push `/compose`, `?` → toggle help overlay state (overlay rendered inline). Ignores keystrokes when focus is inside an input/textarea/`contenteditable`.
- `components/sidebar.tsx` — client component; brand mark at top, `<ModeSwitcher>`, "Mailboxes" section header with "+ add domain" disabled placeholder, footer row with `<ThemeToggle>` and a settings icon link.
- `components/mode-switcher.tsx` — client component; reads + writes mode via `lib/mode-store.ts`. Renders three radio-style buttons (Focus / Triage / Grandma) with one-line subtitle each.
- `components/today-view.tsx` — client component; reads current mode, renders mode-specific empty state + the centered command-bar input. Each mode's copy:
  - **Focus:** "Nothing needs you right now." subtitle "You're caught up. Iris will surface things here when they matter."
  - **Triage:** "Inbox zero, inbox calm." subtitle "When mail arrives, Iris will queue suggested actions here."
  - **Grandma:** "No mailboxes connected yet." subtitle "Add a domain to see your mail the classic way."
- `components/command-bar.tsx` — disabled `<input>` with placeholder "Search coming soon", `<kbd>/</kbd>` chip on the right, soft elevation.
- `components/theme-toggle.tsx` — client; sun/moon icon button using `next-themes` `useTheme()`.
- `components/help-overlay.tsx` — client; centered card listing `c` and `?` shortcuts. (Inlined inside `app-shell` if it stays small — split only if it grows.)
- `components/settings-nav.tsx` — client; `usePathname` to highlight active tab.
- `lib/cn.ts` — `clsx` + `tailwind-merge` helper.
- `lib/mode-store.ts` — three exports: `getMode()`, `setMode(m)`, `useMode()`. `useMode` is a `useSyncExternalStore` hook reading/writing `localStorage['iris.mode']`. SSR fallback returns `'focus'`.

### Misc

- `README.md` — keep as-is; the spec already explains the project.
- `LICENSE` — untouched.
- `SPEC.md` — untouched.

## Micro-decisions (auto-resolved on superyolo)

- **0.1.a — Mode store impl.** *Recommendation: plain `useSyncExternalStore` over `localStorage`, no Zustand/Jotai dep.* Tradeoff: a bit more code than Zustand, but zero dependencies and works fine for one boolean-ish piece of state. **Resolved: take recommendation.**
- **0.1.b — Compose route shape.** *Recommendation: standalone `/compose` page, `router.push` from the `c` shortcut, no parallel-route modal.* Tradeoff: slightly less slick than an intercept-route modal but ~40 fewer lines and avoids a known App Router footgun. **Resolved: take recommendation.**
- **0.1.c — Accent color.** *Recommendation: warm amber `#d4a574` (matches "softened" + "iris/eye" warmth without being purple-cliché).* Tradeoff: amber reads warmer than the cooler Vercel/Linear palette but matches "Raycast/Arc soft" better. **Resolved: take recommendation.**
- **0.1.d — shadcn.** *Recommendation: skip the `shadcn` CLI for this phase, hand-write the 3–4 primitives we need (`Button`, `Input`, `Card`).* Tradeoff: less reusable than full shadcn install but avoids dragging in 15 unused components and the CLI's Tailwind-v4 quirks. **Resolved: take recommendation, but place primitives in `components/ui/` so a future shadcn add is drop-in.**
- **0.1.e — Body font.** *Recommendation: Geist Sans only, loaded via `next/font/google`.* Tradeoff: no mono font means `<kbd>` chips use Geist with letter-spacing rather than a true mono — fine for the softened look. **Resolved: take recommendation.**
- **0.1.f — Mode persistence on first paint.** *Recommendation: render the Focus empty state on SSR; let the client hook hydrate to the persisted mode after mount.* Tradeoff: a one-frame flash for users who'd previously selected Triage/Grandma — acceptable on a single-user app and avoids cookie/header gymnastics. **Resolved: take recommendation.**
- **0.1.g — Settings default tab.** *Recommendation: `/settings` redirects to `/settings/ai`.* Tradeoff: removes the "no tab selected" empty state. **Resolved: take recommendation.**

## NOT in this PR

- Real email data (DB, schema, migrations, R2, inbound, outbound).
- Cloudflare bindings (`wrangler.toml`, D1, R2, Pages config). Code is *shaped* for Pages but not deployed.
- Auth (no login screen, no cookie).
- AI features (no API key field beyond a "coming soon" panel, no model calls).
- Domain-add real flow (no DNS record generator).
- Mobile responsive polish.
- Keyboard shortcuts beyond `c` and `?`.
- Tests (Vitest config exists; no tests written).
- `pnpm install` lockfile — committed at the end of the phase but treated as generated.

## Acceptance checklist

- [ ] `pnpm install` succeeds from a clean checkout.
- [ ] `pnpm dev` boots and `http://localhost:3000/` renders the Today view in dark mode by default.
- [ ] Sidebar shows Mode switcher (Focus selected by default), Mailboxes section with disabled "+ add domain", footer with theme toggle + settings icon.
- [ ] Clicking Triage / Grandma updates the visible empty state and persists across page reload.
- [ ] Theme toggle flips between dark and light without a flash.
- [ ] `/settings` redirects to `/settings/ai`; left nav highlights the active tab; switching tabs updates content; "coming soon" text reads cleanly.
- [ ] Pressing `c` (when no input is focused) navigates to `/compose`; the page renders an empty form with a back link.
- [ ] Pressing `?` toggles a help overlay listing `c` and `?`.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm build` succeeds (production build, no Cloudflare adapter required).
- [ ] `pnpm lint` (Biome) reports zero errors.

## Line budget

Target: **~600 lines of production code** (excluding `package.json`, lockfile, config files, and generated content). Higher than the default 200 because this is a from-scratch scaffold — all of it is net-new and there's no existing code to reuse. The 25% tripwire is therefore ~750 lines. If the diff exceeds 750 LoC of hand-written `app/` + `components/` + `lib/` code, stop and surface.
