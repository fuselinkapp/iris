'use server';

import {
  type MailboxWithDomain,
  type ThreadRow,
  listMailboxes,
  listThreads,
} from '@/lib/db/queries';

export type GrandmaData = {
  mailboxes: MailboxWithDomain[];
  threads: ThreadRow[];
};

// TODO(auth): once auth lands, gate this on the session cookie and validate
// `mailboxId` against a strict UUID schema before passing it to Drizzle.
export async function getGrandmaData(mailboxId: string | null): Promise<GrandmaData> {
  const [mailboxes, threads] = await Promise.all([
    listMailboxes(),
    listThreads(mailboxId ?? 'all'),
  ]);
  return { mailboxes, threads };
}
