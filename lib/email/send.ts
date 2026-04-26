import 'server-only';

import { eq, sql } from 'drizzle-orm';
import { Resend } from 'resend';

import { domains, mailboxes, messages, threads } from '@/db/schema';
import type { IrisDb } from '@/lib/db/types';

const SANDBOX_FROM = 'onboarding@resend.dev';
const randomUUID = () => crypto.randomUUID();

let resendClient: Resend | null = null;
function getResendClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!resendClient) resendClient = new Resend(key);
  return resendClient;
}

export type SendInput = {
  fromMailboxId: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: { threadId: string; messageId: string };
};

export type SendResult =
  | { ok: true; threadId: string; messageId: string; dryRun: boolean }
  | { ok: false; reason: 'invalid_input' | 'unknown_mailbox' | 'send_failed'; detail?: string };

function deriveSnippet(text: string, subject: string): string {
  return (text.trim() || subject).slice(0, 100);
}

export async function sendMessage(input: SendInput, db: IrisDb): Promise<SendResult> {
  const to = input.to.trim().toLowerCase();
  const subject = input.subject.trim();
  const text = input.text.trim();
  if (!to.includes('@') || subject.length === 0 || text.length === 0) {
    return { ok: false, reason: 'invalid_input', detail: 'to / subject / body required' };
  }

  const [sender] = await db
    .select({
      mailboxId: mailboxes.id,
      localPart: mailboxes.localPart,
      domain: domains.domain,
    })
    .from(mailboxes)
    .innerJoin(domains, eq(mailboxes.domainId, domains.id))
    .where(eq(mailboxes.id, input.fromMailboxId))
    .limit(1);
  if (!sender) return { ok: false, reason: 'unknown_mailbox' };

  const senderAddress = `${sender.localPart}@${sender.domain}`;
  const ourMessageId = `<${randomUUID()}@iris.local>`;
  const headerMap: Record<string, string> = { 'message-id': ourMessageId };
  if (input.replyTo) {
    headerMap['in-reply-to'] = input.replyTo.messageId;
    headerMap.references = input.replyTo.messageId;
  }

  const client = getResendClient();
  let dryRun = true;
  let resendId: string | null = null;
  if (client) {
    dryRun = false;
    // TODO: when replyTo is set, the References header should include the
    // parent thread's full ancestry (parent.references + parent.message-id),
    // per RFC 5322 §3.6.4. Today we send only the immediate parent's
    // Message-ID, which Outlook + some mailing-list archives mis-thread for
    // chains of depth ≥ 3. Cheap fix: fetch the parent message's headers
    // when constructing the Resend payload.
    const resp = await client.emails.send({
      from: SANDBOX_FROM,
      to: [to],
      subject,
      text,
      replyTo: senderAddress,
      headers: input.replyTo
        ? {
            'In-Reply-To': input.replyTo.messageId,
            References: input.replyTo.messageId,
          }
        : undefined,
    });
    if (resp.error) {
      return { ok: false, reason: 'send_failed', detail: resp.error.message };
    }
    resendId = resp.data?.id ?? null;
  }

  const now = new Date();
  const snippet = deriveSnippet(text, subject);
  const dbMessageId = randomUUID();
  let threadId: string;

  // Post-send DB writes. If these throw after Resend already accepted the
  // message, we surface a distinct send_failed with detail so the caller
  // knows the recipient got it but our DB doesn't have the record.
  try {
    if (input.replyTo?.threadId) {
      threadId = input.replyTo.threadId;
      await db
        .update(threads)
        .set({
          snippet,
          lastMessageAt: now,
          messageCount: sql`message_count + 1`,
        })
        .where(eq(threads.id, threadId))
        .run();
    } else {
      threadId = randomUUID();
      await db
        .insert(threads)
        .values({
          id: threadId,
          mailboxId: sender.mailboxId,
          subject,
          snippet,
          lastMessageAt: now,
          messageCount: 1,
          unreadCount: 0,
        })
        .run();
    }

    await db
      .insert(messages)
      .values({
        id: dbMessageId,
        threadId,
        fromAddress: senderAddress,
        fromName: null,
        toAddresses: JSON.stringify([to]),
        ccAddresses: JSON.stringify([]),
        bccAddresses: JSON.stringify([]),
        subject,
        html: null,
        text,
        headers: JSON.stringify(headerMap),
        readAt: now,
        receivedAt: now,
      })
      .run();
  } catch (err) {
    if (resendId) {
      console.error('[iris/send] post-send DB write failed; recipient got the message', {
        resendId,
        ourMessageId,
        err,
      });
      return {
        ok: false,
        reason: 'send_failed',
        detail: `sent (resend id ${resendId}) but not recorded in DB`,
      };
    }
    throw err;
  }

  return { ok: true, threadId, messageId: dbMessageId, dryRun };
}
