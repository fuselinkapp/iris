'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';

import { type GrandmaData, getGrandmaData } from '@/app/actions/grandma';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format-relative';

export function GrandmaView() {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get('mailbox');
  const [data, setData] = useState<GrandmaData | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getGrandmaData(selected).then((next) => {
      if (!cancelled) setData(next);
    });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const grouped = useMemo(() => {
    if (!data) return [];
    const byDomain = new Map<string, GrandmaData['mailboxes']>();
    for (const m of data.mailboxes) {
      const list = byDomain.get(m.domain) ?? [];
      list.push(m);
      byDomain.set(m.domain, list);
    }
    return [...byDomain.entries()].map(([domain, mailboxes]) => ({ domain, mailboxes }));
  }, [data]);

  function selectMailbox(id: string | null) {
    startTransition(() => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set('mailbox', id);
      else next.delete('mailbox');
      const qs = next.toString();
      router.replace(qs ? `/?${qs}` : '/', { scroll: false });
    });
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
        Loading…
      </div>
    );
  }

  if (data.mailboxes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[var(--text-muted)]">
        No mailboxes yet. Run <code className="mx-1">pnpm db:seed</code> to populate fake data.
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-[260px_1fr]">
      <nav className="flex flex-col gap-3 overflow-y-auto border-r border-[var(--border-subtle)] px-3 py-5">
        <MailboxButton
          label="All inboxes"
          subtitle={`${data.threads.length} thread${data.threads.length === 1 ? '' : 's'}`}
          unread={data.mailboxes.reduce((acc, m) => acc + m.unreadCount, 0)}
          active={selected === null}
          onClick={() => selectMailbox(null)}
        />
        {grouped.map(({ domain, mailboxes }) => (
          <div key={domain} className="flex flex-col gap-1">
            <p className="px-2 pb-1 text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">
              {domain}
            </p>
            {mailboxes.map((m) => (
              <MailboxButton
                key={m.id}
                label={m.localPart}
                subtitle={m.address}
                unread={m.unreadCount}
                active={selected === m.id}
                onClick={() => selectMailbox(m.id)}
              />
            ))}
          </div>
        ))}
      </nav>

      <ol className="overflow-y-auto">
        {data.threads.length === 0 ? (
          <li className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
            No threads in this mailbox yet.
          </li>
        ) : (
          data.threads.map((t) => (
            <li
              key={t.id}
              className="group flex cursor-default items-baseline gap-4 border-b border-[var(--border-subtle)] px-6 py-3.5 transition-colors hover:bg-[var(--surface-elevated)]"
            >
              <div className="w-44 shrink-0 truncate text-sm">
                <span
                  className={cn(t.unreadCount > 0 ? 'font-medium' : 'text-[var(--text-muted)]')}
                >
                  {t.fromName ?? t.fromAddress}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    'truncate text-sm',
                    t.unreadCount > 0 ? 'font-medium' : 'text-[var(--text-muted)]',
                  )}
                >
                  {t.subject}
                </p>
                <p className="truncate text-xs text-[var(--text-muted)]">{t.snippet}</p>
              </div>
              <div className="w-16 shrink-0 text-right text-xs text-[var(--text-muted)]">
                {formatRelative(t.lastMessageAt)}
              </div>
            </li>
          ))
        )}
      </ol>
    </div>
  );
}

function MailboxButton({
  label,
  subtitle,
  unread,
  active,
  onClick,
}: {
  label: string;
  subtitle: string;
  unread: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-left transition-colors',
        active
          ? 'bg-[var(--surface-elevated)] text-[var(--text)]'
          : 'text-[var(--text-muted)] hover:bg-[var(--surface-elevated)]/60 hover:text-[var(--text)]',
      )}
    >
      <span className="min-w-0 flex flex-col">
        <span className="truncate text-sm font-medium">{label}</span>
        <span className="truncate text-[0.7rem] text-[var(--text-muted)]">{subtitle}</span>
      </span>
      {unread > 0 && (
        <span className="rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[0.65rem] font-medium text-[var(--accent-fg)]">
          {unread}
        </span>
      )}
    </button>
  );
}
