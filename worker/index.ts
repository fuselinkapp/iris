/// <reference types="@cloudflare/workers-types" />

import { dbFromD1, handleEmail } from './handler';

export interface Env {
  IRIS_DB: D1Database;
  // Declared so the next phase can write raw .eml here without a config bump.
  IRIS_RAW: R2Bucket;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
    const raw = await new Response(message.raw).text();
    const db = dbFromD1(env.IRIS_DB);

    let result: Awaited<ReturnType<typeof handleEmail>>;
    try {
      result = await handleEmail(raw, db);
    } catch (err) {
      console.error('[iris worker] handler threw:', err);
      message.setReject('ingest_handler_error');
      return;
    }

    if (!result.ok) {
      console.error('[iris worker] ingest rejected:', result);
      message.setReject(`ingest_${result.reason}`);
      return;
    }

    console.log('[iris worker] landed', {
      threadId: result.threadId,
      messageId: result.messageId,
      mailboxId: result.mailboxId,
      verifiedDomain: result.verifiedDomain,
    });
  },
};
