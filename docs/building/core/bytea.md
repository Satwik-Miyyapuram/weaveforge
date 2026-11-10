# Bytea core module

The `bytea` module holds the two byte codecs the web app uses for storage and
sync payloads: PostgREST's `\x…` hex for `bytea` columns, and standard padded
base64. It is pure and synchronous. It does no I/O and holds no state.

It replaces `apps/web/src/lib/bytea.ts`, which is deleted. The output must stay
byte-for-byte the same as that TypeScript, because stored rows and sync payloads
depend on it.

## What lives in Rust

`crates/wf-core/src/bytea.rs` holds four functions:

- `decode_bytea`: reads a `\x`-prefixed (or bare) hex string into bytes. A pair
  that is not hex reads as `0`, and an odd trailing digit is dropped, which is
  what the old `parseInt` into a `Uint8Array` did.
- `encode_bytea`: writes `\x` followed by lowercase hex.
- `decode_base64`: reads base64 with `atob`'s leniency (ASCII whitespace skipped,
  padding optional). It returns an error for a character outside the alphabet or
  an impossible length.
- `encode_base64`: standard base64 with `=` padding. It works on the whole
  buffer, so large Yjs updates no longer hit the call-stack limit that the old
  chunked `String.fromCharCode` workaround guarded against.

## How the app calls it

The wasm exports live in `crates/wf-wasm/src/bytea.rs` as `decodeBytea`,
`encodeBytea`, `decodeBase64` and `encodeBase64`. The wrapper in
`packages/wf-wasm/src/bytea.ts` imports them from `../pkg/wf_wasm.js` and
re-exports them through `feature-wrappers.ts`.

`decodeBytea` keeps one TypeScript step in front of the core: a `Uint8Array`
passes through unchanged, because PGlite returns bytea columns as bytes already.

Callers reach these through `readyCore()` from `apps/web/src/lib/rust-core.ts`,
for example `readyCore().encodeBytea(bytes)`. That throws until `loadCore()` has
resolved, so every caller must run after the core has loaded. Tests that call a
codec need the core preloaded, as the other web tests already do.

`decodeBase64` throws on invalid base64. The old `atob` path threw too, so the
failure mode is unchanged.
