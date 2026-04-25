import { SettingsPanel } from '@/components/settings-panel';

export default function MailboxesSettingsPage() {
  return (
    <SettingsPanel
      title="Mailboxes"
      description="Each domain can have many addresses — hello@, billing@, you@. Manage display names, signatures, and which mailboxes show up in your unified inbox here."
    />
  );
}
