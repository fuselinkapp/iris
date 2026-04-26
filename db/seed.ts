import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { resolveLocalD1Path } from '@/lib/db/local-path';

import * as schema from './schema';

const dbPath = resolveLocalD1Path();
const sqlite = new Database(dbPath);
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

const now = Date.now();
const minutes = (n: number) => now - n * 60_000;
const hours = (n: number) => now - n * 60 * 60_000;
const days = (n: number) => now - n * 24 * 60 * 60_000;

type Seed = {
  mailbox: string;
  fromName: string;
  fromAddress: string;
  subject: string;
  snippet: string;
  body: string;
  html?: string;
  receivedAt: number;
  read?: boolean;
};

const SEEDS: Seed[] = [
  // hello@catnap.dev — 10 threads
  {
    mailbox: 'hello@catnap.dev',
    fromName: 'Stripe',
    fromAddress: 'updates@stripe.com',
    subject: 'Your weekly payout of $1,284.50 is on its way',
    snippet: "We've initiated a transfer to your bank account ending in 4242.",
    body: 'Your payout is on its way and should arrive in 2 business days.',
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:540px;padding:24px;color:#1a1a1a;">
  <h1 style="font-size:18px;margin:0 0 16px;font-weight:500;color:#374151;">Your weekly payout</h1>
  <p style="font-size:32px;font-weight:600;margin:0 0 8px;color:#111827;">$1,284.50</p>
  <p style="color:#6b7280;margin:0 0 20px;">on its way to your bank account ending in 4242</p>
  <a href="https://dashboard.stripe.com/payouts" style="display:inline-block;background:#635bff;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:500;">View in dashboard</a>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="color:#9ca3af;font-size:12px;margin:0;">Funds typically arrive within 2 business days. <img src="https://stripe.com/img/v3/spacer.gif" width="1" height="1" alt="" style="display:inline;"></p>
</div>`,
    receivedAt: minutes(7),
  },
  {
    mailbox: 'hello@catnap.dev',
    fromName: 'Vercel',
    fromAddress: 'no-reply@vercel.com',
    subject: '✓ Production deploy succeeded — catnap.dev',
    snippet: 'Your latest deployment is live at https://catnap.dev (build #482, 2.1s).',
    body: 'Production deployment completed successfully.',
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;padding:32px 24px;color:#0f172a;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
    <span style="display:inline-block;width:32px;height:32px;background:#000;border-radius:6px;color:#fff;text-align:center;line-height:32px;font-weight:600;">▲</span>
    <span style="font-weight:600;font-size:16px;">Vercel</span>
  </div>
  <h1 style="font-size:24px;margin:0 0 8px;font-weight:600;">Deployment ready</h1>
  <p style="margin:0 0 24px;color:#64748b;">Build #482 finished in 2.1s.</p>
  <div style="border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:24px;">
    <p style="margin:0 0 4px;font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">Production</p>
    <a href="https://catnap.dev" style="color:#0f172a;text-decoration:none;font-weight:500;font-size:18px;">catnap.dev</a>
  </div>
  <a href="https://vercel.com/oz/catnap/deployments/482" style="display:inline-block;background:#000;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:500;">View deployment</a>
  <p style="margin-top:32px;color:#94a3b8;font-size:12px;">
    <img src="https://vercel.com/api/cron-images/badge.png" width="60" height="20" alt="badge" style="vertical-align:middle;">
    Triggered by oz on commit ab12cd3
  </p>
</div>`,
    receivedAt: minutes(34),
    read: true,
  },
  {
    mailbox: 'hello@catnap.dev',
    fromName: 'Maya Chen',
    fromAddress: 'maya@hellomaya.co',
    subject: 'Re: pricing question',
    snippet:
      'That works! Happy to do the annual plan if you can throw in the priority support tier.',
    body: 'Thanks for getting back to me — that pricing works.',
    receivedAt: hours(2),
  },
  {
    mailbox: 'hello@catnap.dev',
    fromName: 'GitHub',
    fromAddress: 'notifications@github.com',
    subject: '[catnap/api] PR #128: Refactor session token rotation',
    snippet:
      '@oz reviewed your pull request — 2 comments, 1 suggestion to consider before merging.',
    body: 'Review left on PR #128.',
    receivedAt: hours(4),
    read: true,
  },
  {
    mailbox: 'hello@catnap.dev',
    fromName: 'Linear',
    fromAddress: 'notifications@linear.app',
    subject: 'CAT-241 was assigned to you',
    snippet: '"Onboarding empty-state copy is too clinical" — moved to In Progress, due Friday.',
    body: 'Issue CAT-241 assigned.',
    receivedAt: hours(6),
  },
  {
    mailbox: 'hello@catnap.dev',
    fromName: 'Cloudflare',
    fromAddress: 'noreply@notify.cloudflare.com',
    subject: 'Workers usage at 78% of free tier',
    snippet: 'You have used 7,800,000 of 10,000,000 included requests this month.',
    body: 'Worker usage approaching limit.',
    receivedAt: hours(11),
    read: true,
  },
  {
    mailbox: 'hello@catnap.dev',
    fromName: 'Calendly',
    fromAddress: 'no-reply@calendly.com',
    subject: 'New meeting: Coffee chat with Priya Nair — Tue 2:30pm',
    snippet:
      "Priya from Anthropic booked time on your calendar. Topic: 'figuring out distribution'.",
    body: 'Calendar invite for Tuesday 2:30pm.',
    receivedAt: hours(18),
  },
  {
    mailbox: 'hello@catnap.dev',
    fromName: 'Postmark',
    fromAddress: 'support@postmarkapp.com',
    subject: 'Your monthly invoice is ready — $0.00',
    snippet: "You're under the free tier. No charge this month. Receipt attached.",
    body: 'Monthly invoice attached.',
    receivedAt: days(1),
    read: true,
  },
  {
    mailbox: 'hello@catnap.dev',
    fromName: 'Anthropic',
    fromAddress: 'billing@anthropic.com',
    subject: 'API receipt: $42.18 — November',
    snippet: 'Thank you for your payment. Your invoice for November API usage is attached.',
    body: 'November API usage: $42.18.',
    receivedAt: days(2),
    read: true,
  },
  {
    mailbox: 'hello@catnap.dev',
    fromName: 'Ben Otieno',
    fromAddress: 'ben@indiestack.club',
    subject: 'love what you shipped this week',
    snippet: "Saw the changelog post — the keyboard-first thing is exactly what I've been wanting.",
    body: 'Quick note saying nice work.',
    receivedAt: days(3),
    read: true,
  },

  // billing@catnap.dev — 5 threads
  {
    mailbox: 'billing@catnap.dev',
    fromName: 'Stripe',
    fromAddress: 'invoicing@stripe.com',
    subject: 'New invoice paid: INV-1043 — $89.00',
    snippet: 'Invoice for "catnap pro — annual" was paid by maya@hellomaya.co.',
    body: 'Invoice paid.',
    receivedAt: minutes(22),
  },
  {
    mailbox: 'billing@catnap.dev',
    fromName: 'Stripe',
    fromAddress: 'updates@stripe.com',
    subject: 'Failed payment retry on subscription sub_1NxYz',
    snippet: "We couldn't charge the card on file. We'll retry in 3 days.",
    body: 'Payment retry scheduled.',
    receivedAt: hours(9),
  },
  {
    mailbox: 'billing@catnap.dev',
    fromName: 'Mercury',
    fromAddress: 'team@mercury.com',
    subject: 'Wire received: $4,200 from ACME LLC',
    snippet: 'Funds available now in your Mercury checking account.',
    body: 'Wire received.',
    receivedAt: days(1),
    read: true,
  },
  {
    mailbox: 'billing@catnap.dev',
    fromName: 'Stripe',
    fromAddress: 'updates@stripe.com',
    subject: 'Tax form 1099-K is available',
    snippet: 'Your 2025 1099-K is ready to download from the dashboard.',
    body: '1099-K available.',
    receivedAt: days(4),
    read: true,
  },
  {
    mailbox: 'billing@catnap.dev',
    fromName: 'Ramp',
    fromAddress: 'noreply@ramp.com',
    subject: 'Statement closed — November',
    snippet: 'Your November statement is ready. Total spend: $312.44 across 14 transactions.',
    body: 'November statement.',
    receivedAt: days(5),
    read: true,
  },

  // founder@vibehq.com — 3 threads
  {
    mailbox: 'founder@vibehq.com',
    fromName: 'Y Combinator',
    fromAddress: 'apply@ycombinator.com',
    subject: 'Re: your W26 application',
    snippet: "Thanks for applying. We'd love to hop on a call next week — pick a time that works.",
    body: 'YC interview scheduling.',
    receivedAt: hours(1),
  },
  {
    mailbox: 'founder@vibehq.com',
    fromName: 'Notion',
    fromAddress: 'team@makenotion.com',
    subject: "We've shipped the thing you asked for",
    snippet:
      'Inline databases now support the formula property you requested in feedback last month.',
    body: 'Notion update.',
    receivedAt: hours(20),
    read: true,
  },
  {
    mailbox: 'founder@vibehq.com',
    fromName: 'Sara Park',
    fromAddress: 'sara@northstack.vc',
    subject: 'intro?',
    snippet:
      'Saw your launch tweet — would love to introduce you to a portfolio founder doing adjacent work.',
    body: 'Intro request.',
    receivedAt: days(2),
  },
];

const truncate = sqlite.transaction(() => {
  for (const table of [
    'message_labels',
    'attachments',
    'messages',
    'labels',
    'threads',
    'contacts',
    'mailboxes',
    'domains',
  ]) {
    sqlite.prepare(`DELETE FROM ${table}`).run();
  }
});
truncate();

const seedTx = sqlite.transaction(() => {
  const domainCatnap = { id: randomUUID(), domain: 'catnap.dev', verifiedAt: days(40) };
  const domainVibe = { id: randomUUID(), domain: 'vibehq.com', verifiedAt: days(20) };

  db.insert(schema.domains)
    .values([
      {
        id: domainCatnap.id,
        domain: domainCatnap.domain,
        verifiedAt: new Date(domainCatnap.verifiedAt),
        dkimStatus: 'verified',
      },
      {
        id: domainVibe.id,
        domain: domainVibe.domain,
        verifiedAt: new Date(domainVibe.verifiedAt),
        dkimStatus: 'verified',
      },
    ])
    .run();

  const mboxes = [
    { id: randomUUID(), domainId: domainCatnap.id, localPart: 'hello', displayName: 'Catnap' },
    {
      id: randomUUID(),
      domainId: domainCatnap.id,
      localPart: 'billing',
      displayName: 'Catnap billing',
    },
    {
      id: randomUUID(),
      domainId: domainVibe.id,
      localPart: 'founder',
      displayName: 'Vibe HQ',
    },
  ];
  db.insert(schema.mailboxes).values(mboxes).run();

  const mboxByAddress = new Map<string, string>();
  for (const m of mboxes) {
    const domain = m.domainId === domainCatnap.id ? 'catnap.dev' : 'vibehq.com';
    mboxByAddress.set(`${m.localPart}@${domain}`, m.id);
  }

  for (const [seedIndex, seed] of SEEDS.entries()) {
    const mailboxId = mboxByAddress.get(seed.mailbox);
    if (!mailboxId) throw new Error(`Unknown seed mailbox: ${seed.mailbox}`);

    const threadId = randomUUID();
    const messageId = randomUUID();
    const unread = seed.read ? 0 : 1;
    const headerMessageId = `<seed-${seedIndex.toString().padStart(2, '0')}@iris.local>`;

    db.insert(schema.threads)
      .values({
        id: threadId,
        mailboxId,
        subject: seed.subject,
        snippet: seed.snippet.slice(0, 100),
        lastMessageAt: new Date(seed.receivedAt),
        messageCount: 1,
        unreadCount: unread,
      })
      .run();

    db.insert(schema.messages)
      .values({
        id: messageId,
        threadId,
        fromAddress: seed.fromAddress,
        fromName: seed.fromName,
        toAddresses: JSON.stringify([seed.mailbox]),
        subject: seed.subject,
        text: seed.body,
        html: seed.html ?? null,
        headers: JSON.stringify({ 'message-id': headerMessageId }),
        receivedAt: new Date(seed.receivedAt),
        readAt: seed.read ? new Date(seed.receivedAt) : null,
      })
      .run();
  }
});
seedTx();

console.log(`Seeded ${SEEDS.length} threads across 3 mailboxes on 2 domains.`);
sqlite.close();
