'use client';

import { ChevronDown, Plus, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { addDomain, checkResendVerification, setupSendingForDomain } from '@/app/actions/domains';
import { DnsRecordsPanel } from '@/components/dns-records-panel';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import type { DomainRow } from '@/lib/db/queries';
import type { ResendRecord } from '@/lib/resend/domains';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(epochMs: number): string {
  const d = new Date(epochMs);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const ADD_ERROR_COPY: Record<'invalid' | 'duplicate', string> = {
  invalid: "That doesn't look like a domain. Try something like notebook.fyi.",
  duplicate: 'That domain is already added.',
};

const SETUP_ERROR_COPY: Record<string, string> = {
  no_api_key: 'Set RESEND_API_KEY to enable real outbound (currently sandbox-only).',
  unknown_domain: "That domain isn't in Iris anymore.",
  api_error: 'Resend rejected the request.',
  not_setup: 'Click Set up sending first.',
};

type SendingState = 'not_setup' | 'pending' | 'ready';

function sendingStateOf(d: DomainRow): SendingState {
  if (d.resendVerifiedAt !== null) return 'ready';
  if (d.resendDomainId !== null) return 'pending';
  return 'not_setup';
}

export function DomainsList({
  initialDomains,
  autoOpenForm,
}: {
  initialDomains: DomainRow[];
  autoOpenForm: boolean;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(autoOpenForm);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resendRecordsByDomain, setResendRecordsByDomain] = useState<
    Record<string, ResendRecord[]>
  >({});
  const [domainErrors, setDomainErrors] = useState<Record<string, string>>({});
  const [domainPending, setDomainPending] = useState<Record<string, boolean>>({});

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = value.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await addDomain(trimmed);
      if (result.ok) {
        setValue('');
        setShowForm(false);
        setExpanded(result.domainId);
        router.refresh();
      } else {
        setError(ADD_ERROR_COPY[result.reason]);
      }
    });
  }

  function handleSetup(domainId: string) {
    setDomainErrors((prev) => ({ ...prev, [domainId]: '' }));
    setDomainPending((prev) => ({ ...prev, [domainId]: true }));
    void setupSendingForDomain(domainId).then((result) => {
      setDomainPending((prev) => ({ ...prev, [domainId]: false }));
      if (result.ok) {
        setResendRecordsByDomain((prev) => ({ ...prev, [domainId]: result.records }));
        setExpanded(domainId);
        router.refresh();
      } else {
        setDomainErrors((prev) => ({
          ...prev,
          [domainId]: result.detail ?? SETUP_ERROR_COPY[result.reason] ?? 'Something went wrong.',
        }));
      }
    });
  }

  function handleCheck(domainId: string) {
    setDomainErrors((prev) => ({ ...prev, [domainId]: '' }));
    setDomainPending((prev) => ({ ...prev, [domainId]: true }));
    void checkResendVerification(domainId).then((result) => {
      setDomainPending((prev) => ({ ...prev, [domainId]: false }));
      if (!result.ok) {
        setDomainErrors((prev) => ({
          ...prev,
          [domainId]: result.detail ?? SETUP_ERROR_COPY[result.reason] ?? 'Check failed.',
        }));
        return;
      }
      if (result.verified) {
        router.refresh();
      } else {
        setDomainErrors((prev) => ({
          ...prev,
          [domainId]: `Resend says: ${result.status}. Records may still be propagating.`,
        }));
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium tracking-tight">Domains</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            One inbox per domain. Add the domains you own and Iris will route their mail here.
          </p>
        </div>
        {!showForm && (
          <Button variant="primary" size="sm" onClick={() => setShowForm(true)}>
            <Plus className="size-4" /> Add domain
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="p-5">
          <form onSubmit={submit} className="flex flex-col gap-3">
            <label htmlFor="domain-input" className="text-sm font-medium">
              Domain
            </label>
            <Input
              id="domain-input"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="notebook.fyi"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              disabled={pending}
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowForm(false);
                  setValue('');
                  setError(null);
                }}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={pending || !value.trim()}>
                {pending ? 'Adding…' : 'Add'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {initialDomains.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-[var(--text-muted)]">
            No domains yet. Add your first to start receiving mail at hello@yourthing.com.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {initialDomains.map((d) => {
            const isOpen = expanded === d.id;
            const sending = sendingStateOf(d);
            const records = resendRecordsByDomain[d.id];
            const rowError = domainErrors[d.id];
            const rowPending = domainPending[d.id] ?? false;
            return (
              <li key={d.id}>
                <Card className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium">{d.domain}</span>
                        <ReceivingPill verified={d.verifiedAt !== null} />
                        <SendingPill state={sending} />
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        Added {formatDate(d.createdAt)} · {d.mailboxCount} mailbox
                        {d.mailboxCount === 1 ? '' : 'es'}
                      </p>
                      {rowError && <p className="mt-1.5 text-xs text-red-400">{rowError}</p>}
                    </div>

                    <div className="flex items-center gap-2">
                      {sending === 'not_setup' && (
                        <Button
                          variant="soft"
                          size="sm"
                          onClick={() => handleSetup(d.id)}
                          disabled={rowPending}
                        >
                          <Send className="size-3.5" />
                          {rowPending ? 'Setting up…' : 'Set up sending'}
                        </Button>
                      )}
                      {sending === 'pending' && (
                        <Button
                          variant="soft"
                          size="sm"
                          onClick={() => handleCheck(d.id)}
                          disabled={rowPending}
                        >
                          {rowPending ? 'Checking…' : 'Check verification'}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpanded(isOpen ? null : d.id)}
                        aria-expanded={isOpen}
                      >
                        <ChevronDown
                          className={cn('size-4 transition-transform', isOpen && 'rotate-180')}
                        />
                        {isOpen ? 'Hide DNS' : 'Show DNS'}
                      </Button>
                    </div>
                  </div>
                  {isOpen && <DnsRecordsPanel resendRecords={records} />}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ReceivingPill({ verified }: { verified: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider',
        verified
          ? 'border-[var(--accent)] text-[var(--accent)]'
          : 'border-[var(--border-subtle)] text-[var(--text-muted)]',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          verified ? 'bg-[var(--accent)]' : 'bg-[var(--text-muted)]',
        )}
        aria-hidden
      />
      {verified ? 'Receiving' : 'Receiving · pending'}
    </span>
  );
}

const SENDING_LABEL: Record<SendingState, string> = {
  not_setup: 'Sending · not set up',
  pending: 'Sending · pending',
  ready: 'Sending · ready',
};

function SendingPill({ state }: { state: SendingState }) {
  const ready = state === 'ready';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider',
        ready
          ? 'border-[var(--accent)] text-[var(--accent)]'
          : 'border-[var(--border-subtle)] text-[var(--text-muted)]',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          ready ? 'bg-[var(--accent)]' : 'bg-[var(--text-muted)]',
        )}
        aria-hidden
      />
      {SENDING_LABEL[state]}
    </span>
  );
}
