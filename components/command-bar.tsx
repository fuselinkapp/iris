import { Search } from 'lucide-react';

export function CommandBar() {
  return (
    <div className="relative w-full max-w-xl">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]" />
      <input
        type="text"
        disabled
        placeholder="Search coming soon"
        className="h-12 w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] pl-10 pr-14 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed"
        style={{ boxShadow: 'var(--shadow)' }}
      />
      <kbd className="absolute right-3 top-1/2 -translate-y-1/2">/</kbd>
    </div>
  );
}
