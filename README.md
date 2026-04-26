# Iris

> **Self-hosted, multi-domain email for vibe-code founders.**
> One UI for all your projects. Cloudflare-native. $0 on free tiers.

You're shipping ten products at once. Each one needs `hello@thing.com`. You don't want to pay $7/mo per project to Google Workspace, you don't want six Gmail tabs, and you don't want to babysit a mail server.

Iris gives you one inbox for every domain you own — read, reply, send-as, all from one tab.

## How it works

- **Inbound:** Cloudflare Email Routing → Email Worker → D1 + R2
- **Outbound:** Resend (or any SMTP-ish provider — pluggable)
- **UI:** Next.js + Tailwind, deployed to Cloudflare Pages
- **Single-tenant by design.** It's your inbox. One password, one cookie, done.

Add a domain, paste two DNS records, and `hello@yourthing.com` shows up in Iris alongside everything else you own.

## Status

Early. The shell, the schema, and a Grandma-mode mailbox view are in. No real mail flowing yet. See [`SPEC.md`](./SPEC.md) for the full design and `docs/phase-*.md` for what each phase shipped.

If you want to help shape v0, open an issue or grab one from the [issues tab](https://github.com/fuselinkapp/iris/issues).

## Local development

```bash
pnpm install
pnpm db:reset     # creates the local D1, applies migrations, seeds 18 fake threads
pnpm dev          # runs Next dev with bindings wired via @cloudflare/next-on-pages
```

Then open <http://localhost:3000>, flip the Mode dial in the sidebar to **Grandma**, and you'll see the seeded threads.

> Local storage lives at `.wrangler/state/v3/d1/...sqlite` — wrangler's local D1 simulator. The dashboard reads from the same file the Worker test harness writes to, so curl-ing inbound and seeing it in the UI just works. Older checkouts had a `.iris/` directory; you can `rm -rf .iris/` after pulling — it's no longer used.

The reader renders HTML emails inside a sandboxed iframe with DOMPurify sanitization. Remote images (often tracking pixels) are blocked by default — click **Show images** at the top of any HTML message to load them. Plain-text threads continue to render as before.

## Trying out inbound

The `/api/ingest` endpoint accepts pre-parsed messages, so you can exercise the inbound pipeline without a Cloudflare Worker yet. The Worker phase (0.6) will call this same endpoint with the same payload shape.

```bash
# (Optional) set a token to require auth in dev; otherwise dev mode bypasses it
echo 'IRIS_INGEST_TOKEN=dev' >> .env.local

# Fire a sample at the running dev server
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -H "x-iris-ingest-token: dev" \
  -d @samples/inbound/01-stripe-payout.json
```

Then refresh the Grandma view to see it land. Other samples in `samples/inbound/` exercise threading via `In-Reply-To`, the **Pending → Verified** flip on first inbound to a new domain, and subject-fallback grouping for transactional mail without threading headers.

To exercise the **Cloudflare Email Worker** locally without spinning up wrangler — same parser, same `ingestMessage` function the deployed Worker uses, just writing to the same local D1 file `pnpm dev` reads from:

```bash
pnpm worker:test                                       # default sample
pnpm worker:test samples/inbound/raw/01-stripe.eml     # explicit path
```

## Sending mail

Outbound is via Resend. Set `RESEND_API_KEY` in `.env.local` for real sends; without the key, the compose form runs as a dry-run that still records the message locally so you can exercise the UI flow.

Hit **Compose** in the sidebar (or visit `/compose`), pick a From mailbox, type a recipient + subject + body, and Send. Sent messages appear in your own inbox under that mailbox so the thread reads as a real two-way conversation.

Reply lives inside the reader pane — open a thread in Grandma, click **Reply**, type, hit Send. Replies thread with the original via `In-Reply-To` headers, so when the recipient replies *back* via real inbound, it merges into the same thread.

By default a domain sends in **sandbox mode** (`onboarding@resend.dev` From, your real address as Reply-To). To send from `hello@yourdomain.com` for real, open `/settings/domains`, click **Set up sending** on the domain, paste the new DKIM TXT record into your DNS, and click **Check verification** when it's propagated. Once the badge flips to "Sending: ready", composing from a mailbox on that domain uses the real From — the sandbox notice in compose disappears for verified domains.

## Production deploy

Two pieces — both Cloudflare:

- [`DEPLOY.md`](./DEPLOY.md) — the inbound Email Worker, D1, R2, and Email Routing wiring.
- [`DEPLOY-PAGES.md`](./DEPLOY-PAGES.md) — the dashboard on Cloudflare Pages (reads the same D1 the Worker writes to). Includes the recommended Cloudflare Access setup so the URL isn't publicly readable.

## License

MIT — see [`LICENSE`](./LICENSE).

## Why "Iris"?

Greek messenger goddess. Also: the part of the eye you look through. Fitting for an inbox you actually want to look at.
