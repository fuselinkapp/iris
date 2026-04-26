'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type { SendableMailbox } from '@/app/actions/grandma';
import { sendAction } from '@/app/actions/send';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const ERROR_COPY: Record<string, string> = {
  invalid_input: 'To, subject, and body all need a value.',
  unknown_mailbox: 'That mailbox no longer exists.',
  send_failed: 'Resend rejected the message.',
};

type ComposeFormProps = {
  mailboxes: SendableMailbox[];
  defaultMailboxId?: string;
  lockedMailboxId?: string;
  defaultTo?: string;
  defaultSubject?: string;
  replyTo?: { threadId: string; messageId: string };
  showSandboxNotice: boolean;
  hasResendKey: boolean;
  onSent?: (result: { threadId: string; messageId: string }) => void;
  onCancel?: () => void;
};

export function ComposeForm({
  mailboxes,
  defaultMailboxId,
  lockedMailboxId,
  defaultTo,
  defaultSubject,
  replyTo,
  showSandboxNotice,
  hasResendKey,
  onSent,
  onCancel,
}: ComposeFormProps) {
  const router = useRouter();
  const initialFromId = lockedMailboxId ?? defaultMailboxId ?? mailboxes[0]?.id ?? '';
  const [fromId, setFromId] = useState(initialFromId);
  const [to, setTo] = useState(defaultTo ?? '');
  const [subject, setSubject] = useState(defaultSubject ?? '');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const lockedMailbox = lockedMailboxId
    ? mailboxes.find((m) => m.id === lockedMailboxId)
    : undefined;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!fromId || !to.trim() || !subject.trim() || !text.trim()) {
      setError(ERROR_COPY.invalid_input);
      return;
    }
    startTransition(async () => {
      const result = await sendAction({
        fromMailboxId: fromId,
        to: to.trim(),
        subject: subject.trim(),
        text,
        replyTo,
      });
      if (!result.ok) {
        setError(result.detail ?? ERROR_COPY[result.reason] ?? 'Send failed.');
        return;
      }
      setText('');
      if (onSent) {
        onSent({ threadId: result.threadId, messageId: result.messageId });
      } else {
        router.push(`/?mailbox=${fromId}&thread=${result.threadId}`);
      }
    });
  }

  // Sandbox notice only when the active From mailbox can't send for real —
  // i.e., its domain isn't verified at Resend yet. Verified mailboxes hide
  // the notice entirely; the send goes from the real address.
  const activeMailbox = mailboxes.find((m) => m.id === fromId);
  const sandboxActive = !(activeMailbox?.resendVerified ?? false);

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {showSandboxNotice && sandboxActive && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]/60 px-3 py-2 text-xs text-[var(--text-muted)]">
          {hasResendKey ? (
            <>
              <strong className="text-[var(--text)]">Sandbox mode.</strong> Recipients see{' '}
              <code>onboarding@resend.dev</code> as From. Set up sending for this domain in{' '}
              <a href="/settings/domains" className="underline">
                Settings → Domains
              </a>{' '}
              to send from the real address.
            </>
          ) : (
            <>
              <strong className="text-[var(--text)]">Dry-run.</strong> No{' '}
              <code>RESEND_API_KEY</code> set — DB write happens, no actual send.
            </>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
        <label htmlFor="compose-from">From</label>
        {lockedMailbox ? (
          <span
            id="compose-from"
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
          >
            {lockedMailbox.address}
          </span>
        ) : (
          <select
            id="compose-from"
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
            disabled={pending}
            className="h-10 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {mailboxes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.address}
              </option>
            ))}
          </select>
        )}
      </div>

      <Input
        name="to"
        placeholder="To"
        autoComplete="off"
        spellCheck={false}
        value={to}
        onChange={(e) => setTo(e.target.value)}
        disabled={pending}
      />
      <Input
        name="subject"
        placeholder="Subject"
        autoComplete="off"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        disabled={pending}
      />
      <textarea
        name="body"
        placeholder="Write something kind."
        rows={replyTo ? 6 : 10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={pending}
        className="w-full resize-y rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      />

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center justify-end gap-2 pt-1">
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </form>
  );
}
