'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { CLOUDFLARE_EMAIL_ROUTING_RECORDS } from '@/lib/email/cloudflare-records';
import type { ResendRecord } from '@/lib/resend/domains';

type DisplayRecord = {
  type: string;
  host: string;
  value: string;
  priority?: number;
};

const cloudflareDisplay: DisplayRecord[] = CLOUDFLARE_EMAIL_ROUTING_RECORDS.map((r) => ({
  type: r.type,
  host: r.host,
  value: r.value,
  priority: r.priority,
}));

function resendToDisplay(records: ResendRecord[]): DisplayRecord[] {
  return records.map((r) => ({ type: r.type, host: r.name, value: r.value }));
}

export function DnsRecordsPanel({ resendRecords }: { resendRecords?: ResendRecord[] }) {
  const sendRecords =
    resendRecords && resendRecords.length > 0 ? resendToDisplay(resendRecords) : [];

  return (
    <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]/50 p-5">
      <Section
        title="For receiving"
        intro="Paste these into the DNS tab of your registrar (or Cloudflare DNS, if your domain is on Cloudflare). Records can take up to 24 hours to propagate."
        records={cloudflareDisplay}
      />

      {sendRecords.length > 0 && (
        <div className="mt-6 border-t border-[var(--border-subtle)] pt-5">
          <Section
            title="For sending"
            intro="Adds a DKIM signature so recipients know mail from this domain is really from you. Paste alongside the receiving records."
            records={sendRecords}
          />
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  intro,
  records,
}: {
  title: string;
  intro: string;
  records: DisplayRecord[];
}) {
  return (
    <>
      <div className="flex items-baseline gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{intro}</p>

      <div className="mt-4 grid grid-cols-[60px_minmax(60px,1fr)_2fr_auto] items-center gap-x-4 gap-y-2 text-sm">
        <div className="text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">Type</div>
        <div className="text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">Host</div>
        <div className="text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">Value</div>
        <div />

        {records.map((r) => (
          <RecordRow key={`${r.type}-${r.host}-${r.value.slice(0, 24)}`} record={r} />
        ))}
      </div>
    </>
  );
}

function RecordRow({ record }: { record: DisplayRecord }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(record.value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <>
      <div>
        <span className="rounded-md bg-[var(--surface)] px-2 py-0.5 text-xs font-medium">
          {record.type}
        </span>
        {record.priority !== undefined && (
          <span className="ml-1.5 text-xs text-[var(--text-muted)]">prio {record.priority}</span>
        )}
      </div>
      <div className="font-mono text-sm break-all">{record.host}</div>
      <div className="overflow-x-auto font-mono text-sm break-all">{record.value}</div>
      <Button variant="ghost" size="sm" onClick={copy} aria-label={`Copy ${record.type} record`}>
        {copied ? (
          <>
            <Check className="size-3.5" /> Copied
          </>
        ) : (
          <>
            <Copy className="size-3.5" /> Copy
          </>
        )}
      </Button>
    </>
  );
}
