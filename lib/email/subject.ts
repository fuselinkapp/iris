// Pure subject helpers — used by both server (send pipeline) and client
// (reader pane reply UI). No runtime dependencies, safe to import anywhere.

const SUBJECT_PREFIX = /^(re|fwd?|fw)\s*:\s*/i;

export function normalizeSubject(s: string): string {
  let cur = s;
  while (SUBJECT_PREFIX.test(cur)) cur = cur.replace(SUBJECT_PREFIX, '');
  return cur.trim();
}

export function buildReplySubject(originalSubject: string): string {
  const stripped = normalizeSubject(originalSubject);
  return stripped ? `Re: ${stripped}` : 'Re:';
}
