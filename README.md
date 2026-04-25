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

**Day 0.** Spec only — no code yet. See [`SPEC.md`](./SPEC.md) for the full design.

If you want to help shape v0, open an issue or grab one from the [issues tab](https://github.com/fuselinkapp/iris/issues).

## License

MIT — see [`LICENSE`](./LICENSE).

## Why "Iris"?

Greek messenger goddess. Also: the part of the eye you look through. Fitting for an inbox you actually want to look at.
