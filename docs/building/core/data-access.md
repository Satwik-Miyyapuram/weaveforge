# Data access: Rust plans, TS sends

Decided 2026-11-10 for the Rust port (PR #642).

## What is in Rust

For every PostgREST repository and every outside-service client (Zotero,
Mattermost, Overleaf, GitHub and the rest), Rust owns the logic:

1. Building the request: table, columns, filters, order and body
   (`postgrest_spec.rs`).
2. Turning rows into domain objects and back.
3. Any work done on the reply, such as filtering encrypted names after the read.

## What stays in TS

One small sender. It takes the request Rust built, sends it with the existing
`supabase-js` client or `fetch`, and hands the reply back to Rust. The token,
the connection probe, timeouts and write notifications stay where they are
(`apps/web/src/backend/providers/postgrest/`).

## Not done: a Rust network stack

We chose **not** to move the sending itself into Rust. That would mean Rust
calling `fetch` and owning the login token, retries, timeouts, the server probe
and PostgREST error mapping.

Why not now:

- It is about 40–60% more work than the plan above and removes only about 2–4
  more TS files.
- Rust has no network code today (no `web-sys` fetch, no async exports), so it
  would be built from zero.
- The wasm module is 1940 KB against a 2000 KB budget; async and fetch plumbing
  would likely push it over.
- Every read and write in the app would go through new code at once.
- It would not reach zero TS anyway: Supabase sign-in, the realtime websocket
  for co-editing and the server-side `safe-fetch.ts` stay in TS regardless.

## Doing it later

Because Rust already builds every request, adding the Rust network stack later
only replaces the one TS sender. Nothing else changes. Pick it up as its own
step once the rest of the port is moved and tested.
