'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/cn';

const TABS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/settings/ai', label: 'AI' },
  { href: '/settings/modes', label: 'Modes' },
  { href: '/settings/domains', label: 'Domains' },
  { href: '/settings/mailboxes', label: 'Mailboxes' },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              'rounded-xl px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-[var(--surface-elevated)] text-[var(--text)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--surface-elevated)]/60 hover:text-[var(--text)]',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
