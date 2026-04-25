# Phase 0.3 — Reader pane (story)

## Who & what

The vibe-code founder is back in Iris. Phase 0.2 gave them a real Grandma view with believable threads, but clicking a row did nothing — the inbox was decorative. This phase closes the loop: clicking a thread opens its message body in a third pane to the right, the unread badge ticks down, and the row stops looking unread. The thread metadata, the body, the timestamp, and the from-line are all visible at once with the list still in view, so context-switching between threads is one click. Success is the moment they read three messages in a row, watch the unread counts tick down, and feel for the first time that this is a real inbox, not a shell.

## In scope

- A **third pane** in the Grandma view: when a thread is selected, the layout becomes `mailboxes (260px) | thread list (~360px) | reader (fills)`. When nothing is selected, the reader pane shows a calm empty state ("Pick a thread to read").
- **Thread selection in the URL**: `?mailbox=…&thread=…`. Reload preserves both. Clicking a different mailbox keeps `?mailbox=…` and clears `?thread=…`.
- **Reader content** for the selected thread:
  - Subject as the page heading (large).
  - From line: name (if present) + email address (muted).
  - To line: each recipient on its own line, muted.
  - Received-at: full date + time, muted.
  - Body: plain-text contents of `messages.text` rendered with preserved whitespace. No HTML rendering this phase.
- A **back/close affordance** in the reader header (X icon, top-right). Clicking it clears `?thread=…` and returns to the empty reader state.
- **Mark-read on open**: when the reader fetches a thread that has unread messages, a Server Action sets `messages.read_at` for those messages and decrements `threads.unread_count` to 0. The UI re-fetches Grandma data so the row stops bolding and the mailbox unread badge updates. No optimistic update — the next list refresh reflects truth.
- **Multi-message thread support in the data path**: even though current seeds are single-message, the reader fetches *all* messages for a thread and renders them stacked (oldest first). This makes phase 0.4's threading work cheaper.
- **A small seed update**: the reader needs to render meaningfully even when a thread happens to be already-read. Existing seed already covers both cases (some seeds have `read: true`). No seed changes required.

## Out of scope

- HTML body rendering / sanitization / iframe sandbox. Plain text only this phase.
- Keyboard shortcuts (`j/k`, `Esc`, `Enter`, `Backspace` etc.). All keyboard support is deferred to a later phase per the user's discovery answer.
- Compose and reply. The compose page from phase 0.1 stays a placeholder.
- Thread mutations beyond mark-read: no archive, no delete, no snooze, no labels.
- Mark-unread (toggling back). Once read, stays read this phase.
- Attachments rendering. Schema supports them; reader does not display them.
- Forward / print / share buttons.
- Conversation collapse/expand for multi-message threads. They render fully expanded.
- Mobile responsive treatment of the now-three-pane layout.
- Search inside a thread.
- Cross-mailbox "next thread" / "previous thread" navigation.

## Constraints & assumptions

- **Minimum viewport**: ~1100px wide for the 3-pane layout to feel right. Below that the layout will get cramped — acceptable for v0 desktop-first.
- **Mark-read is a write path**: this is the first user-driven write in the app. All previous DB writes were the seed script. The Server Action that does it is gated by no auth (consistent with v0 single-tenant), but receives a TODO marker like the read action did in 0.2.
- **Server Action data fetch pattern**: phase 0.2 established `getGrandmaData` as a Server Action called from a client component. The reader uses the same pattern (`getThread(threadId)` Server Action). After mark-read, the reader triggers the existing `getGrandmaData` refresh via a tiny mechanism (lifted state or a refetch trigger) so the unread count updates without a full page reload.
- **Plain text rendering**: use `<pre className="whitespace-pre-wrap font-sans">` so newlines render but the font stays our UI typography. Wrap long lines.
- **Multi-message stacking** uses a divider between messages and shows each message's from + received-at in a sub-header.
- **Assumption**: the existing `messages` table schema has all the columns needed (`from_address`, `from_name`, `to_addresses`, `text`, `received_at`, `read_at`). Confirmed.
- **Assumption**: clicking a thread that's already selected (`?thread=` already matches) is a no-op — does not re-mark-read or refetch.
- **Assumption**: switching mailboxes while a thread is open closes the reader (clears `?thread=`). Otherwise the reader could show a thread that doesn't belong to the current mailbox view.

## Open implementation questions (planner-decidable)

- **Where does refetch state live?** Lean: lift Grandma's data into a small React state (already there) and expose a `refetch()` callback from `<GrandmaView />` to its child reader. Reader calls it after mark-read. Avoids contexts/stores for now.
- **Server Action name**: `getThread` and `markThreadRead`. Symmetric, descriptive.
- **Thread ID validation**: same `// TODO(auth)` marker pattern as 0.2; no runtime validation yet.
- **Date formatting in the reader**: full date + time string, e.g. `Tue, Apr 21 · 3:42 PM`. Hand-rolled formatter alongside the existing `formatRelative` helper.
- **Empty reader state**: small centered text block, no illustration. Reuses the calm voice of the Focus empty state.
- **Layout shift on first selection**: the third pane appears once a thread is selected. Reserve its space always (render an empty reader) to avoid jank when going from "no selection" → "selection." Lean: always render the reader pane, conditionally show the empty state inside it.
- **Close button placement**: top-right of the reader, plain X icon, no border.
- **Read-row visual change**: continue to differentiate via font-weight (`font-medium` for unread, muted for read) — already implemented in 0.2's row markup.

## Resolved questions (verbatim Q&A from discovery)

- **Q: Reader pane layout?** A: 3-pane (recommended).
- **Q: Body rendering: how do we handle HTML this phase?** A: Plain text only this phase (recommended).
- **Q: When does a thread get marked as read?** A: Immediately on open (recommended).
- **Q: Keyboard support in this phase?** A: (none selected — defer all keyboard to a later phase).
