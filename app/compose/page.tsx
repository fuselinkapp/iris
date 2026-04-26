import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getMailboxesForSend } from '@/app/actions/grandma';
import { ComposeForm } from '@/components/compose-form';
import { Card } from '@/components/ui/card';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function ComposePage() {
  const mailboxes = await getMailboxesForSend();
  if (mailboxes.length === 0) redirect('/settings/domains?add=1');

  const hasResendKey = Boolean(process.env.RESEND_API_KEY);

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-6 py-10">
      <Link
        href="/"
        className="inline-flex w-fit items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        <ArrowLeft className="size-4" />
        Back
      </Link>

      <Card className="p-6">
        <h1 className="text-lg font-medium tracking-tight">New message</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {hasResendKey
            ? 'Sends via Resend in sandbox mode this phase.'
            : 'No Resend key set — send runs as a dry-run that still records the message locally.'}
        </p>

        <div className="mt-6">
          <ComposeForm
            mailboxes={mailboxes}
            defaultMailboxId={mailboxes[0].id}
            showSandboxNotice
            hasResendKey={hasResendKey}
          />
        </div>
      </Card>
    </div>
  );
}
