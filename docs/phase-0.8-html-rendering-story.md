# Phase 0.8 — HTML body rendering (story)

## Who & what

The vibe-code founder has been running Iris for a few days. Real mail is flowing — but every Stripe payout, every Vercel deploy notification, every newsletter renders as either raw whitespace-stripped text or `(no text body)` because those messages are HTML-only. The reader pane looks broken precisely on the messages they care most about. This phase teaches the reader to render HTML safely: sanitize the stored markup with DOMPurify, drop it into a sandboxed iframe so the email's CSS can't leak into the app, force a white background inside the frame so the design isn't fighting the dark UI around it, and block remote images by default with a "Show images" button per thread so tracking pixels don't fire on every open. Success: they open three real-world HTML emails in a row — the Stripe payout, a Vercel deploy, a newsletter — and each renders looking like the sender intended; meanwhile, dev tools show no third-party requests fired until they explicitly opt in.

## In scope

- **DOMPurify sanitization** of the stored `messages.html` at render time, with an email-safe tag/attribute allowlist (paragraphs, headings, lists, tables, links, images, basic inline formatting, inline `style` attributes, `class`).
- **Sandboxed `<iframe srcdoc>`** for each HTML message body. Sandbox attribute = `allow-scripts allow-popups allow-popups-to-escape-sandbox` (scripts allowed only because **we** inject the height-reporting script; the user content has been stripped of `<script>` by DOMPurify). No `allow-same-origin` — the iframe runs as a separate origin so it can't read parent cookies or DOM.
- **Content-Security-Policy meta tag inside the srcdoc** — `default-src 'none'`, `style-src 'unsafe-inline'`, `img-src` toggled by the show-images state, `font-src https: data:`. Prevents anything not explicitly allowed from loading even if sanitization misses something.
- **Auto-resize**: a small inline script inside the iframe uses `ResizeObserver` to `postMessage` the body height to the parent. The parent listens and sets the iframe height accordingly. No fixed heights, no scroll-within-scroll.
- **Block remote images by default**: `img-src` in CSP is `data:` only on first render. A "Show images" button at the top of the body section flips the per-message state to `true`, the iframe re-renders with `img-src 'https:' 'data:'`, and remote images load. Per-message state — clicking once doesn't trust the whole sender forever (yet).
- **Force light background** inside the iframe: hardcoded `body { background: #fff; color: #1a1a1a; }`. The iframe sits as a card-like element inside the dark reader pane.
- **Plain-text fallback**: if `message.text` exists and `message.html` does not, we render text as before. If both exist, render HTML. If neither, render `(no text body)` (existing behavior).
- **Outbound link safety**: rewrite `<a>` tags during sanitization to add `target="_blank" rel="noopener noreferrer"`. Links open in a new tab and can't access `window.opener`.
- **Seed update**: extend `db/seed.ts` so a couple of seeded messages (e.g. the Stripe payout, the Vercel deploy) include a realistic HTML body alongside their text body, so the reader's HTML branch is exercised on first `pnpm db:reset` without curling.
- **No regression**: text-only threads (replies the user sends, plain-text inbound) render exactly as before. Reply form, Grandma view, mode switcher, all unchanged.

## Out of scope

- **Per-sender "always show images" memory.** Each message starts with images blocked. No `trusted_senders` table.
- **Inline (`cid:`) image attachments.** The schema supports attachments; this phase doesn't pull MIME parts into renderable form. `img src="cid:…"` won't resolve and will show as a broken-image placeholder.
- **Outbound HTML composition.** Compose / reply remain plain-text only.
- **Dark-mode HTML rendering.** Iframe is hard-coded light. No "try this email in dark mode" toggle.
- **Print styles, max-width tweaks, bandit CSS resets.** Use the email's own CSS as-is inside the sanitized output. If the email looks weird, it looked weird in Gmail too.
- **Quoting collapse** ("Show trimmed content" Gmail-style). Render the full body.
- **Plain-text round-trip on reply.** Replying to an HTML email continues to send plain text only (compose form is unchanged).
- **Attachment rendering / download.**
- **Any new schema column.** `messages.html` already exists from phase 0.2.
- **Browser-side HTML beautification, prettyprint, or syntax highlighting.**
- **`html-to-text` snippet improvement.** Snippets continue to derive from `text` first, then a regex strip of HTML, then subject — same as today.

## Constraints & assumptions

- **`dompurify` runtime dep.** ~60KB minified. Only loaded in client bundles that import the new component, so it doesn't bloat server bundles or the worker.
- **Sanitization runs in the browser.** The `<HtmlMessageBody />` component is `'use client'`; DOMPurify operates against the live DOM there. No `isomorphic-dompurify`, no SSR sanitization. The reader pane is already client-only, so this fits the existing boundary.
- **CSP inside the srcdoc** is the second line of defense. DOMPurify is the first. We assume `default-src 'none'` plus a tight allowlist holds even if a clever payload slips through DOMPurify.
- **Sandbox without `allow-same-origin`** means the iframe can't access `localStorage`, can't read parent cookies, can't navigate the parent. The price: our inline height-reporting script can't share storage with the parent (it doesn't need to — `postMessage` is the channel).
- **`postMessage` origin filter**: parent listener checks `event.source === iframe.contentWindow` and `event.data.type === 'iris-iframe-height'` before applying the height. Defends against unrelated cross-frame messages.
- **Scripts inside the sandbox**: only the one we inject (`ResizeObserver` → `postMessage`). DOMPurify strips `<script>` from user content, and the CSP `default-src 'none'` blocks `<script src="…">` even if one slipped through.
- **Image blocking via CSP, not DOM rewriting.** We leave `<img>` tags in the sanitized HTML; the CSP `img-src data:` instruction tells the browser to refuse remote loads. The image element renders as a broken-icon placeholder until the user clicks Show images and the iframe re-renders with a permissive `img-src`. Cleaner than rewriting the DOM and more honest about what was blocked.
- **Assumption**: the auto-resize loop never thrashes. `ResizeObserver` debounces on its own; if a contained image or webfont changes layout, we get one extra resize per change. Acceptable.
- **Assumption**: real-world email HTML doesn't depend on `window.parent` or `top.location` — both are blocked by the sandbox without `allow-same-origin`.

## Open implementation questions (planner-decidable)

- **Where DOMPurify lives** — `lib/email/sanitize.ts`, client-only. Exports a single `sanitizeForReader(html, { allowImages })` function returning sanitized string + the `img-src` CSP value to use.
- **Iframe srcdoc construction** — built inside `<HtmlMessageBody />` from a template string. The `<head>` includes meta + style + the inline height script; `<body>` contains the sanitized HTML.
- **Show images state** — tracked per message in the reader pane (a `Set<string>` of message IDs, or a `Map<messageId, boolean>`). Lean: `Set` of "shown" IDs, default-empty.
- **Image-block placeholder visibility** — relies on the browser's broken-image icon. Don't prettify; the show-images button is the affordance.
- **Iframe key** — `key={messageId}-${imagesEnabled}` so toggling images forces a re-mount and the new srcdoc is rebuilt with updated CSP.
- **Empty/whitespace HTML** — if sanitization yields nothing meaningful, fall back to the text body if any.
- **`<a>` rewriting** — done via DOMPurify hook (`addHook('afterSanitizeAttributes', ...)`). Sets `target="_blank"` and `rel="noopener noreferrer"`.
- **External fonts** — many emails use `@import` from Google Fonts. CSP `font-src https: data:` and `style-src 'unsafe-inline'` together permit the inline `<style>` to declare them; the font request itself goes out as an HTTPS request. (Privacy-leaky — but blocking it would mangle most newsletters. Document.)
- **Seed bodies** — pick two SEEDS entries to extend with HTML: one transactional (Stripe payout), one design-heavy (Vercel deploy). Add an optional `html?: string` to the `Seed` type and write it into `messages.html`.

## Resolved questions (verbatim Q&A from discovery)

- **Q: Render approach for HTML bodies?** A: Sandboxed `<iframe srcdoc>` + DOMPurify (recommended).
- **Q: Where do we sanitize?** A: Render-time, every open (recommended).
- **Q: Remote images — load by default?** A: Block by default, "Show images" button per thread (recommended).
- **Q: How does the iframe handle the app's dark theme?** A: Force white background inside the iframe (recommended).
