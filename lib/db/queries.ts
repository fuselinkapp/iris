import 'server-only';

import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';

import { domains, mailboxes, messages, threads } from '@/db/schema';

import { getDb } from './client';

const randomUUID = () => crypto.randomUUID();

const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export type MailboxWithDomain = {
  id: string;
  domainId: string;
  domain: string;
  localPart: string;
  address: string;
  displayName: string | null;
  unreadCount: number;
  resendVerified: boolean;
};

export type ThreadRow = {
  id: string;
  mailboxId: string;
  mailboxAddress: string;
  subject: string;
  snippet: string;
  fromName: string | null;
  fromAddress: string;
  lastMessageAt: number;
  unreadCount: number;
};

export async function listMailboxes(): Promise<MailboxWithDomain[]> {
  const db = await getDb();
  const rows = await db
    .select({
      mailbox: mailboxes,
      domain: domains,
    })
    .from(mailboxes)
    .innerJoin(domains, eq(mailboxes.domainId, domains.id))
    .orderBy(domains.domain, mailboxes.localPart);

  const unreadByMailbox = new Map<string, number>();
  const threadRows = await db
    .select({ mailboxId: threads.mailboxId, unread: threads.unreadCount })
    .from(threads);
  for (const t of threadRows) {
    unreadByMailbox.set(t.mailboxId, (unreadByMailbox.get(t.mailboxId) ?? 0) + t.unread);
  }

  return rows.map(({ mailbox, domain }) => ({
    id: mailbox.id,
    domainId: domain.id,
    domain: domain.domain,
    localPart: mailbox.localPart,
    address: `${mailbox.localPart}@${domain.domain}`,
    displayName: mailbox.displayName,
    unreadCount: unreadByMailbox.get(mailbox.id) ?? 0,
    resendVerified: domain.resendVerifiedAt !== null,
  }));
}

export async function listThreads(mailboxId: string | 'all'): Promise<ThreadRow[]> {
  const db = await getDb();

  const baseQuery = db
    .select({
      thread: threads,
      mailbox: mailboxes,
      domain: domains,
    })
    .from(threads)
    .innerJoin(mailboxes, eq(threads.mailboxId, mailboxes.id))
    .innerJoin(domains, eq(mailboxes.domainId, domains.id))
    .orderBy(desc(threads.lastMessageAt));

  const rows =
    mailboxId === 'all' ? await baseQuery : await baseQuery.where(eq(threads.mailboxId, mailboxId));

  if (rows.length === 0) return [];

  const messageMeta = await db.query.messages.findMany({
    where: (m, { inArray }) =>
      inArray(
        m.threadId,
        rows.map((r) => r.thread.id),
      ),
    columns: { threadId: true, fromAddress: true, fromName: true, receivedAt: true },
  });

  const latestByThread = new Map<string, (typeof messageMeta)[number]>();
  for (const m of messageMeta) {
    const existing = latestByThread.get(m.threadId);
    if (!existing || (m.receivedAt && existing.receivedAt && m.receivedAt > existing.receivedAt)) {
      latestByThread.set(m.threadId, m);
    }
  }

  return rows.map(({ thread, mailbox, domain }) => {
    const latest = latestByThread.get(thread.id);
    return {
      id: thread.id,
      mailboxId: thread.mailboxId,
      mailboxAddress: `${mailbox.localPart}@${domain.domain}`,
      subject: thread.subject,
      snippet: thread.snippet,
      fromName: latest?.fromName ?? null,
      fromAddress: latest?.fromAddress ?? '',
      lastMessageAt: thread.lastMessageAt.getTime(),
      unreadCount: thread.unreadCount,
    };
  });
}

export type ThreadHeader = {
  id: string;
  mailboxId: string;
  mailboxAddress: string;
  subject: string;
  lastMessageAt: number;
};

export type MessageRow = {
  id: string;
  messageId: string | null;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  text: string | null;
  html: string | null;
  receivedAt: number;
  readAt: number | null;
};

export type ThreadDetail = {
  thread: ThreadHeader;
  messages: MessageRow[];
};

function parseAddresses(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function extractMessageId(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const v = (parsed as Record<string, unknown>)['message-id'];
      return typeof v === 'string' ? v : null;
    }
  } catch {
    return null;
  }
  return null;
}

export async function getThreadDetail(threadId: string): Promise<ThreadDetail | null> {
  const db = await getDb();
  const [row] = await db
    .select({ thread: threads, mailbox: mailboxes, domain: domains })
    .from(threads)
    .innerJoin(mailboxes, eq(threads.mailboxId, mailboxes.id))
    .innerJoin(domains, eq(mailboxes.domainId, domains.id))
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!row) return null;

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.receivedAt));

  return {
    thread: {
      id: row.thread.id,
      mailboxId: row.thread.mailboxId,
      mailboxAddress: `${row.mailbox.localPart}@${row.domain.domain}`,
      subject: row.thread.subject,
      lastMessageAt: row.thread.lastMessageAt.getTime(),
    },
    messages: msgs.map((m) => ({
      id: m.id,
      messageId: extractMessageId(m.headers),
      fromAddress: m.fromAddress,
      fromName: m.fromName,
      toAddresses: parseAddresses(m.toAddresses),
      text: m.text,
      html: m.html,
      receivedAt: m.receivedAt.getTime(),
      readAt: m.readAt?.getTime() ?? null,
    })),
  };
}

export async function markThreadRead(threadId: string): Promise<{ updated: number }> {
  const db = await getDb();
  // Sequential writes — IrisDb is a union of better-sqlite3 (sync transaction
  // callback) and D1 (no interactive transactions), so db.transaction() can't
  // unify. A partial failure leaves messages.read_at set without
  // threads.unread_count being reset; self-heals on the next mark-read.
  const result = await db
    .update(messages)
    .set({ readAt: new Date() })
    .where(and(eq(messages.threadId, threadId), isNull(messages.readAt)))
    .run();
  await db.update(threads).set({ unreadCount: sql`0` }).where(eq(threads.id, threadId)).run();
  // better-sqlite3 puts changes at result.changes; D1 puts it at result.meta.changes.
  const meta = result as { changes?: number; meta?: { changes?: number } };
  return { updated: meta.changes ?? meta.meta?.changes ?? 0 };
}

export type DomainRow = {
  id: string;
  domain: string;
  verifiedAt: number | null;
  resendDomainId: string | null;
  resendVerifiedAt: number | null;
  createdAt: number;
  mailboxCount: number;
};

export async function listDomains(): Promise<DomainRow[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: domains.id,
      domain: domains.domain,
      verifiedAt: domains.verifiedAt,
      resendDomainId: domains.resendDomainId,
      resendVerifiedAt: domains.resendVerifiedAt,
      createdAt: domains.createdAt,
      mailboxCount: count(mailboxes.id),
    })
    .from(domains)
    .leftJoin(mailboxes, eq(mailboxes.domainId, domains.id))
    .groupBy(domains.id)
    .orderBy(asc(domains.domain));
  return rows.map((r) => ({
    id: r.id,
    domain: r.domain,
    verifiedAt: r.verifiedAt?.getTime() ?? null,
    resendDomainId: r.resendDomainId,
    resendVerifiedAt: r.resendVerifiedAt?.getTime() ?? null,
    createdAt: r.createdAt.getTime(),
    mailboxCount: Number(r.mailboxCount ?? 0),
  }));
}

export type DomainResendUpdate = {
  resendDomainId?: string;
  resendVerifiedAt?: Date | null;
};

export async function getDomainById(domainId: string): Promise<DomainRow | null> {
  const db = await getDb();
  const [row] = await db
    .select({
      id: domains.id,
      domain: domains.domain,
      verifiedAt: domains.verifiedAt,
      resendDomainId: domains.resendDomainId,
      resendVerifiedAt: domains.resendVerifiedAt,
      createdAt: domains.createdAt,
      mailboxCount: count(mailboxes.id),
    })
    .from(domains)
    .leftJoin(mailboxes, eq(mailboxes.domainId, domains.id))
    .where(eq(domains.id, domainId))
    .groupBy(domains.id)
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    domain: row.domain,
    verifiedAt: row.verifiedAt?.getTime() ?? null,
    resendDomainId: row.resendDomainId,
    resendVerifiedAt: row.resendVerifiedAt?.getTime() ?? null,
    createdAt: row.createdAt.getTime(),
    mailboxCount: Number(row.mailboxCount ?? 0),
  };
}

export async function setDomainResend(domainId: string, patch: DomainResendUpdate): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.resendDomainId !== undefined) update.resendDomainId = patch.resendDomainId;
  if (patch.resendVerifiedAt !== undefined) update.resendVerifiedAt = patch.resendVerifiedAt;
  if (Object.keys(update).length === 0) return;
  const db = await getDb();
  await db.update(domains).set(update).where(eq(domains.id, domainId)).run();
}

export type AddDomainResult =
  | { ok: true; domainId: string; mailboxId: string }
  | { ok: false; reason: 'invalid' | 'duplicate' };

export async function addDomain(input: string): Promise<AddDomainResult> {
  const normalized = input.trim().toLowerCase();
  // RFC 1035: full domain max 253 chars. Length-gate before regex to bound work.
  if (normalized.length === 0 || normalized.length > 253) return { ok: false, reason: 'invalid' };
  if (!DOMAIN_REGEX.test(normalized)) return { ok: false, reason: 'invalid' };

  const db = await getDb();
  // Sequential writes (see markThreadRead for the union-type rationale). The
  // existence check + insert race is caught by the UNIQUE constraint catch
  // below — both better-sqlite3 and D1 surface the constraint violation in
  // the error message.
  try {
    const existing = await db
      .select({ id: domains.id })
      .from(domains)
      .where(eq(domains.domain, normalized))
      .all();
    if (existing.length > 0) return { ok: false, reason: 'duplicate' };

    const domainId = randomUUID();
    const mailboxId = randomUUID();
    await db
      .insert(domains)
      .values({
        id: domainId,
        domain: normalized,
        verifiedAt: null,
        dkimStatus: 'pending',
      })
      .run();
    await db
      .insert(mailboxes)
      .values({
        id: mailboxId,
        domainId,
        localPart: 'hello',
        displayName: normalized,
      })
      .run();
    return { ok: true, domainId, mailboxId };
  } catch (err) {
    if (isUniqueConstraintError(err)) return { ok: false, reason: 'duplicate' };
    throw err;
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // better-sqlite3: err.code === 'SQLITE_CONSTRAINT_UNIQUE'
  if ('code' in err && (err as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return true;
  }
  // D1: err.message contains 'UNIQUE constraint failed'
  return /UNIQUE constraint failed/i.test(err.message);
}
