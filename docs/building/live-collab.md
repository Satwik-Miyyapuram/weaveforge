---
covers:
  - apps/web/src/features/collab/infrastructure/realtime-yjs-provider.ts
  - apps/web/src/features/collab/test/live-sync.test.ts
  - apps/web/src/features/collab/test/fake-realtime.ts
  - apps/web/src/features/collab/test/yjs-provider-sync.test.ts
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
   watermark and replays every log row after it into the doc. Then it may
   seed: fill the doc from the body, so a doc with no log still opens with its
   text. When seeding waits for peers, see below. It runs even if the replay
   failed.
2. If the copy is `live` (it has an account), `join()` builds the channel,
   registers the three events (`yjs`, `awareness`, `sync`), then calls
   `setAuth()` with the user's token, then `subscribe()`.
3. On `SUBSCRIBED` the provider marks itself subscribed and runs `onJoined()`:
   - sends anything queued while offline (see below);
   - broadcasts a `sync` `hello` with its state vector;
   - broadcasts its own awareness state;
   - opens the 600 ms hello window for seeding.

A local-only copy never joins. It still replays and persists the log.

## Catching up: the `sync` event

Broadcast is fire-and-forget, so a peer that was away has missed messages.
The state-vector exchange closes that gap in both directions:

- **`hello { id, seeded, sv }`**: "here is what I have". Every peer that hears
  it replies with `state { id, seeded, sv, data }`. `data` is
  `encodeStateAsUpdate(doc, sv)`: only what the asker lacks. The peer also
  re-sends its awareness, so the newcomer sees cursors at once.
- **`state`**: applied by everyone who hears it. One without `ack` is answered
  once with a `state` carrying `ack`, made from the replier's `sv`, so both
  sides end up with the union.
- **`bye { id }`**: an unseeded client leaving, so nobody waits on it.

This is how a late joiner gets the full state from a peer even when the log is
empty, and how both sides of an offline split end up equal.

Seeding from the body happens once per session, by one client: two clients
that each rebuild the body would make different operations, and the merge
would hold the text twice. A client seeds when it has nobody to wait for: no
channel, a seeded peer's state already merged in, or the hello window closed
with no lower unseeded client id heard. A peer that drops without a `bye` is
covered by a 4 s fallback (`SEED_FALLBACK_MS`). A lost channel closes the
window at once, so the editor does not wait to work alone.

## Live edits

Each local change (origin is not the provider) goes on the `pending` list.
After 200 ms (`MERGE_MS`) the list is merged into one update and broadcast as
`yjs`. Remote updates are applied with the provider as origin, so they are
neither re-broadcast nor re-queued. Yjs ignores structs it already has, so the
same update arriving twice (live and again in a `state`) changes nothing.

## Offline edits

While not subscribed, `flushOutbound()` keeps the merged update in `pending`
instead of sending it. A send that fails or returns anything but `"ok"` puts
the update back at the front; it goes out merged with the next edit, or on the
next `SUBSCRIBED`, when `onJoined()` sends the queue once, ahead of the `hello`.
The `sync` exchange catches anything the queue does not cover.

## Reconnect

There is one loop: `join()`, and on any failure `lost()`, which works alone,
replaces the channel and calls `join()` again after a backoff, for as long as
the editor is open. The Realtime library rejoins some channels by itself and
not others, so each case reaches `lost()` its own way:

| Case | What happens |
| --- | --- |
| No `SUBSCRIBED` within 10 s of the join (`JOIN_TIMEOUT_MS`) | `lost()`. |
| `CHANNEL_ERROR`, `TIMED_OUT` | Usually the library rejoins on the same channel: `SUBSCRIBED` fires again and `onJoined()` runs. A refused join (expired token, denied topic) may never be retried, so if no `SUBSCRIBED` comes within the join timeout, `lost()`. |
| `CLOSED` from the server | `lost()` at once. The library has already dropped the channel. |
| `setAuth()` rejected, or the join throws | `lost()`. |

`lost()` removes the channel from the client (`removeChannel`), so the client
cannot hand it back for the topic, and joins again once that settles, or after
one join timeout if the leave hangs. Retries back off 1 s, 2 s, 4 s … up to
30 s (`REJOIN_BASE_MS`, `REJOIN_MAX_MS`); `SUBSCRIBED` resets the count. A
status or broadcast from a channel that is no longer current is ignored.

If the client still hands back the channel given up on, `join()` removes it
again and asks once more; if it is still there, it logs and goes back to
`lost()`. Removing only happens on a replace, right before a new join, so the
shared socket is not left with an empty registry. `destroy()` still only
unsubscribes (see the note there).

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

`destroy()` clears the merge, persist, seeding, join, rejoin and leave timers,
sends the presence removal (and a `bye` if unseeded), unbinds the doc and awareness listeners, unsubscribes the channel and
writes the final tail. After it, no listener, channel or timer is left.

## Tests

[`live-sync.test.ts`](../../apps/web/src/features/collab/test/live-sync.test.ts)
runs real providers and real `Y.Doc`s over
[`fake-realtime.ts`](../../apps/web/src/features/collab/test/fake-realtime.ts),
an in-memory broadcast server that can drop a socket, close a channel, refuse
joins (CLOSED, or CHANNEL_ERROR with no library retry), refuse a token, fail a
send, report a late status on a replaced channel, hand back a channel that is
still registered, or ignore `removeChannel`. It covers:

- convergence;
- offline merge;
- exactly-once resend on reconnect;
- a late joiner;
- reload equality;
- backoff, and replacing an errored channel the library gave up on;
- seeding once, by one client, across joins and drops (`yjs-provider-sync.test.ts`);
- stale status and failed sends;
- removing a still-registered channel, and getting back from every failure;
- presence;
- leak-free teardown.

Run it from `apps/web`:

```sh
node ./scripts/run-tests.mjs src/features/collab/test/live-sync.test.ts
```

## Known gaps

- Every peer answers a `hello` with its own `state`, so a join costs one reply
  per peer, and N peers rejoining together cost N² replies. Fine for a few
  editors; letting one peer answer is the follow-up for larger groups.
