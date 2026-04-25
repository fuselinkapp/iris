# Phase 0.3 — Reader pane (plan)

**Story:** `docs/phase-0.3-reader-pane-story.md`

## Goal

Add a third pane to Grandma view that opens the selected thread, renders its messages as plain text with from/to/date metadata, marks the thread read on open, and updates the unread badges — driven by a `?thread=` URL param and two new Server Actions (`getThread`, `markThreadRead`).

## Changes

### `lib/db/queries.ts` (modify, ~+45 LoC)

- Add `getThreadDetail(threadId)` returning `{ thread: ThreadHeader, messages: MessageRow[] } | null`. Single Drizzle query: `threads` joined with `mailboxes` + `domains` to resolve the address, plus a separate `messages` query for the thread, ordered by `received_at asc`. Returns `null` if no row.
- Add `markThreadRead(threadId)` returning `{ updated: number }`. In a transaction:
  1. `UPDATE messages SET read_at = unixepoch() * 1000 WHERE thread_id = ? AND read_at IS NULL` — capture rows affected.
  2. `UPDATE threads SET unread_count = 0 WHERE id = ?`.
- Export new types `ThreadHeader` (id, mailboxId, mailboxAddress, subject, lastMessageAt) and `MessageRow` (id, fromAddress, fromName, toAddresses (parsed `string[]`), text, receivedAt, readAt).

### `app/actions/grandma.ts` (modify, ~+30 LoC)

- Add `getThread(threadId: string)` Server Action — wraps `getThreadDetail`. `// TODO(auth)` marker.
- Add `markThreadRead(threadId: string)` Server Action — wraps `markThreadRead` query. `// TODO(auth)` marker.
- Both return typed payloads safe for client consumption (no Drizzle types leak).

### `lib/format-datetime.ts` (new, ~15 LoC)

- `formatDateTime(epochMs)` — returns `Tue, Apr 21 · 3:42 PM`. Hand-rolled, same shape as `formatRelative`. No Intl, edge-runtime safe for later.

### `components/grandma-view.tsx` (modify, ~+40 LoC, ~-15 LoC)

- Track selected thread from `?thread=` query param (alongside existing `?mailbox=`).
- Switch the inner grid from `grid-cols-[260px_1fr]` to `grid-cols-[260px_360px_1fr]`.
- Render `<ReaderPane threadId={selectedThreadId} onClose={...} onMarkedRead={refetch} />` as the third pane.
- Add a `refetch()` function that re-runs `getGrandmaData(selected)` to update unread counts after mark-read. Expose to `ReaderPane`.
- When the user clicks a thread row, call `selectThread(id)` which updates `?thread=` (using `router.replace` like `selectMailbox`).
- When the user changes mailbox, also clear `?thread=` to avoid stale-thread-from-other-mailbox.
- If the URL has `?thread=` on first load, the reader fetches it.
- Selected row in the thread list gets a subtle highlight (background or left-border).

### `components/reader-pane.tsx` (new, ~110 LoC)

- Client component. Props: `threadId: string | null`, `onClose: () => void`, `onMarkedRead: () => void`.
- If `threadId === null`: render centered empty state — "Pick a thread to read" muted text.
- Else: `useEffect(() => fetchThread(threadId), [threadId])`. After a successful fetch, if any message has `readAt === null`, fire `markThreadRead(threadId)` and call `onMarkedRead()` once it resolves. Cancel-flag guard for fast re-selection.
- Render header: subject (h1 text-2xl tracking-tight), small metadata block (from name + address, to addresses, full datetime), close button (X, top-right, ghost button).
- Render messages stacked: each message its own block with a sub-header (from name · date) and a `<pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">` body. Divider between messages.
- Loading state: faint "Loading…" text in the same place the empty state would render.
- Stale thread guard: if `getThread` returns `null` (thread not found), render "Thread not found" + close button.

### `components/today-view.tsx`

- No changes. Continues to swap in `<GrandmaView />` for `mode === 'grandma'`.

### `app/(app)/page.tsx`

- No changes. Already `runtime='nodejs'` + `force-dynamic`.

### `db/schema.ts`, `db/migrations/`, `db/seed.ts`

- **No changes.** Schema already supports `read_at`, multi-message threads, and `unread_count`. Seed already populates a mix of read/unread.

### `next.config.ts`, `package.json`

- **No new deps.** Plain-text rendering needs nothing beyond what we have.

## Micro-decisions (auto-resolved on superyolo)

- **0.3.a — `markThreadRead` as Server Action vs combined into `getThread`.** *Recommendation: separate action.* Tradeoff: two round-trips per open vs one. Separate is cleaner: `getThread` is idempotent and cacheable in spirit; `markThreadRead` is a write. The reader can also no-op the mark-read call when the thread is already fully read. **Resolved: take recommendation.**
- **0.3.b — Refetch grandma after mark-read: full refetch vs targeted patch.** *Recommendation: full refetch via the existing `getGrandmaData(selected)`.* Tradeoff: a small extra query vs hand-rolled patch logic that has to update both the thread row's `unreadCount` and the mailbox's aggregate. The full refetch is one line, latency is local. **Resolved: take recommendation.**
- **0.3.c — Plain text element.** *Recommendation: `<pre className="whitespace-pre-wrap font-sans">`.* Tradeoff: `<div>` + CSS works too, but `<pre>` semantically signals preformatted text and inherits accessibility correctly. **Resolved: take recommendation.**
- **0.3.d — Reader pane width.** *Recommendation: third column fills (`1fr`); thread list column fixed at 360px.* Tradeoff: gives the body the most space, which matches reader-mode intent. **Resolved: take recommendation.**
- **0.3.e — Layout when nothing selected.** *Recommendation: still render the third column with an empty state, do not collapse the layout.* Tradeoff: a permanently-wider Grandma view, but no jank when selecting/deselecting. **Resolved: take recommendation.**
- **0.3.f — Subject in URL.** *Recommendation: only the thread ID, no subject slug.* Tradeoff: less linkable but the app is single-tenant and the URL is internal. **Resolved: take recommendation.**
- **0.3.g — Mark-read trigger when thread already had `unread_count = 0`.** *Recommendation: skip the action call entirely.* Tradeoff: branch in client code vs harmless no-op write. Skipping avoids a needless round-trip and a needless `getGrandmaData` refetch. **Resolved: take recommendation.**
- **0.3.h — Close button vs back button.** *Recommendation: close (X) icon top-right inside the reader pane, ghost button.* Tradeoff: an explicit "back" arrow would also work, but X reads correctly for a side pane that doesn't occupy the whole screen. **Resolved: take recommendation.**

## NOT in this PR

- HTML rendering / sanitization / sandboxed iframe.
- All keyboard shortcuts (`j`/`k`/`Enter`/`Esc`/`Backspace` for thread navigation).
- Compose / reply.
- Archive / delete / snooze / labels / mark-unread.
- Attachment rendering.
- Mobile responsive treatment of the 3-pane layout.
- Cross-mailbox next/prev navigation.
- Search inside a thread.
- Auth.
- Schema or migration changes.

## Acceptance checklist

- [ ] `pnpm dev` boots; Grandma view shows the new 3-pane layout.
- [ ] With no thread selected, the third pane shows "Pick a thread to read".
- [ ] Clicking an unread thread row opens its body in the reader, the row stops looking unread, and the mailbox's unread badge ticks down within ~100ms after the action resolves.
- [ ] Clicking an already-read thread opens its body without an extra write or refetch (verify in browser network tab: only `getThread`, no `markThreadRead`).
- [ ] Reader shows: subject, from name + address, to addresses, full date+time, body with preserved whitespace.
- [ ] For threads where multiple messages exist (none in the seed yet, but the code path is there), they render stacked oldest first with dividers.
- [ ] Reader close button (X) clears `?thread=` and returns the empty-state pane.
- [ ] Switching to a different mailbox clears the open reader.
- [ ] Reload preserves both `?mailbox=` and `?thread=` and re-opens the same reader.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm build` succeeds.
- [ ] `pnpm lint` clean.
- [ ] No regression: `Focus` and `Triage` modes render unchanged from phase 0.1; `/settings`, `/compose` unchanged.

## Line budget

Target: **~250 lines** of hand-written code (queries +45, actions +30, datetime helper +15, reader-pane +110, grandma-view delta +40 / -15 = net +25, small tweaks ~+5). 25% tripwire: ~310 LoC. This is a focused phase — no schema, no new deps, no new tooling.
