'use server';

import { type AddDomainResult, addDomain as addDomainQuery } from '@/lib/db/queries';

// TODO(auth): gate on session + harden domain input bounds before phase 1.
export async function addDomain(domain: string): Promise<AddDomainResult> {
  return addDomainQuery(domain);
}
