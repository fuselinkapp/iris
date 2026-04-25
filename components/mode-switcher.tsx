'use client';

import { cn } from '@/lib/cn';
import { type Mode, setMode, useMode } from '@/lib/mode-store';
import { useMounted } from '@/lib/use-mounted';

const MODES: ReadonlyArray<{ id: Mode; label: string; sub: string }> = [
  { id: 'focus', label: 'Focus', sub: 'Only what needs you' },
  { id: 'triage', label: 'Triage', sub: 'AI-suggested actions' },
  { id: 'grandma', label: 'Grandma', sub: 'Classic inbox view' },
];

export function ModeSwitcher() {
  const mounted = useMounted();
  const stored = useMode();
  const current = mounted ? stored : 'focus';

  return (
    <div className="flex flex-col gap-1">
      <p className="px-2 pb-1 text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">
        Mode
      </p>
      {MODES.map((m) => {
        const active = m.id === current;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={cn(
              'group flex flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left transition-colors',
              active
                ? 'bg-[var(--surface-elevated)] text-[var(--text)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--surface-elevated)]/60 hover:text-[var(--text)]',
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <span
                className={cn(
                  'size-1.5 rounded-full transition-colors',
                  active ? 'bg-[var(--accent)]' : 'bg-[var(--border-subtle)]',
                )}
                aria-hidden
              />
              {m.label}
            </span>
            <span className="pl-3.5 text-[0.7rem] text-[var(--text-muted)]">{m.sub}</span>
          </button>
        );
      })}
    </div>
  );
}
