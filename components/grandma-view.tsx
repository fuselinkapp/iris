'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';

import { type GrandmaData, getGrandmaData } from '@/app/actions/grandma';
import { ReaderPane } from '@/components/reader-pane';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format-relative';

export function GrandmaView() {
  const router = useRouter();
  const params = useSearchParams();
  const selectedMailbox = params.get('mailbox');
  const selectedThread = params.get('thread');
  const [data, setData] = useState<GrandmaData | null>(null);
  const [, startTransition] = useTransition();

  const refetch = useCallback(async () => {
    const next = await getGrandmaData(selectedMailbox);
    setData(next);
  }, [selectedMailbox]);

  useEffect(() => {
    let cancelled = false;
    getGrandmaData(selectedMailbox).then((next) => {
      if (!cancelled) setData(next);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedMailbox]);

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

  const updateQuery = useCallback(
    (next: URLSearchParams) => {
      startTransition(() => {
        const qs = next.toString();
        router.replace(qs ? `/?${qs}` : '/', { scroll: false });
      });
    },
    [router],
  );

  function selectMailbox(id: string | null) {
    const next = new URLSearchParams(params.toString());
    if (id) next.set('mailbox', id);
    else next.delete('mailbox');
    next.delete('thread');
    updateQuery(next);
  }

  function selectThread(id: string | null) {
    if (id === selectedThread) return;
    const next = new URLSearchParams(params.toString());
    if (id) next.set('thread', id);
    else next.delete('thread');
    updateQuery(next);
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

  const selectedThreadRow = selectedThread
    ? (data.threads.find((t) => t.id === selectedThread) ?? null)
    : null;
  const hasUnread = (selectedThreadRow?.unreadCount ?? 0) > 0;

  return (
    <div className="grid h-full grid-cols-[260px_360px_1fr]">
      <nav className="flex flex-col gap-3 overflow-y-auto border-r border-[var(--border-subtle)] px-3 py-5">
        <MailboxButton
          label="All inboxes"
          subtitle={`${data.threads.length} thread${data.threads.length === 1 ? '' : 's'}`}
          unread={data.mailboxes.reduce((acc, m) => acc + m.unreadCount, 0)}
          active={selectedMailbox === null}
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
                active={selectedMailbox === m.id}
                onClick={() => selectMailbox(m.id)}
              />
            ))}
          </div>
        ))}
      </nav>

      <ol className="overflow-y-auto border-r border-[var(--border-subtle)]">
        {data.threads.length === 0 ? (
          <li className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
            No threads in this mailbox yet.
          </li>
        ) : (
          data.threads.map((t) => {
            const isActive = t.id === selectedThread;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => selectThread(t.id)}
                  className={cn(
                    'flex w-full items-baseline gap-4 border-b border-[var(--border-subtle)] px-5 py-3.5 text-left transition-colors',
                    isActive
                      ? 'bg-[var(--surface-elevated)]'
                      : 'hover:bg-[var(--surface-elevated)]/60',
                  )}
                >
                  <div className="w-32 shrink-0 truncate text-sm">
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
                  <div className="w-12 shrink-0 text-right text-xs text-[var(--text-muted)]">
                    {formatRelative(t.lastMessageAt)}
                  </div>
                </button>
              </li>
            );
          })
        )}
      </ol>

      <ReaderPane
        threadId={selectedThread}
        hasUnread={hasUnread}
        onClose={() => selectThread(null)}
        onMarkedRead={refetch}
      />
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
