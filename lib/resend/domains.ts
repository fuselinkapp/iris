import 'server-only';

import { getResendClient } from './client';

export type ResendRecord = {
  type: string;
  name: string;
  value: string;
  status?: string;
  ttl?: string | number;
};

export type RegisterResult =
  | { ok: true; resendDomainId: string; records: ResendRecord[] }
  | { ok: false; reason: 'no_api_key' | 'api_error'; detail?: string };

export type StatusResult =
  | {
      ok: true;
      status: string;
      verified: boolean;
      records: ResendRecord[];
    }
  | { ok: false; reason: 'no_api_key' | 'api_error' | 'not_found'; detail?: string };

// Pull DKIM TXT entries out of the records array Resend returns. We
// deliberately drop MX and SPF entries because Cloudflare Email Routing
// already provides those for inbound — installing Resend's MX would break
// inbound mail.
function pickDkimRecords(records: unknown): ResendRecord[] {
  if (!Array.isArray(records)) return [];
  const out: ResendRecord[] = [];
  for (const r of records) {
    if (typeof r !== 'object' || r === null) continue;
    const rec = r as ResendRecord;
    if (
      typeof rec.type === 'string' &&
      rec.type.toUpperCase() === 'TXT' &&
      typeof rec.name === 'string' &&
      rec.name.toLowerCase().includes('_domainkey')
    ) {
      out.push({
        type: rec.type,
        name: rec.name,
        value: rec.value,
        status: rec.status,
        ttl: rec.ttl,
      });
    }
  }
  return out;
}

function describeError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'Unknown Resend error.';
}

export async function registerDomain(name: string): Promise<RegisterResult> {
  const client = getResendClient();
  if (!client) return { ok: false, reason: 'no_api_key' };

  try {
    const created = await client.domains.create({ name });
    if (created.error) {
      // 409 / "already exists" — recover by listing + getting the existing one.
      if (/exists|already/i.test(created.error.message ?? '')) {
        return await recoverExistingDomain(name);
      }
      return { ok: false, reason: 'api_error', detail: created.error.message };
    }
    const data = created.data as { id?: string; records?: unknown } | null;
    if (!data?.id)
      return { ok: false, reason: 'api_error', detail: 'Resend returned no domain ID.' };
    return { ok: true, resendDomainId: data.id, records: pickDkimRecords(data.records) };
  } catch (err) {
    return { ok: false, reason: 'api_error', detail: describeError(err) };
  }
}

async function recoverExistingDomain(name: string): Promise<RegisterResult> {
  const client = getResendClient();
  if (!client) return { ok: false, reason: 'no_api_key' };
  try {
    const list = await client.domains.list();
    const existing = (list.data?.data ?? []).find((d) => d.name === name);
    if (!existing?.id) {
      return { ok: false, reason: 'api_error', detail: 'Domain conflict but not found in list.' };
    }
    const status = await getDomainStatus(existing.id);
    if (!status.ok) {
      // Collapse `not_found` (rare race) into api_error for the register path.
      const reason = status.reason === 'not_found' ? 'api_error' : status.reason;
      return { ok: false, reason, detail: status.detail };
    }
    return { ok: true, resendDomainId: existing.id, records: status.records };
  } catch (err) {
    return { ok: false, reason: 'api_error', detail: describeError(err) };
  }
}

export async function getDomainStatus(resendDomainId: string): Promise<StatusResult> {
  const client = getResendClient();
  if (!client) return { ok: false, reason: 'no_api_key' };

  try {
    const got = await client.domains.get(resendDomainId);
    if (got.error) {
      const message = got.error.message ?? '';
      if (/not.found|404/i.test(message)) return { ok: false, reason: 'not_found' };
      return { ok: false, reason: 'api_error', detail: message };
    }
    const data = got.data as { status?: string; records?: unknown } | null;
    const status = (data?.status ?? 'unknown').toLowerCase();
    return {
      ok: true,
      status,
      verified: status === 'verified',
      records: pickDkimRecords(data?.records),
    };
  } catch (err) {
    return { ok: false, reason: 'api_error', detail: describeError(err) };
  }
}
