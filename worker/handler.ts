/// <reference types="@cloudflare/workers-types" />

import { drizzle } from 'drizzle-orm/d1';
import PostalMime, { type Address } from 'postal-mime';

import * as schema from '@/db/schema';
import type { IrisDb } from '@/lib/db/types';
import { type IngestPayload, type IngestResult, ingestMessage } from '@/lib/email/ingest';

// postal-mime's Address can be either a single mailbox `{ name, address }` or
// a group `{ name, group: [...] }`. We flatten both shapes into a flat list
// of address strings, dropping anything without a parseable address.
function flattenAddresses(arr: Address[] | null | undefined): string[] {
  const out: string[] = [];
  for (const item of arr ?? []) {
    if (item.address) {
      out.push(item.address);
    } else if (item.group) {
      for (const member of item.group) {
        if (member.address) out.push(member.address);
      }
    }
  }
  return out;
}

function firstAddress(
  arr: Address[] | null | undefined,
): { name?: string; address: string } | undefined {
  for (const item of arr ?? []) {
    if (item.address) return { address: item.address, name: item.name || undefined };
    if (item.group) {
      for (const member of item.group) {
        if (member.address) return { address: member.address, name: member.name || undefined };
      }
    }
  }
  return undefined;
}

function toReferences(refs: unknown): string[] {
  if (typeof refs === 'string') return refs.split(/\s+/).filter(Boolean);
  if (Array.isArray(refs)) return refs.filter((v): v is string => typeof v === 'string');
  return [];
}

export async function handleEmail(rawEml: string, db: IrisDb): Promise<IngestResult> {
  const parsed = await PostalMime.parse(rawEml);

  const headers: Record<string, string> = {};
  for (const h of parsed.headers ?? []) {
    if (typeof h.key === 'string' && typeof h.value === 'string') {
      headers[h.key.toLowerCase()] = h.value;
    }
  }

  const from = parsed.from
    ? parsed.from.address
      ? { address: parsed.from.address, name: parsed.from.name || undefined }
      : firstAddress([parsed.from])
    : undefined;

  const payload: IngestPayload = {
    from,
    to: flattenAddresses(parsed.to),
    cc: flattenAddresses(parsed.cc),
    bcc: flattenAddresses(parsed.bcc),
    subject: parsed.subject ?? '',
    text: parsed.text ?? undefined,
    html: parsed.html ?? undefined,
    headers,
    inReplyTo: parsed.inReplyTo ?? undefined,
    references: toReferences(parsed.references),
    receivedAt: parsed.date ? new Date(parsed.date).getTime() : Date.now(),
  };

  return ingestMessage(payload, db);
}

// The D1 client is structurally compatible with the (sync) better-sqlite3
// surface for the operations ingest code uses; at runtime everything is
// `await`ed. See lib/db/types.ts for the full reasoning.
export function dbFromD1(d1: D1Database): IrisDb {
  return drizzle(d1, { schema }) as unknown as IrisDb;
}
