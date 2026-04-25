import { SettingsPanel } from '@/components/settings-panel';

export default function AISettingsPage() {
  return (
    <SettingsPanel
      title="AI"
      description="Bring your own API key. Iris will use it to predraft replies, suggest actions, and surface what actually needs you. Nothing leaves your machine without it."
    />
  );
}
