'use server';

import {
  type MailboxWithDomain,
  type ThreadDetail,
  type ThreadRow,
  getThreadDetail,
  listMailboxes,
  listThreads,
  markThreadRead as markThreadReadQuery,
} from '@/lib/db/queries';

export type GrandmaData = {
  mailboxes: MailboxWithDomain[];
  threads: ThreadRow[];
  hasResendKey: boolean;
};

// TODO(auth): once auth lands, gate this on the session cookie and validate
// `mailboxId` against a strict UUID schema before passing it to Drizzle.
export async function getGrandmaData(mailboxId: string | null): Promise<GrandmaData> {
  const [mailboxes, threads] = await Promise.all([
    listMailboxes(),
    listThreads(mailboxId ?? 'all'),
  ]);
  return { mailboxes, threads, hasResendKey: Boolean(process.env.RESEND_API_KEY) };
}

// TODO(auth): gate on session + validate threadId as UUID before phase 1.
export async function getThread(threadId: string): Promise<ThreadDetail | null> {
  return getThreadDetail(threadId);
}

// TODO(auth): gate on session + validate threadId as UUID before phase 1.
export async function markThreadRead(threadId: string): Promise<{ updated: number }> {
  return markThreadReadQuery(threadId);
}

export type SendableMailbox = { id: string; address: string };

// Lightweight mailbox list for the compose dropdown — strips the unread-count
// join `getGrandmaData` does. The compose page doesn't need it.
export async function getMailboxesForSend(): Promise<SendableMailbox[]> {
  const all = await listMailboxes();
  return all.map((m) => ({ id: m.id, address: m.address }));
}
