# postgrest_transport

Rust home: `crates/wf-core/src/sync/postgrest_transport.rs`. wasm: `crates/wf-wasm/src/sync_postgrest_transport.rs`.
TS caller: `apps/web/src/features/offline-sync/infra/postgrest-transport.ts` (`PostgrestTransport`).

## What moved

- Request specs for every call the transport makes (`postgrestWriteRequest`, `postgrestGoneRequest`,
  `postgrestConflictRequest`, `postgrestTombstoneRequest`, `postgrestPresenceRequest`,
  `postgrestTombstonesForRequest`, `postgrestChangesRequest`). Method, path, body and `prefer` header.
- Write shape per op: insert POSTs, update PATCHes, delete DELETEs. Updates and deletes are guarded by
  `row_version=eq.N` only when a base version is held.
- Request init for `fetch`: headers (`content-type`, `apikey`, `authorization` when a token is set, `prefer`).
- Send decisions (wf-core `sync::send_verdict`, `sync::send_steps`): conflict, gone, tombstoned, and the absent-id
  list. `send_steps` is a step machine: Rust returns `{ next: "read", ... }` for each GET the transport must make,
  then the final `SendOutcome` (`serverRow` unknown = key omitted, absent = `null`, present = object).
  wasm: `sendStart`, `sendAdvance`.
- The `missingIds` plan: `missingIdChunks` (chunks of `MISSING_IDS_CHUNK` = 100), then `missingAfterPresence` and
  `missingAfterTombstones` decide what is missing. The TS loop reads each chunk and feeds replies back.
- Feed reply: `changesFromReply` (`ChangesReply`: the feed rows as `changes` (`PullChange`) from the status and body).
- The `postgrest*Request` specs above are used by the TS loop; the reply helpers `postgrestParseRows`,
  `postgrestHeldIds`, `postgrestDeletedIds`, `postgrestAbsentIds` and `postgrestToChange` are dropped from wasm.
  Their rules live in `send_verdict` and `send_steps`.

## What stays in TS

- `fetch`, the network-failure throw (`NetworkFailure`), the access token read, and the loop that performs each
  `next: "read"` request and calls `sendAdvance` or the next chunk.
- A read that never answers (status 0, empty body) is passed to Rust as a blank reply, reproducing the old catch branch.
- The BigInt guard `assertEncodable` (xlog-03): a payload JSON cannot encode must throw before the request.
- The app-log error sink.

## Known approximations

- Object key order: Rust builds JSON maps in sorted key order. `JSON.stringify` keeps insertion order.
  PostgREST ignores key order, so this does not change the server's answer.
- JS coercion: `String(...)` and `Number(...)` of object or array values are approximate (`[object Object]`,
  comma-joined arrays, `NaN` for unreadable strings). The feed fields are scalars in practice.

## Tests

Request-shape `it:` cases moved to `#[test]` in `postgrest_transport.rs`: update guard, delete guard, unguarded
update, tombstone path, conflict read, gone read, feed RPC and mapping, missingIds presence and tombstone asks,
and the absent-list rule. Fetch-outcome cases (offline, refused, conflict flows, thrown fetch, logging) stay in the TS test file, unchanged.
