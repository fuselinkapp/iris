'use server';

import {
  type AddDomainResult,
  addDomain as addDomainQuery,
  getDomainById,
  setDomainResend,
} from '@/lib/db/queries';
import { type ResendRecord, getDomainStatus, registerDomain } from '@/lib/resend/domains';

// TODO(auth): gate on session + harden domain input bounds before phase 1.1.
export async function addDomain(domain: string): Promise<AddDomainResult> {
  return addDomainQuery(domain);
}

export type SetupSendingResult =
  | { ok: true; resendDomainId: string; records: ResendRecord[] }
  | {
      ok: false;
      reason: 'no_api_key' | 'unknown_domain' | 'api_error';
      detail?: string;
    };

// TODO(auth): gate on session + validate domainId UUID before phase 1.1.
export async function setupSendingForDomain(domainId: string): Promise<SetupSendingResult> {
  const local = await getDomainById(domainId);
  if (!local) return { ok: false, reason: 'unknown_domain' };

  // Idempotent: if we already registered this domain at Resend, just refresh
  // the records via getDomainStatus instead of re-creating.
  if (local.resendDomainId) {
    const status = await getDomainStatus(local.resendDomainId);
    if (!status.ok) {
      // SetupSendingResult doesn't carry `not_found`; collapse to api_error.
      const reason = status.reason === 'not_found' ? 'api_error' : status.reason;
      return { ok: false, reason, detail: status.detail };
    }
    if (status.verified && local.resendVerifiedAt === null) {
      await setDomainResend(domainId, { resendVerifiedAt: new Date() });
    }
    return { ok: true, resendDomainId: local.resendDomainId, records: status.records };
  }

  const result = await registerDomain(local.domain);
  if (!result.ok) return { ok: false, reason: result.reason, detail: result.detail };

  await setDomainResend(domainId, { resendDomainId: result.resendDomainId });
  return { ok: true, resendDomainId: result.resendDomainId, records: result.records };
}

export type CheckVerificationResult =
  | { ok: true; verified: boolean; status: string }
  | {
      ok: false;
      reason: 'no_api_key' | 'unknown_domain' | 'not_setup' | 'api_error';
      detail?: string;
    };

// TODO(auth): gate on session + validate domainId UUID before phase 1.1.
export async function checkResendVerification(domainId: string): Promise<CheckVerificationResult> {
  const local = await getDomainById(domainId);
  if (!local) return { ok: false, reason: 'unknown_domain' };
  if (!local.resendDomainId) return { ok: false, reason: 'not_setup' };

  const status = await getDomainStatus(local.resendDomainId);
  if (!status.ok) {
    // CheckVerificationResult uses 'not_setup' for the local-state miss, so
    // `not_found` from the API maps to api_error (the row exists, the API
    // disagrees).
    const reason = status.reason === 'not_found' ? 'api_error' : status.reason;
    return { ok: false, reason, detail: status.detail };
  }

  if (status.verified && local.resendVerifiedAt === null) {
    await setDomainResend(domainId, { resendVerifiedAt: new Date() });
  }
  return { ok: true, verified: status.verified, status: status.status };
}
