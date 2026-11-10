# Sharing (core)

Rust owns the sharing rules. The TypeScript side keeps only types, repository
ports, and use-case orchestration.

## Where things live

| Concern | Owner | Path |
| --- | --- | --- |
| Share grant, comment, share-link rules (pure) | Rust | `crates/wf-core/src/sharing.rs` |
| Wasm exports (`shareableTypes`, `crdtEditableShareTypes`, `shareLinkDefaultTtlDays`, plus the row/rule functions) | Rust | `crates/wf-wasm/src/sharing.rs` |
| Typed wasm wrappers | TS | `packages/wf-wasm/src/sharing.ts` |
| Shared types and `*Fns` contracts | TS (hand-declared mirror) | `packages/core/src/shared/contract/sharing.ts` (re-exported by `core-contract.ts`) |
| Validation error classes | TS | `packages/core/src/shared/errors.ts` |
| Repository ports | TS | `packages/core/src/features/sharing/domain/*-repository.ts` |
| Use cases | TS (thin) | `packages/core/src/features/sharing/application/*.use-case.ts` |

## Types

`ShareableType`, `ShareAccess`, `Share`, `NewShareInput`, `ShareLink`,
`ShareLinkSaveInput`, `ResolvedShareLink`, `Comment`, `CommentAnchor`, and
`NewCommentInput` are declared by hand in `core-contract.ts`. They mirror the
Rust and bindings shapes. The shapes are not generated for this module, so when
a Rust field changes, update the mirror in the same change.

Interfaces that carry methods (`IShareLinkRepository`, `IShareLinkTokenHasher`)
live in `core-contract.ts` too, so the use cases depend on the contract, not on
a concrete module.

## Constants

Constants are read at call time from the wasm module. They are not TS `const`s,
so the Rust value is the only copy.

- `rust().shareableTypes()` replaces `SHAREABLE_TYPES`.
- `rust().crdtEditableShareTypes()` replaces `CRDT_EDITABLE_SHARE_TYPES`.
- `rust().shareLinkDefaultTtlDays()` replaces `SHARE_LINK_DEFAULT_TTL_DAYS`.

The wasm module must be loaded first (`loadCore()` in the web app,
`setRustCore` in tests). Calling these earlier throws.

## Share-link token

- Random bytes come from the injected `randomBytes(32)`. The 32-byte length is
  the `SHARE_LINK_TOKEN_BYTES` constant in `create-share-link.use-case.ts`.
  `generateShareLinkToken` was removed; it was a one-line wrapper.
- The URL form is `rust().encodeShareLinkToken(token)`.
- The default expiry is `rust().defaultShareLinkExpiresAt(nowMs)`.

## Errors

`ShareValidationError` and `CommentValidationError` live in `shared/errors.ts`
and extend `ValidationError`. Both names are in `RUST_VALIDATION_NAMES`, so an
error thrown by the Rust glue as a plain `Error` with that name still passes
`instanceof`.

Errors from `normalizeShareInput` and `normalizeCommentInput` are renamed to the
class name at the wrapper boundary (`asError` in `packages/wf-wasm/src/sharing.ts`).

## Public surface

`packages/core/src/features/sharing/index.ts` re-exports the types from
`core-contract.ts`, the two repository modules, and the six use-case modules.
It no longer exports the old domain classes or the removed constants.

## Deleted

The whole `domain/` folder (the share, comment, share-link and share-link-token
classes). Their rules live in `crates/wf-core` now.

## Still TS (thin)

The six use cases in `features/sharing/application/` are orchestration over
repository ports. Grant, comment, and token rules run through `rust()`.

Pure rules still in TS (not ported, listed for review):

- `revoke-share-link.use-case.ts`: owner check `link.ownerId !== input.ownerId`.
- `create-share-link.use-case.ts`: `!input.resourceId` throws a bare `Error`,
  which the route maps to 500 rather than 400.
- `redeem-share-link.use-case.ts`: expiry and revocation are enforced by the
  repository's `redeem`, not here.
- `manage-vault-page.use-case.ts` (group B, vault): `title.trim()` and the
  required-title check are TS. The title-key comparison uses `rust().normalizeTitleKey`.
