'use server';

import { getDb } from '@/lib/db/client';
import { type SendInput, type SendResult, sendMessage } from '@/lib/email/send';

// TODO(auth): gate on session + validate mailboxId / threadId / messageId UUIDs
// before phase 1 ships beyond a single user.
export async function sendAction(input: SendInput): Promise<SendResult> {
  return sendMessage(input, getDb());
}
