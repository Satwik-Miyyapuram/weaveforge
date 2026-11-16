---
covers:
  - apps/web/src/features/collab/infrastructure/realtime-yjs-provider.ts
  - apps/web/src/features/collab/test/live-sync.test.ts
  - apps/web/src/features/collab/test/fake-realtime.ts
checked: 2026-11-16
---
# Live collaboration

How one co-editing session starts, saves, survives a dropped connection and
catches up. The user-facing side is in
[collaborative-editing.md](../using/collaborative-editing.md). Everything here
lives in `RealtimeYjsProvider`; the editor only builds the `Y.Doc` and the
`Awareness` and hands them over.

## The pieces

| Piece | What it is |
| --- | --- |
| `Y.Doc` | The document. One per open editor. Text is `doc.getText("body")`. |
| Channel | A Realtime broadcast channel `crdt:<type>:<id>`, `self: false`. Only peers that have the doc open are on it. |
| `crdt_updates` | The stored log of Yjs updates, through `crdtStore`. Reopening replays it. |
| Body | The plain-text row field. The editor saves it on its own debounce (`BodySaver`). |
| Awareness | Cursors and names, from `y-protocols`. Never stored. |

## Session start

1. The constructor starts `bootstrapFromStore()`: it reads the snapshot
   watermark, replays every log row after it into the doc, then calls `seed()`.
   Seeding fills an empty doc from the body, so a doc with no log still opens
   with its text. It runs even if the replay failed.
2. If the copy is `live` (it has an account), `join()` builds the channel,
   registers the four events (`yjs`, `awareness`, `sync1`, `sync2`) and calls
   `connect()`: `setAuth()` with the user's token, then `subscribe()`.
3. On `SUBSCRIBED` the provider marks itself connected and runs `onJoined()`:
   - sends anything queued while offline (see below);
   - broadcasts `sync1` with its state vector;
   - broadcasts its own awareness state.

A local-only copy never joins. It still replays and persists the log.

## Catching up: sync step 1 and 2

Broadcast is fire-and-forget, so a peer that was away has missed messages.
The state-vector exchange closes that gap in both directions:

- **`sync1 { sv, from }`**: "here is what I have". Every peer that hears it
  replies with `sync2 { to, data, sv }`. `data` is
  `encodeStateAsUpdate(doc, sv)`: only what the asker lacks. The peer also
  re-sends its awareness, so the newcomer sees cursors at once.
- **`sync2`**: only the addressee (`to`) applies it. It then compares the
  replier's `sv` with its own doc and, if the replier lacks anything, sends
  that as an ordinary `yjs` update. An empty diff (2 bytes) is not sent.

This is how a late joiner gets the full state from a peer even when the log is
empty, and how both sides of an offline split end up equal.

## Live edits

Each local change (origin is not the provider) goes on the `pending` list.
After 200 ms (`MERGE_MS`) the list is merged into one update and broadcast as
`yjs`. Remote updates are applied with the provider as origin, so they are
neither re-broadcast nor re-queued. Yjs ignores structs it already has, so the
same update arriving twice (live and again in a `sync2`) changes nothing.

## Offline edits

While not connected, `flushOutbound()` keeps the merged update in `pending`
instead of sending it. A send that fails or returns anything but `"ok"` puts
the update back at the front; it goes out merged with the next edit, or on the
next `SUBSCRIBED`, when `onJoined()` sends the queue once. The sync step catches
anything the queue does not cover.

## Reconnect

The Realtime library rejoins some channels by itself and not others, so the
provider covers each case:

| Status | Who rejoins |
| --- | --- |
| `CHANNEL_ERROR`, `TIMED_OUT` | Usually the library, on the same channel: `SUBSCRIBED` fires again and `onJoined()` runs. A refused join (expired token, denied topic) may never be retried, so if no `SUBSCRIBED` comes within 10 s (`ERROR_REJOIN_MS`) the provider leaves that channel and `join()` builds a new one. A late `SUBSCRIBED` on the old channel is then ignored. |
| `CLOSED` from the server | Nobody, unless we do. The library drops closed channels, so `join()` builds a new one. |
| `setAuth()` rejected | We retry `connect()` on the *same* channel (no new handlers). |

Our retries back off 1 s, 2 s, 4 s … up to 30 s (`REJOIN_BASE_MS`,
`REJOIN_MAX_MS`). One timer at a time; a success resets the count. A status from
a channel that is no longer current is ignored.

## Presence

- Only this client's own awareness state is broadcast. Remote states (origin
  is the provider) are not echoed back, and neither is Awareness's own sweep
  dropping a peer that went quiet: other clients may still hear that peer.
- On disconnect every other client's state is forgotten (both `states` and
  `meta`, so its next update is accepted when we are back) and a `change` event
  fires, so the avatars clear.
- On `destroy()` the provider removes its own state and broadcasts the removal
  before leaving, so peers drop the cursor at once instead of after the 30 s
  awareness timeout.

## Persistence

- 5 s after the first local edit of a burst (`PERSIST_IDLE_MS`; later edits do
  not push it back), `persistTail()` appends the doc's full state to
  `crdt_updates`. Teardown forces one last append.
- When the tail reaches 200 rows (`COMPACT_THRESHOLD`) and the body is durable,
  the log is compacted. See the compaction notes in
  [collaborative-editing.md](../using/collaborative-editing.md).
- Reopening replays snapshot + tail, so a reload equals the doc before it.

## Teardown

`destroy()` clears the merge, persist, rejoin and errored-channel timers, sends the presence
removal, unbinds the doc and awareness listeners, unsubscribes the channel and
writes the final tail. After it, no listener, channel or timer is left.

## Tests

[`live-sync.test.ts`](../../apps/web/src/features/collab/test/live-sync.test.ts)
runs real providers and real `Y.Doc`s over
[`fake-realtime.ts`](../../apps/web/src/features/collab/test/fake-realtime.ts),
an in-memory broadcast server that can drop a socket, close a channel, refuse
joins (CLOSED, or CHANNEL_ERROR with no library retry), refuse a token, fail a
send, or report a late status on a replaced channel. It covers:

- convergence;
- offline merge;
- exactly-once resend on reconnect;
- a late joiner;
- reload equality;
- backoff, and replacing an errored channel the library gave up on;
- stale status and failed sends;
- presence;
- leak-free teardown.

Run it from `apps/web`:

```sh
node ./scripts/run-tests.mjs src/features/collab/test/live-sync.test.ts
```

## Known gaps

- Every peer answers a `sync1` with its own `sync2`, so a join costs one reply
  per peer, and N peers rejoining together cost N² replies. Fine for a few
  editors; letting one peer answer is the follow-up for larger groups.
