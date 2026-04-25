'use client';

import { CommandBar } from '@/components/command-bar';
import { type Mode, useMode } from '@/lib/mode-store';
import { useMounted } from '@/lib/use-mounted';

const COPY: Record<Mode, { title: string; sub: string }> = {
  focus: {
    title: 'Nothing needs you right now.',
    sub: "You're caught up. Iris will surface things here when they matter.",
  },
  triage: {
    title: 'Inbox zero, inbox calm.',
    sub: 'When mail arrives, Iris will queue suggested actions here.',
  },
  grandma: {
    title: 'No mailboxes connected yet.',
    sub: 'Add a domain to see your mail the classic way.',
  },
};

export function TodayView() {
  const mounted = useMounted();
  const mode = useMode();
  const { title, sub } = COPY[mounted ? mode : 'focus'];

  return (
    <section className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center gap-8 px-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-[0.7rem] uppercase tracking-[0.2em] text-[var(--text-muted)]">Today</p>
        <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
        <p className="max-w-md text-sm text-[var(--text-muted)]">{sub}</p>
      </div>

      <CommandBar />

      <p className="text-[0.7rem] text-[var(--text-muted)]">
        <kbd>c</kbd> compose &nbsp;·&nbsp; <kbd>?</kbd> shortcuts
      </p>
    </section>
  );
}
