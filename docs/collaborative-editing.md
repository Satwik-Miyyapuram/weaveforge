# Collaborative editing

Two people editing the same note or log entry at the same time, each seeing the
other's cursor and keystrokes, with no "someone else has saved this document"
dialog and no last-writer-wins overwrite.

It is on wherever you can already write: **vault notes** and **logbook
entries**. Nothing needs enabling — open a note you can edit and it is
collaborative.

## What you see

| | |
|---|---|
| **Live text** | Edits appear in the other window in about a second. |
| **Peer cursors** | Each editor gets a colour and a name tag at their caret. |
| **Who is here** | "Editing with …" above the editor, listing everyone else in the document. |
| **Sync trouble** | "Live sync unavailable" if the channel drops. Your edits are still saved — they just are not shared until it recovers. |

Notes keep everything the plain editor has — `[[wikilink]]` and `@cite`
completion, find-in-note, undo, the theme. Co-editing a note is the same editor
with a shared document behind it, not a plainer replacement.

### Saving

There is no save button for the body. It writes itself as you type, on a
1.5-second pause.

- **Notes** keep **Done** for the title, which is a plain input and not part of
  the shared document. "cancel" is "close": a collaborative body is already
  shared and saved, so offering to roll it back would be a lie.
- **Logbook entries** keep **Done** for the Kind selector, for the same reason.

### Who can co-edit

Whoever can already write to the item — its owner, and anyone it has been
shared with at **edit** level. Read-only and shared-in items get the ordinary
save-based editor, because they have no write authorization on the sync channel
and joining it would only produce refusals.

## How it works

Text is a [Yjs](https://yjs.dev) CRDT — a document structure where concurrent
edits merge without a central arbiter, so two people typing in the same
paragraph both keep their words.

```
CodeMirror ── y-codemirror ── Y.Doc ── EncryptedYjsProvider ─┬─ Realtime broadcast   (live)
                                                             └─ crdt_updates table  (durable)
```

- **Live** goes over a Supabase Realtime private channel, `crdt:<type>:<id>`.
  Authorization is RLS on `realtime.messages` (migration `0044`), so who may
  join is decided by the database, not by the client.
- **Durable** is the `crdt_updates` table. The provider appends the document
  state on an idle timer and once more when the editor closes, and replays the
  log when it opens.
- The row's own `body` column is still written, so everything that reads a note
  without opening the editor — search, the graph, exports, the API — is
  unaffected.

## Things that are load-bearing

Each of these was a bug once. They are recorded because none of them is
obvious from reading the code that depends on them.

### Seeds must be byte-identical

A note that has never been co-edited has no CRDT history, so the first client
to open it puts the row's `body` into the document. Doing that with a plain
`insert` gives **every client its own operation**, and the CRDT correctly keeps
all of them — the note doubles for each person who opens it.

The seed is therefore built from a throwaway document pinned to client id `0`
([`seed-document.ts`](../apps/web/src/features/collab/domain/seed-document.ts)),
which makes the bytes identical everywhere and the operation self-deduplicating.
It is applied only to a document with no history, because a replayed log already
carries the body.

### The socket only speaks JSON

`@supabase/realtime-js` binary-encodes every `broadcast` push. The self-hosted
Realtime does not accept that frame kind and answers by closing the **whole
websocket** with a 1011 — taking co-editing and the project-wide cache
invalidation channel down together.

Nothing about this is visible from the client: `phx_join` still reports
`SUBSCRIBED`, and the socket reconnects, and the next send kills it again. The
realtime client therefore pins its encoder to Phoenix's plain-JSON tuple
([`client.ts`](../apps/web/src/backend/providers/supabase/client.ts)). Do not
remove that override without checking the deployed Realtime version.

### Teardown order

`EncryptedYjsProvider.destroy()` leaves the channel **before** it awaits
anything. React mounts the replacement editor as soon as cleanup returns, and
supabase-js keys channels by topic — so a `phx_leave` sent after an `await`
closes the *new* editor's channel, and live sync is dead for the rest of the
session while everything still looks connected.

It unsubscribes rather than removing the channel, because removing the last
channel makes supabase-js disconnect the shared socket.

### The closing flush is forced

`destroy()` sets `destroyed` before it persists, and the idle-persist path skips
when that flag is set — so the final write has to opt out of the guard
explicitly. Without that, everything typed since the last idle persist reached
the row body and never reached the CRDT log, and the next open replayed a log
that was behind.

## Storage

`crdt_updates` grows with editing, and is compacted: once a document's tail
passes a threshold the log is replaced by a snapshot
(`compactCrdtLog`), so the table tracks document *size*, not edit count.

## Limits

- **Not end-to-end encrypted.** Updates are stored and broadcast as plaintext
  bytes; RLS and encryption at rest are the boundary. See [SECURITY.md](SECURITY.md).
- **Text only.** The title, tags and a note's Kind are ordinary fields with
  ordinary last-write-wins behaviour.
- **Offline edits are not queued.** If the channel is down your edits still save
  to the row, but they are not merged into anyone else's document until you
  reconnect and reopen.

## Related

| | |
|---|---|
| Realtime channel authorization | [`0044_realtime_authorization.sql`](../supabase/migrations/0044_realtime_authorization.sql) |
| Provider | [`encrypted-yjs-provider.ts`](../apps/web/src/features/collab/infrastructure/encrypted-yjs-provider.ts) |
| Editor | [`collaborative-markdown-editor.tsx`](../apps/web/src/features/collab/ui/collaborative-markdown-editor.tsx) |
| Regression tests | [`collab-regressions.test.ts`](../apps/web/src/features/collab/test/collab-regressions.test.ts), [`yjs-provider-teardown.test.ts`](../apps/web/src/features/collab/test/yjs-provider-teardown.test.ts) |
| Self-hosted Realtime setup | [`oracle-shift-guide.md`](backend/oracle-shift-guide.md) |
