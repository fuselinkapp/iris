import { NextResponse } from 'next/server';

import { type IngestPayload, type IngestResult, ingestMessage } from '@/lib/email/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let warnedAboutMissingToken = false;

function checkAuth(req: Request): { ok: true } | { ok: false; status: number; error: string } {
  const expected = process.env.IRIS_INGEST_TOKEN;
  const provided = req.headers.get('x-iris-ingest-token');

  if (expected) {
    if (provided === expected) return { ok: true };
    return { ok: false, status: 401, error: 'unauthorized' };
  }

  if (process.env.NODE_ENV === 'production') {
    return { ok: false, status: 401, error: 'ingest_token_unset' };
  }

  if (!warnedAboutMissingToken) {
    warnedAboutMissingToken = true;
    console.warn(
      '[iris] IRIS_INGEST_TOKEN is unset; accepting all /api/ingest requests in dev. ' +
        'Set IRIS_INGEST_TOKEN in .env.local to require auth locally.',
    );
  }
  return { ok: true };
}

export async function POST(req: Request) {
  const auth = checkAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: IngestPayload;
  try {
    body = (await req.json()) as IngestPayload;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  let result: IngestResult;
  try {
    result = await ingestMessage(body);
  } catch (err) {
    console.error('[iris] /api/ingest internal error:', err);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }
  if (result.reason === 'unknown_recipient') {
    return NextResponse.json({ error: 'unknown_recipient' }, { status: 404 });
  }
  return NextResponse.json({ error: 'invalid_payload', detail: result.detail }, { status: 400 });
}
