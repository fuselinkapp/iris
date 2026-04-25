'use client';

import { Plus, Settings } from 'lucide-react';
import Link from 'next/link';

import { ModeSwitcher } from '@/components/mode-switcher';
import { ThemeToggle } from '@/components/theme-toggle';

export function Sidebar() {
  return (
    <aside className="flex h-dvh flex-col gap-6 border-r border-[var(--border-subtle)] px-3 py-5">
      <Link href="/" className="px-2 text-base font-semibold tracking-tight">
        iris
      </Link>

      <ModeSwitcher />

      <div className="flex flex-col gap-1">
        <p className="px-2 pb-1 text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">
          Mailboxes
        </p>
        <Link
          href="/settings/domains?add=1"
          className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text)]"
        >
          <Plus className="size-4" />
          Add domain
        </Link>
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
        <Link
          href="/settings"
          className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text)]"
        >
          <Settings className="size-4" />
          Settings
        </Link>
        <ThemeToggle />
      </div>
    </aside>
  );
}
