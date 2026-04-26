import { DomainsList } from '@/components/domains-list';
import { listDomains } from '@/lib/db/queries';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export default async function DomainsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ add?: string }>;
}) {
  const [domains, params] = await Promise.all([listDomains(), searchParams]);
  return <DomainsList initialDomains={domains} autoOpenForm={params.add === '1'} />;
}
