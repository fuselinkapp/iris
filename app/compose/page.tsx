'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default function ComposePage() {
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
          Send isn't wired up yet — this is the shape of things to come.
        </p>

        <form className="mt-6 flex flex-col gap-3" onSubmit={(e) => e.preventDefault()}>
          <Input name="to" placeholder="To" autoComplete="off" />
          <Input name="subject" placeholder="Subject" autoComplete="off" />
          <textarea
            name="body"
            placeholder="Write something kind."
            rows={10}
            className="w-full resize-y rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          />
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" disabled>
              Save draft
            </Button>
            <Button type="submit" variant="primary" disabled>
              Send
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
