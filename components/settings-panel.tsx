import { Card } from '@/components/ui/card';

export function SettingsPanel({ title, description }: { title: string; description: string }) {
  return (
    <Card className="p-8">
      <h1 className="text-xl font-medium tracking-tight">{title}</h1>
      <p className="mt-2 max-w-prose text-sm text-[var(--text-muted)]">{description}</p>
      <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] px-3 py-1 text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">
        <span className="size-1.5 rounded-full bg-[var(--accent)]" aria-hidden />
        Coming soon
      </div>
    </Card>
  );
}
