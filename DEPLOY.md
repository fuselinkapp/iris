# Deploying Iris to Cloudflare

This walkthrough turns the local repo into a live Iris instance: a Worker that catches mail via Cloudflare Email Routing, a D1 database for the inbox, and (declared but not used yet) an R2 bucket for raw `.eml` archives.

The Next.js dashboard deploy to Cloudflare Pages is **not** covered here yet — that comes in a later phase. This doc is exclusively about the inbound Worker.

## What you'll need

- A Cloudflare account.
- A domain you own that's already on Cloudflare DNS. (If it isn't, transfer it to CF first — Email Routing only works for domains on CF DNS.)
- Wrangler authenticated locally: `pnpm exec wrangler login`.

## One-time setup

### 1. Create the D1 database

```bash
pnpm exec wrangler d1 create iris-d1
```

Copy the printed `database_id` value into `wrangler.toml`, replacing `REPLACE_WITH_YOUR_D1_ID`:

```toml
[[d1_databases]]
binding = "IRIS_DB"
database_name = "iris-d1"
database_id = "1a2b3c4d-..."   # paste here
migrations_dir = "db/migrations"
```

### 2. Apply the schema to D1

```bash
pnpm exec wrangler d1 migrations apply iris-d1
```

Wrangler reads the SQL files from `db/migrations/` (the same ones the local dev DB uses) and applies them remotely.

### 3. Create the R2 bucket

```bash
pnpm exec wrangler r2 bucket create iris-raw
```

The Worker doesn't write to R2 yet — the binding is declared so the next phase (raw `.eml` archive) is a one-line code change rather than a config bump.

### 4. Deploy the Worker

```bash
pnpm exec wrangler deploy
```

Wrangler bundles `worker/index.ts` and uploads it. It'll print the Worker name (`iris-mail-worker` by default).

### 5. Wire Email Routing → Worker

In the Cloudflare dashboard:

1. Open your domain → **Email** → **Email Routing**.
2. Enable Email Routing (this configures MX records automatically — they should match the records Iris showed you when you added the domain in `/settings/domains`).
3. Go to **Email Workers**, find `iris-mail-worker`, and create a routing rule:
   - For a single mailbox: `Custom address: hello@yourdomain.com → Send to Worker → iris-mail-worker`.
   - For everything: `Catch-all → Send to Worker → iris-mail-worker`.

### 6. Send a test message

From any other inbox, send an email to `hello@yourdomain.com`. In another terminal:

```bash
pnpm exec wrangler tail
```

You should see a `[iris worker] landed` log line within a few seconds. Open the dashboard (when Pages deploy lands) or query D1 directly to confirm the row exists.

## Local development

Two parallel paths share the same code:

- **The dashboard / curl ingest path** runs against `.iris/iris.db` (better-sqlite3). Used by `pnpm dev` and `curl -X POST /api/ingest`.
- **The Worker path** runs against a separate local D1 simulator at `.wrangler/state/v3/d1/...sqlite`. Used by `pnpm worker:dev`.

To exercise the Worker handler without spinning up wrangler at all:

```bash
pnpm worker:test                                     # default sample
pnpm worker:test samples/inbound/raw/01-stripe.eml   # explicit
```

That runs the same `handleEmail()` the deployed Worker uses, but writes to the local SQLite file so you can see the result in `pnpm dev`'s Grandma view.

To exercise the Worker via wrangler's local D1 simulator:

```bash
pnpm exec wrangler d1 migrations apply iris-d1 --local
pnpm exec wrangler dev
```

Wrangler's `email` simulation is limited; for full end-to-end testing, deploy to a staging Worker and send real mail.

## Re-deploying after schema changes

Whenever `db/schema.ts` changes:

```bash
pnpm db:generate                                   # creates new SQL migration locally
pnpm exec wrangler d1 migrations apply iris-d1     # apply to remote D1
pnpm exec wrangler deploy                          # redeploy Worker
```

## Outbound via Resend

Outbound currently runs in **sandbox mode**: regardless of which mailbox the user picks, Resend dispatches with `onboarding@resend.dev` as the SMTP From. The user's chosen mailbox is recorded as `from_address` in the DB (so the UI reads coherently) and sent as the `Reply-To` header (so recipients' replies route back through Cloudflare Email Routing → Worker → Iris).

To enable outbound at all:

```bash
# Locally
echo 'RESEND_API_KEY=re_yourkey...' >> .env.local

# In production (once Pages deploy lands), set as a Cloudflare Pages env var
# in the dashboard, or via: pnpm exec wrangler pages secret put RESEND_API_KEY
```

Without `RESEND_API_KEY` set, the compose form runs in dry-run mode — DB write happens, no actual send. Useful for exercising the UI in development.

**Real per-domain From** (so your recipients see `hello@yourdomain.com` instead of `onboarding@resend.dev`) requires a separate verification flow at Resend: you add the domain in Resend's dashboard, paste their generated DKIM records into your DNS, and wait for verification. Iris doesn't yet have UI for this — it's a future phase. In the meantime, sandbox mode lets the inbound/outbound loop work end-to-end with the obvious caveat that the From address looks generic.

## Notes

- The local `.iris/iris.db` and the remote D1 are separate, independent stores. Migrating data between them is not automated.
- The Worker has no auth — it trusts CF Email Routing's upstream gate. Anyone able to deliver mail to your domain via SMTP can write to the inbox. This matches the v0 single-tenant trust model.
- If a message fails to ingest (unknown recipient, malformed payload), the Worker calls `message.setReject(...)`, which causes the upstream sender to receive a bounce.
