# Phase 0.8 — HTML body rendering (plan)

**Story:** `docs/phase-0.8-html-rendering-story.md`

## Goal

Render `messages.html` in the reader pane via DOMPurify-sanitized content inside a sandboxed `<iframe srcdoc>` with an inline auto-resize script, force-white background, CSP-blocked remote images that the user can opt-in per message, and a couple of seeded HTML bodies so the path exercises on first `pnpm db:reset`.

## Changes

### `package.json` (modify, +1 dep, +1 devDep)

- Add `dompurify` runtime dep.
- Add `@types/dompurify` dev dep.

### `lib/db/queries.ts` (modify, +1 LoC)

- Add `html: string | null` to `MessageRow` so the reader can read it.
- Map it through in `getThreadDetail`'s `messages.map(...)`.

### `db/seed.ts` (modify, ~+30 LoC)

- Extend `Seed` type with optional `html?: string`.
- Update the Stripe payout seed (index 0) and Vercel deploy seed (index 1) with realistic HTML bodies. Both keep their existing text body (multipart/alternative parity).
- The seed insert writes `html: seed.html ?? null`.

Stripe HTML (compact, illustrative — not a real Stripe template):
```html
<div style="font-family: -apple-system, sans-serif; max-width: 540px; padding: 24px;">
  <h1 style="font-size: 18px; margin: 0 0 16px;">Your weekly payout</h1>
  <p style="font-size: 32px; font-weight: 600; margin: 0 0 8px;">$1,284.50</p>
  <p style="color: #6b7280; margin: 0 0 20px;">on its way to your bank account ending in 4242</p>
  <a href="https://dashboard.stripe.com/payouts" style="display: inline-block; background: #635bff; color: white; padding: 10px 16px; border-radius: 6px; text-decoration: none;">View in dashboard</a>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
  <p style="color: #9ca3af; font-size: 12px;">Funds typically arrive within 2 business days.</p>
  <img src="https://stripe.com/img/v3/spacer.gif" width="1" height="1" alt="" />
</div>
```

Vercel HTML (similar shape, includes a remote image so blocking is observable).

### `lib/email/sanitize.ts` (new, ~80 LoC)

- `'use client';` — DOMPurify operates against the browser DOM.
- Imports `DOMPurify` from `dompurify`.
- Module-level: install one `addHook('afterSanitizeAttributes', node => { ... })` that, for every `<a>`, sets `target="_blank"` and `rel="noopener noreferrer"`. Idempotent (DOMPurify de-dupes hooks per instance — using `removeAllHooks` once before `addHook` would be safer; lean: install once and accept that DOMPurify runs hooks each call).
- ALLOWED_TAGS list — email-safe set: `a, abbr, area, b, blockquote, body, br, caption, cite, code, col, colgroup, dd, del, dl, dt, em, figcaption, figure, h1, h2, h3, h4, h5, h6, hr, i, img, ins, kbd, li, map, mark, ol, p, pre, q, s, samp, small, span, strong, sub, sup, table, tbody, td, tfoot, th, thead, time, tr, u, ul, div, center, font`.
- ALLOWED_ATTR list — `href, src, alt, title, name, target, width, height, align, valign, bgcolor, border, cellpadding, cellspacing, colspan, rowspan, style, class, dir, lang`.
- FORBID_TAGS — `script, iframe, object, embed, form, input, button, select, textarea, base, meta, link, frame, frameset`.
- ALLOW_DATA_ATTR: false.
- Exported function: `sanitizeForReader(rawHtml: string): string` — returns the sanitized HTML string. Pure; no `allowImages` parameter (image control is via CSP, not DOM rewriting).

### `components/html-message-body.tsx` (new, ~140 LoC)

Client component. Props: `{ html: string; allowImages: boolean; onShowImages: () => void; imagesShown: boolean }`.

Behavior:
- `useMemo` to compute the sanitized HTML once per `html` prop.
- `useMemo` to compute the iframe `srcdoc` string from `(sanitized, imagesShown)`. Template:
  ```html
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src https: data:;">
      <style>
        :root { color-scheme: light; }
        html, body { margin: 0; padding: 0; }
        body { padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; background: #ffffff; word-wrap: break-word; overflow-wrap: break-word; }
        img { max-width: 100%; height: auto; }
        a { color: #2563eb; }
        table { max-width: 100%; }
      </style>
    </head>
    <body>
      ${sanitized}
      <script>
        (function() {
          function send() {
            const h = document.body.scrollHeight;
            parent.postMessage({ type: 'iris-iframe-height', height: h }, '*');
          }
          send();
          new ResizeObserver(send).observe(document.body);
        })();
      </script>
    </body>
  </html>
  ```
- `useState<number>(80)` for iframe height. `useEffect` registers a `window` `message` listener; filters `event.source === iframeRef.current?.contentWindow` and `event.data?.type === 'iris-iframe-height'`; updates state.
- Renders:
  - "Show images" pill at top-right of the body block (only if `!imagesShown` and the sanitized HTML mentions `src=`).
  - `<iframe>` with `sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"`, `srcDoc={srcdoc}`, `title="Message body"`, `style={{ width: '100%', height: `${height}px`, border: 0, display: 'block' }}`, `key={imagesShown ? 'with-img' : 'no-img'}` so toggling images re-mounts the iframe with the new CSP.

### `components/reader-pane.tsx` (modify, ~+45 LoC)

- New per-message helper: when message has `html`, render `<HtmlMessageBody />`; else fall back to `<pre>` with text. If neither, "(no text body)".
- New state: `const [imagesShown, setImagesShown] = useState<Set<string>>(new Set())` at the reader-pane level. Reset (along with other per-thread state) when `threadId` changes.
- Pass each message its own `imagesShown.has(m.id)` and an `onShowImages={() => setImagesShown(prev => new Set(prev).add(m.id))}` callback.
- The "Show images" button lives **inside** `<HtmlMessageBody />`, not at the message header level — story doc says "at the top of the body section."

### `components/grandma-view.tsx`

- **No changes.** The reader-pane HTML branch is invisible to the parent.

### `app/api/ingest/route.ts`, `worker/handler.ts`, `lib/email/ingest.ts`, `lib/email/send.ts`

- **No changes.** HTML already arrives via the `html` field on `IngestPayload` and is already written to `messages.html`. This phase teaches the reader to render it.

### `db/schema.ts`, `db/migrations/`

- **No changes.** `messages.html` already exists.

### `README.md` (modify, ~+8 LoC)

In the "Local development" section, add a one-paragraph note about HTML rendering and image privacy:

> The reader renders HTML emails inside a sandboxed iframe with DOMPurify sanitization. Remote images (typically tracking pixels) are blocked by default; click **Show images** at the top of any HTML message to load them.

### `next.config.ts`

- **No changes.** DOMPurify is pure browser code.

## Micro-decisions (auto-resolved on superyolo)

- **0.8.a — DOMPurify in the browser vs `isomorphic-dompurify` for SSR.** *Recommendation: browser only.* Tradeoff: a flash of "(no body)" on initial render before the client component mounts is conceivable, but the reader pane is already client-only after `useEffect` data fetch — there's no SSR pass to worry about. **Resolved: take recommendation.**
- **0.8.b — Image blocking via CSP vs DOM rewriting.** *Recommendation: CSP `img-src data:` only on first render; flip to `https: data:` on user opt-in.* Tradeoff: leaves `<img>` tags in the DOM (broken-icon placeholders), but cleaner than rewriting `src` attributes and lets you re-render without re-sanitizing. **Resolved: take recommendation.**
- **0.8.c — `allow-scripts` in the sandbox.** *Recommendation: yes — scripts allowed inside the sandbox so our auto-resize script runs. User content was stripped of `<script>` by DOMPurify, AND CSP `default-src 'none'` blocks any inline scripts other than ours.* Tradeoff: a defense-in-depth concern if both DOMPurify and CSP fail. The risk model: an attacker controls the email body, can run script *inside the iframe*, but cannot escape the sandbox (`window.parent` is blocked, no same-origin storage), can't make network requests (CSP), and can't open popups in a way that gets parent context (the popup escapes sandbox but the script can't pre-populate it with stolen data). **Resolved: take recommendation.**
- **0.8.d — Per-message vs per-thread "Show images".** *Recommendation: per-message.* Tradeoff: more clicks if a thread has 5 messages each with images. But per-thread would mean toggling old messages' images when a new one arrives, which is surprising. **Resolved: take recommendation.**
- **0.8.e — `font-src https: data:` in CSP.** *Recommendation: allow.* Tradeoff: it permits Google Fonts hits which leak the open-event to Google. But blocking it breaks ~80% of newsletter typography. Pragmatic call. **Resolved: take recommendation.**
- **0.8.f — Show-images button placement.** *Recommendation: small pill at the top-right of the iframe wrapper, only visible when images would actually be blocked.* Lean: detect by checking if sanitized HTML contains `src="http`. **Resolved: take recommendation.**
- **0.8.g — Iframe height initial value.** *Recommendation: 80px (small).* The auto-resize will fire within a frame; users see a brief small box that grows. Acceptable. Alternative: use HTML body height heuristic from the sanitized markup; not worth the code. **Resolved: take recommendation.**
- **0.8.h — Iframe `key` strategy on toggle.** *Recommendation: include `imagesShown` in the React `key`.* Tradeoff: forces a re-mount when toggling — the iframe is rebuilt with the new CSP. Cheaper than messaging the iframe to switch CSP at runtime (which CSP doesn't really support anyway — it's set at document load time). **Resolved: take recommendation.**

## NOT in this PR

- Per-sender "trust this domain" memory.
- `cid:` inline image attachments.
- Outbound HTML composition.
- Dark-mode HTML rendering.
- Quote collapsing ("show trimmed").
- Print styles.
- Plain-text round-trip on reply (compose stays plain).
- Attachment download UI.
- Schema changes.
- HTML-aware snippet generation.
- Beautify / syntax highlighting.

## Acceptance checklist

- [ ] `pnpm install` succeeds.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` clean.
- [ ] `pnpm build` succeeds.
- [ ] `pnpm db:reset && pnpm dev` boots; opening the **Stripe payout** thread in Grandma renders the HTML body inside a white iframe card.
- [ ] The Stripe payout shows broken-image placeholders for the spacer pixel (or no visible image because of `display:none`-equivalent CSS); a "Show images" pill is visible at the top of the body.
- [ ] Clicking "Show images" reloads the iframe and the image loads (network tab fires the request only after the click).
- [ ] The Vercel deploy thread's HTML renders correctly.
- [ ] Plain-text-only threads (e.g. customer reply, founder threads) render as before via `<pre>`.
- [ ] No `(no text body)` for any seeded message.
- [ ] Iframe auto-resizes — no inner scrollbar visible at typical viewport.
- [ ] Toggling Mode (Focus / Triage / Grandma) doesn't break the reader.
- [ ] Reply panel still works in HTML threads (compose form opens, sends).
- [ ] Sandbox + CSP confirmed in DevTools: viewing the iframe's CSP shows `default-src 'none'`; `img-src` is `data:` initially, `https: data:` after opt-in.
- [ ] No regressions in: domain-add, settings, ingest curl path, worker:test, worker bundle, compose flow.

## Line budget

Target: **~265 lines** of hand-written code (sanitize.ts ~80, html-message-body ~140, reader-pane delta ~+45, queries delta +2, seed delta ~+30, README +8). 25% tripwire: **~330 LoC**. The bulk is the iframe wrapper + sanitization config; if the wrapper grows past 200 LoC, it's a sign that show-images / height / CSP got conflated and should be split.
