import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq, gte, sql } from 'drizzle-orm';

import { contacts, domains, mailboxes, messages, threads } from '@/db/schema';
import { getDb } from '@/lib/db/client';

export type IngestPayload = {
  from?: { name?: string; address: string };
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  inReplyTo?: string;
  references?: string[];
  receivedAt?: number;
  rawR2Key?: string;
};

export type IngestResult =
  | {
      ok: true;
      threadId: string;
      messageId: string;
      mailboxId: string;
      verifiedDomain: boolean;
    }
  | { ok: false; reason: 'unknown_recipient' | 'invalid_payload'; detail?: string };

const THREAD_SUBJECT_FALLBACK_MS = 30 * 24 * 60 * 60_000;
const SUBJECT_PREFIX = /^(re|fwd?|fw)\s*:\s*/i;

type NormalizedPayload = {
  from: { name?: string; address: string };
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string | null;
  html: string | null;
  headers: Record<string, string>;
  inReplyTo: string | null;
  references: string[];
  receivedAt: number;
  rawR2Key: string | null;
};

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function validatePayload(
  p: IngestPayload,
): { ok: true; value: NormalizedPayload } | { ok: false; detail: string } {
  if (!p.from || typeof p.from.address !== 'string' || !p.from.address.trim()) {
    return { ok: false, detail: 'from.address required' };
  }
  if (!isStringArray(p.to) || p.to.length === 0) {
    return { ok: false, detail: 'to[] required' };
  }
  if (typeof p.subject !== 'string') {
    return { ok: false, detail: 'subject required' };
  }
  return {
    ok: true,
    value: {
      from: {
        name: typeof p.from.name === 'string' ? p.from.name : undefined,
        address: p.from.address.trim().toLowerCase(),
      },
      to: p.to.map((a) => a.trim().toLowerCase()),
      cc: isStringArray(p.cc) ? p.cc.map((a) => a.trim().toLowerCase()) : [],
      bcc: isStringArray(p.bcc) ? p.bcc.map((a) => a.trim().toLowerCase()) : [],
      subject: p.subject,
      text: typeof p.text === 'string' ? p.text : null,
      html: typeof p.html === 'string' ? p.html : null,
      headers: p.headers && typeof p.headers === 'object' ? p.headers : {},
      inReplyTo: typeof p.inReplyTo === 'string' ? p.inReplyTo : null,
      references: isStringArray(p.references) ? p.references : [],
      receivedAt: typeof p.receivedAt === 'number' ? p.receivedAt : Date.now(),
      rawR2Key: typeof p.rawR2Key === 'string' ? p.rawR2Key : null,
    },
  };
}

function normalizeSubject(s: string): string {
  let cur = s;
  while (SUBJECT_PREFIX.test(cur)) cur = cur.replace(SUBJECT_PREFIX, '');
  return cur.trim().toLowerCase();
}

function deriveSnippet(text: string | null, html: string | null, subject: string): string {
  const source =
    text?.trim() ||
    (html
      ? html
          .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : '') ||
    subject;
  return source.slice(0, 100);
}

function lowerHeaderLookup(headers: Record<string, string>, key: string): string | undefined {
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function ensureMessageId(headers: Record<string, string>): string {
  return lowerHeaderLookup(headers, 'message-id') ?? `<${randomUUID()}@iris.local>`;
}

export async function ingestMessage(payload: IngestPayload): Promise<IngestResult> {
  const validation = validatePayload(payload);
  if (!validation.ok) return { ok: false, reason: 'invalid_payload', detail: validation.detail };
  const p = validation.value;

  const candidates = [...p.to, ...p.cc];
  const db = getDb();

  // Resolve mailbox before opening the transaction — read-only, no need to lock.
  let recipient: { mailboxId: string; domainId: string; verifiedAt: Date | null } | null = null;
  for (const addr of candidates) {
    const at = addr.indexOf('@');
    if (at <= 0 || at === addr.length - 1) continue;
    const local = addr.slice(0, at);
    const domainName = addr.slice(at + 1);
    const [row] = await db
      .select({
        mailboxId: mailboxes.id,
        domainId: domains.id,
        verifiedAt: domains.verifiedAt,
      })
      .from(mailboxes)
      .innerJoin(domains, eq(mailboxes.domainId, domains.id))
      .where(and(eq(mailboxes.localPart, local), eq(domains.domain, domainName)))
      .limit(1);
    if (row) {
      recipient = row;
      break;
    }
  }
  if (!recipient) return { ok: false, reason: 'unknown_recipient' };
  const hasPendingDomain = recipient.verifiedAt === null;

  const messageId = randomUUID();
  const headerMessageId = ensureMessageId(p.headers);
  const headerMap = { ...p.headers, 'message-id': headerMessageId };
  const candidateRefs = [p.inReplyTo, ...p.references].filter((s): s is string => Boolean(s));
  const normSubject = normalizeSubject(p.subject);
  const snippet = deriveSnippet(p.text, p.html, p.subject);
  const receivedAtDate = new Date(p.receivedAt);

  // better-sqlite3 transactions are SYNCHRONOUS. Do not introduce `await` inside
  // this callback — better-sqlite3 commits on synchronous return, so an awaited
  // operation would execute *after* commit and break atomicity. If a future
  // change needs async work, do it before/after the transaction, not inside.
  return db.transaction((tx) => {
    let threadId: string | null = null;

    // Header-based threading: look for any existing message in this mailbox
    // whose stored Message-ID matches one of our In-Reply-To / References
    // values. SQLite's json_extract reads the value out of the JSON-stringified
    // headers column. Use sql.join to safely parameterize the IN list.
    if (candidateRefs.length > 0) {
      const refsList = sql.join(
        candidateRefs.map((r) => sql`${r}`),
        sql`, `,
      );
      const headerHits = tx.all(
        sql`SELECT m.thread_id AS thread_id
            FROM messages m
            INNER JOIN threads t ON t.id = m.thread_id
            WHERE t.mailbox_id = ${recipient.mailboxId}
              AND json_extract(m.headers, '$."message-id"') IN (${refsList})
            LIMIT 1`,
      ) as Array<{ thread_id: string }>;
      if (headerHits[0]?.thread_id) threadId = headerHits[0].thread_id;
    }

    // Subject-fallback threading: only if the normalized subject is non-empty.
    if (!threadId && normSubject !== '') {
      const cutoff = new Date(p.receivedAt - THREAD_SUBJECT_FALLBACK_MS);
      const subjectHits = tx
        .select({ id: threads.id, subject: threads.subject })
        .from(threads)
        .where(and(eq(threads.mailboxId, recipient.mailboxId), gte(threads.lastMessageAt, cutoff)))
        .all();
      const match = subjectHits.find((t) => normalizeSubject(t.subject) === normSubject);
      if (match) threadId = match.id;
    }

    if (!threadId) {
      threadId = randomUUID();
      tx.insert(threads)
        .values({
          id: threadId,
          mailboxId: recipient.mailboxId,
          subject: p.subject,
          snippet,
          lastMessageAt: receivedAtDate,
          messageCount: 1,
          unreadCount: 1,
        })
        .run();
    } else {
      tx.update(threads)
        .set({
          snippet,
          lastMessageAt: receivedAtDate,
          messageCount: sql`message_count + 1`,
          unreadCount: sql`unread_count + 1`,
        })
        .where(eq(threads.id, threadId))
        .run();
    }

    tx.insert(messages)
      .values({
        id: messageId,
        threadId,
        fromAddress: p.from.address,
        fromName: p.from.name ?? null,
        toAddresses: JSON.stringify(p.to),
        ccAddresses: JSON.stringify(p.cc),
        bccAddresses: JSON.stringify(p.bcc),
        subject: p.subject,
        html: p.html,
        text: p.text,
        headers: JSON.stringify(headerMap),
        rawR2Key: p.rawR2Key,
        readAt: null,
        receivedAt: receivedAtDate,
      })
      .run();

    let verifiedDomain = false;
    if (hasPendingDomain) {
      tx.update(domains)
        .set({ verifiedAt: receivedAtDate, dkimStatus: 'verified' })
        .where(eq(domains.id, recipient.domainId))
        .run();
      verifiedDomain = true;
    }

    tx.insert(contacts)
      .values({
        id: randomUUID(),
        email: p.from.address,
        name: p.from.name ?? null,
        lastSeenAt: receivedAtDate,
      })
      .onConflictDoUpdate({
        target: contacts.email,
        set: {
          name: sql`COALESCE(excluded.name, name)`,
          lastSeenAt: sql`MAX(COALESCE(last_seen_at, 0), excluded.last_seen_at)`,
        },
      })
      .run();

    return { ok: true, threadId, messageId, mailboxId: recipient.mailboxId, verifiedDomain };
  });
}
