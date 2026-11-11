# Overleaf sync status core module

The `overleaf::sync_status` rule writes the one-line status for the Overleaf panel when
no pull or push result is shown.

## What lives in Rust

- No status: `""`.
- No remote URL: `Not pulled yet.`
- In step (zero ahead, zero behind): `In step with Overleaf.`
- Otherwise: `N commit(s) to push, M to pull.` with singular/plural handled.

Source: `crates/wf-core/src/overleaf/sync_status.rs`. Wasm: `crates/wf-wasm/src/overleaf_sync_status.rs`
(`describeOverleafStatus`). Wrapper: `packages/wf-wasm/src/wrappers-5.ts`.

## What stays in TypeScript

`apps/web/src/features/overleaf/application/parts.ts` keeps the desktop shell
calls and token storage. The pull and push lines still come from `describePull` and
`describePush` in `git_remote`.
