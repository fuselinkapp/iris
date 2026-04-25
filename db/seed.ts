import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema';

const dbPath = resolve(process.cwd(), '.iris/iris.db');
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
    receivedAt: minutes(7),
  },
  {
    mailbox: 'hello@catnap.dev',
    fromName: 'Vercel',
    fromAddress: 'no-reply@vercel.com',
    subject: '✓ Production deploy succeeded — catnap.dev',
    snippet: 'Your latest deployment is live at https://catnap.dev (build #482, 2.1s).',
    body: 'Production deployment completed successfully.',
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

  for (const seed of SEEDS) {
    const mailboxId = mboxByAddress.get(seed.mailbox);
    if (!mailboxId) throw new Error(`Unknown seed mailbox: ${seed.mailbox}`);

    const threadId = randomUUID();
    const messageId = randomUUID();
    const unread = seed.read ? 0 : 1;

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
        receivedAt: new Date(seed.receivedAt),
        readAt: seed.read ? new Date(seed.receivedAt) : null,
      })
      .run();
  }
});
seedTx();

console.log(`Seeded ${SEEDS.length} threads across 3 mailboxes on 2 domains.`);
sqlite.close();
