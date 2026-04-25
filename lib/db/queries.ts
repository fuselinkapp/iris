import 'server-only';

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import { domains, mailboxes, messages, threads } from '@/db/schema';

import { getDb } from './client';

export type MailboxWithDomain = {
  id: string;
  domainId: string;
  domain: string;
  localPart: string;
  address: string;
  displayName: string | null;
  unreadCount: number;
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
  const db = getDb();
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
  }));
}

export async function listThreads(mailboxId: string | 'all'): Promise<ThreadRow[]> {
  const db = getDb();

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
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  text: string | null;
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

export async function getThreadDetail(threadId: string): Promise<ThreadDetail | null> {
  const db = getDb();
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
      fromAddress: m.fromAddress,
      fromName: m.fromName,
      toAddresses: parseAddresses(m.toAddresses),
      text: m.text,
      receivedAt: m.receivedAt.getTime(),
      readAt: m.readAt?.getTime() ?? null,
    })),
  };
}

export async function markThreadRead(threadId: string): Promise<{ updated: number }> {
  const db = getDb();
  return db.transaction((tx) => {
    const result = tx
      .update(messages)
      .set({ readAt: new Date() })
      .where(and(eq(messages.threadId, threadId), isNull(messages.readAt)))
      .run();
    tx.update(threads).set({ unreadCount: sql`0` }).where(eq(threads.id, threadId)).run();
    return { updated: result.changes ?? 0 };
  });
}
