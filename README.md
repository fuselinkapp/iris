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
pnpm db:migrate   # creates .iris/iris.db with the v0 schema
pnpm db:seed      # 18 fake threads across 3 mailboxes on 2 domains
pnpm dev
```

Then open <http://localhost:3000>, flip the Mode dial in the sidebar to **Grandma**, and you'll see the seeded threads.

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

## License

MIT — see [`LICENSE`](./LICENSE).

## Why "Iris"?

Greek messenger goddess. Also: the part of the eye you look through. Fitting for an inbox you actually want to look at.
