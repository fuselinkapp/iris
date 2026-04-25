import type { ReactNode } from 'react';

import { SettingsNav } from '@/components/settings-nav';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid h-full w-full max-w-5xl grid-cols-[180px_1fr] gap-10 px-8 py-12">
      <div className="flex flex-col gap-4">
        <p className="px-3 text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">
          Settings
        </p>
        <SettingsNav />
      </div>
      <div>{children}</div>
    </div>
  );
}
