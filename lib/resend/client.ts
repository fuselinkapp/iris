import 'server-only';

import { Resend } from 'resend';

let cached: Resend | null | undefined;

// Single Resend client used by both outbound send (lib/email/send.ts) and
// domain management (lib/resend/domains.ts). Returns null when RESEND_API_KEY
// is unset; callers must handle that case (compose runs in dry-run, the
// domain-management actions return a no_api_key result).
export function getResendClient(): Resend | null {
  if (cached !== undefined) return cached;
  const key = process.env.RESEND_API_KEY;
  cached = key ? new Resend(key) : null;
  return cached;
}
