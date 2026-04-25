'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { getThread, markThreadRead } from '@/app/actions/grandma';
import { Button } from '@/components/ui/button';
import type { ThreadDetail } from '@/lib/db/queries';
import { formatDateTime } from '@/lib/format-datetime';

type Status = 'idle' | 'loading' | 'loaded' | 'missing';

export function ReaderPane({
  threadId,
  hasUnread,
  onClose,
  onMarkedRead,
}: {
  threadId: string | null;
  hasUnread: boolean;
  onClose: () => void;
  onMarkedRead: () => void;
}) {
  const [data, setData] = useState<ThreadDetail | null>(null);
  const [status, setStatus] = useState<Status>('idle');

  // Snapshot the unread flag and the callback at render time so the effect
  // depends only on `threadId`. Re-running on `hasUnread` flipping to false
  // (after refetch) would otherwise re-fetch the thread on every mark-read.
  const hasUnreadRef = useRef(hasUnread);
  const onMarkedReadRef = useRef(onMarkedRead);
  hasUnreadRef.current = hasUnread;
  onMarkedReadRef.current = onMarkedRead;

  // Track which thread IDs we've already attempted to mark, so React 18's
  // strict-mode double-invoke and any incidental re-runs don't double-fire.
  const markedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!threadId) {
      setData(null);
      setStatus('idle');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    getThread(threadId).then(async (next) => {
      if (cancelled) return;
      if (!next) {
        setData(null);
        setStatus('missing');
        return;
      }
      setData(next);
      setStatus('loaded');
      if (hasUnreadRef.current && !markedRef.current.has(threadId)) {
        markedRef.current.add(threadId);
        const result = await markThreadRead(threadId);
        if (!cancelled && result.updated > 0) onMarkedReadRef.current();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  if (!threadId || status === 'idle') {
    return <EmptyState />;
  }

  if (status === 'loading' && !data) {
    return <CenteredText>Loading…</CenteredText>;
  }

  if (status === 'missing') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-[var(--text-muted)]">Thread not found.</p>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  if (!data) return <EmptyState />;

  const firstMessage = data.messages[0];

  return (
    <article className="flex h-full flex-col overflow-hidden">
      <header className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-8 py-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-medium tracking-tight">{data.thread.subject}</h1>
          {firstMessage && (
            <div className="mt-2 flex flex-col gap-0.5 text-xs text-[var(--text-muted)]">
              <span>
                <span className="text-[var(--text)]">
                  {firstMessage.fromName ?? firstMessage.fromAddress}
                </span>
                {firstMessage.fromName && (
                  <span className="ml-1.5">&lt;{firstMessage.fromAddress}&gt;</span>
                )}
              </span>
              <span>to {firstMessage.toAddresses.join(', ') || data.thread.mailboxAddress}</span>
              <span>{formatDateTime(firstMessage.receivedAt)}</span>
            </div>
          )}
        </div>
        <Button variant="ghost" size="icon" aria-label="Close reader" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {data.messages.map((m, i) => (
          <div
            key={m.id}
            className={i > 0 ? 'mt-8 border-t border-[var(--border-subtle)] pt-6' : ''}
          >
            {i > 0 && (
              <div className="mb-3 flex items-baseline gap-2 text-xs text-[var(--text-muted)]">
                <span className="text-[var(--text)]">{m.fromName ?? m.fromAddress}</span>
                <span>·</span>
                <span>{formatDateTime(m.receivedAt)}</span>
              </div>
            )}
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[var(--text)]">
              {m.text ?? '(no text body)'}
            </pre>
          </div>
        ))}
      </div>
    </article>
  );
}

function EmptyState() {
  return <CenteredText>Pick a thread to read.</CenteredText>;
}

function CenteredText({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
      {children}
    </div>
  );
}
