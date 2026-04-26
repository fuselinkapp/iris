# Deploying the Iris dashboard to Cloudflare Pages

This walkthrough deploys the Next.js dashboard to Cloudflare Pages via [`@cloudflare/next-on-pages`](https://github.com/cloudflare/next-on-pages). The dashboard reads the same D1 database the Worker writes to (set up in [`DEPLOY.md`](./DEPLOY.md)), so once both are live the loop is closed: real mail flows in via the Worker, you read it in the dashboard.

If you haven't already deployed the inbound Worker, do that first — the D1 + R2 resources it creates are reused here.

## What you'll need

- The phase-0.6 Worker setup completed (D1 created, R2 bucket, Worker deployed).
- Wrangler authenticated locally (`pnpm exec wrangler login`).
- A custom domain you'd like the dashboard reachable on (optional but recommended).

## One-time setup

### 1. Build for Pages

```bash
pnpm pages:build
```

`@cloudflare/next-on-pages` reads `.next/` and produces a Pages-compatible output at `.vercel/output/static`.

### 2. Create the Pages project

```bash
pnpm exec wrangler pages project create iris-dashboard --production-branch main
```

### 3. Set Pages env vars

```bash
pnpm exec wrangler pages secret put RESEND_API_KEY --project-name iris-dashboard
pnpm exec wrangler pages secret put IRIS_INGEST_TOKEN --project-name iris-dashboard
```

`RESEND_API_KEY` enables outbound (otherwise compose runs in dry-run mode). With the key set, sends initially use Resend's sandbox From (`onboarding@resend.dev`); to send from your real domain addresses, open `/settings/domains` after deploy and click **Set up sending** per domain — Iris will register the domain with Resend, surface the DKIM TXT record, and flip the per-domain badge to "Sending: ready" once verification propagates. `IRIS_INGEST_TOKEN` protects the `/api/ingest` HTTP fallback endpoint.

### 4. Bind D1 to the Pages project

The `wrangler pages` CLI doesn't yet support binding D1 to Pages projects directly, so use the dashboard:

1. **Cloudflare dashboard** → **Workers & Pages** → `iris-dashboard` → **Settings** → **Functions** → **D1 database bindings** → **Add binding**.
2. Variable name: `IRIS_DB`. Database: `iris-d1`.
3. Save.

### 5. Deploy

```bash
pnpm exec wrangler pages deploy .vercel/output/static --project-name iris-dashboard
```

Wrangler prints the production URL, something like `https://iris-dashboard.pages.dev`.

### 6. Custom domain (optional)

In the Cloudflare dashboard: `iris-dashboard` → **Custom domains** → **Set up a custom domain** → enter `mail.yourdomain.com` (or whatever). DNS will configure automatically if the parent domain is on Cloudflare.

## Auth: Cloudflare Access in front

Iris itself has no app-level auth in v0 — anyone with the URL can read and write. **Don't deploy without putting Cloudflare Access in front first.**

1. **Cloudflare dashboard** → **Zero Trust** → **Access** → **Applications** → **Add an application** → **Self-hosted**.
2. Application domain: your Pages URL (or custom domain).
3. Identity provider: **One-time PIN** (sends a code to your email each login — free, no third-party signup) is the simplest. Google / GitHub also work.
4. Policy: allow only your specific email address.
5. Save. Anyone hitting the URL is now bounced through Access first.

For a single-user beta this is the trust boundary. App-level auth (single-password + signed cookie per `SPEC.md`) is a future phase.

## Local development

`pnpm dev` works as before — the dashboard reads from a local D1 simulator that wrangler manages under `.wrangler/state/v3/d1/`. Same SQLite file the Worker test harness writes to.

```bash
pnpm db:reset        # creates the local D1 + applies migrations + seeds 18 fake threads
pnpm dev             # standard Next dev with bindings wired via setupDevPlatform()
```

For an integrated test against the real `wrangler pages dev` runtime:

```bash
pnpm pages:build
pnpm pages:dev       # wrangler pages dev with the same bindings
```

## Re-deploying after changes

```bash
pnpm pages:build && pnpm exec wrangler pages deploy .vercel/output/static --project-name iris-dashboard
```

After a schema change:

```bash
pnpm db:generate                                    # new SQL migration
pnpm exec wrangler d1 migrations apply iris-d1      # apply to remote D1 (Worker AND Pages share it)
pnpm pages:build && pnpm exec wrangler pages deploy .vercel/output/static --project-name iris-dashboard
pnpm exec wrangler deploy                           # redeploy the Worker too
```

## Notes

- The dashboard and the Worker share a single D1 database (`iris-d1`) and a single R2 bucket (`iris-raw`). The shared `wrangler.toml` declares both bindings; the Pages project wires them via the dashboard.
- `pnpm dev` and the deployed Pages instance hit different D1 stores (local vs production). Migrating data between them is not automated.
- The `/api/ingest` HTTP endpoint is reachable on the deployed dashboard. Anyone with the `IRIS_INGEST_TOKEN` value can write mail into your DB. Treat the token as a real secret.
- Cloudflare Pages caches static assets aggressively — a redeploy invalidates the cache automatically.
