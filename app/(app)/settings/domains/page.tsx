import { SettingsPanel } from '@/components/settings-panel';

export default function DomainsSettingsPage() {
  return (
    <SettingsPanel
      title="Domains"
      description="Add a domain you own. Iris will give you the DNS records to paste, then start receiving mail at hello@yourthing.com."
    />
  );
}
