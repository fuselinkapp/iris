import 'server-only';

import { desc, eq } from 'drizzle-orm';

import { domains, mailboxes, threads } from '@/db/schema';

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
