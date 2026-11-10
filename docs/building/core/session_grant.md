# Session grant core module

The `session_grant` module starts an AI session: it checks that AI access is on,
clamps the TTL, dedupes the sources and builds the in-memory grant. It does no I/O.
The use case `create-ai-session-grant.use-case.ts` calls it through `rust().startAiSession`.

## What lives in Rust

- The checks, in order, with the same messages as before: AI access disabled, disclosure
  not accepted, encryption locked, blank workspace name, no sources, read category not
  enabled for a source, invalid start time.
- `clamp_session_ttl_ms`: the default is 30 minutes, the max is 7 days, and a
  non-finite value falls back to the default.
- `unique_session_sources`: drops sources with no id and keeps the first of each
  `(resourceType, resourceId)`.
- Proposal capabilities filtered by the settings and the credential-protected kinds.
- Expiry, `requiresConfirmationForWrites: true` and the `startedAt` timestamp.

Source: `crates/wf-core/src/ai/session_grant.rs`. Wasm: `crates/wf-wasm/src/ai_session_grant.rs`
(`startAiSession`). Wrapper: `packages/wf-wasm/src/ai-session-grant.ts`.

## What stays in TypeScript

- The use case class and its exports, so callers do not change.
- Nothing is persisted: the grant lives in browser memory and the caller owns its lifecycle.

## Known risk

Rust parses `now` as ISO 8601 only. The TypeScript code accepted any string that
`new Date()` could read. Callers pass ISO strings today.
