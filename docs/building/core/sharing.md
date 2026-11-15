# Sharing (core)

Rust owns the sharing rules. The TypeScript side keeps only types, repository
ports, and use-case orchestration.

## Where things live

| Concern | Owner | Path |
| --- | --- | --- |
| Share grant, comment, share-link rules (pure) | Rust | `crates/wf-core/src/sharing.rs` |
| Wasm exports (`shareableTypes`, `shareLinkDefaultTtlDays`, plus the row/rule functions) | Rust | `crates/wf-wasm/src/sharing.rs` |
| TS types | Rust | `crates/wf-wasm/src` (`unchecked_*_type`) |
| Shared types | TS (hand-declared mirror) | `packages/core/src/shared/core-contract.ts`; functions typed by the generated wasm declarations |
| Validation error classes | TS | `packages/core/src/shared/errors.ts` |
| Repository ports | TS | `packages/core/src/features/sharing/domain/parts.ts` (`ICommentRepository`, `IShareRepository`) |
| Use cases | TS (thin) | `packages/core/src/features/sharing/application/parts.ts` |

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
- `rust().shareLinkDefaultTtlDays()` replaces `SHARE_LINK_DEFAULT_TTL_DAYS`.

The wasm module must be loaded first (`loadCore()` in the web app,
`setRustCore` in tests). Calling these earlier throws.

## Share-link token

- Random bytes come from the injected `randomBytes(32)`. The 32-byte length is
  the `SHARE_LINK_TOKEN_BYTES` constant in `packages/core/src/features/sharing/application/parts.ts`, used by `CreateShareLinkUseCase`.
- The URL form is `rust().encodeShareLinkToken(token)`.
- The default expiry is `rust().defaultShareLinkExpiresAt(nowMs)`.

## Errors

`ShareValidationError` and `CommentValidationError` live in `shared/errors.ts`
and extend `ValidationError`. Both names are in `RUST_VALIDATION_NAMES`, so an
error thrown by the Rust glue as a plain `Error` with that name still passes
`instanceof`.

Errors from `normalizeShareInput` and `normalizeCommentInput` are renamed to the
class name in Rust (`named_error` in `crates/wf-wasm/src/sharing.rs`).

## Public surface

`packages/core/src/index.ts` re-exports the types from
`core-contract.ts`, the repository interfaces, and the six use-case classes.
It no longer exports the old domain classes or the removed constants.

## Deleted

The share, comment, share-link and share-link-token classes. The `domain/` folder
keeps only the repository interfaces. Their rules live in `crates/wf-core` now.

## Still TS (thin)

The six use cases in `features/sharing/application/` are orchestration over
repository ports. Grant, comment, and token rules run through `rust()`.

Pure rules still in TS (not ported, listed for review):

- `RevokeShareLinkUseCase` (`packages/core/src/features/sharing/application/parts.ts`): owner check `link.ownerId !== input.ownerId`.
- `CreateShareLinkUseCase` (same file): `!input.resourceId` throws a bare `Error`,
  which the route maps to 500 rather than 400.
- `RedeemShareLinkUseCase` (same file): expiry and revocation are enforced by the
  repository's `redeem`, not here.
- Vault page titles: `title.trim()` is in `apps/web/src/features/vault/ui/vault-screen/page-editor.tsx`. The title-key comparison uses `rust().normalizeTitleKey` in `apps/web/src/features/vault/application/parts.ts`. No `manage-vault-page` use case exists in this worktree.
