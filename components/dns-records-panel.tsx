'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { CLOUDFLARE_EMAIL_ROUTING_RECORDS } from '@/lib/email/cloudflare-records';

export function DnsRecordsPanel() {
  return (
    <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]/50 p-5">
      <p className="text-sm text-[var(--text-muted)]">
        Paste these into the DNS tab of your registrar (or Cloudflare DNS, if your domain is on
        Cloudflare). Records can take up to 24 hours to propagate.
      </p>

      <div className="mt-4 grid grid-cols-[60px_60px_1fr_auto] items-center gap-x-4 gap-y-2 text-sm">
        <div className="text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">Type</div>
        <div className="text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">Host</div>
        <div className="text-[0.7rem] uppercase tracking-wider text-[var(--text-muted)]">Value</div>
        <div />

        {CLOUDFLARE_EMAIL_ROUTING_RECORDS.map((r) => (
          <RecordRow key={`${r.type}-${r.value}`} record={r} />
        ))}
      </div>
    </div>
  );
}

function RecordRow({
  record,
}: {
  record: (typeof CLOUDFLARE_EMAIL_ROUTING_RECORDS)[number];
}) {
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
      <div className="font-mono text-sm">{record.host}</div>
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
