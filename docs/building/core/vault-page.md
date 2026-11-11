# Vault page (core)

Rust owns the vault page rules. The TypeScript side keeps only types, the
repository port, and the thin use case.

## Where things live

| Concern | Owner | Path |
| --- | --- | --- |
| Wikilinks, frontmatter, titles, tree, previews, scoping (pure) | Rust | `crates/wf-core/src/vault/page.rs` |
| Page row mapping | Rust | `crates/wf-core/src/vault/page_row.rs` |
| Wasm exports (`vaultImagePrefix`, `vaultBodyPreviewChars`, plus the helper functions) | Rust | `crates/wf-wasm/src/vault_page.rs` |
| Typed wasm wrappers | TS | `packages/wf-wasm/src/wrappers-11.ts` |
| Page types and `VaultPageFns` | TS (hand-declared mirror) | `packages/core/src/shared/core-contract.ts` |
| `VaultPageValidationError` | TS | `packages/core/src/shared/errors.ts` |
| Repository port | TS | `packages/core/src/features/vault/domain/vault-page-repository.ts` |
| Use case (thin) | TS | `packages/core/src/features/vault/application/manage-vault-page.use-case.ts` |

## Types

`VaultPage`, `NewVaultPageInput`, `VaultPageSummary`, `VaultPageFilter`,
`VaultPageTreeNode`, `WikilinkRef` and `ParsedFrontmatter` are declared by hand
in `core-contract.ts`. They mirror the Rust and bindings shapes. The barrel
`packages/core/src/index.ts` re-exports them, so importers of
`@weaveforge/core` are unchanged.

## Constants

The constants that used to be TS `const`s are now wasm getters, read at call
time:

- `vaultImagePrefix()` returns `"vault:"` (wf-core `VAULT_IMAGE_PREFIX`).
- `vaultBodyPreviewChars()` returns `320` (wf-core `VAULT_BODY_PREVIEW_CHARS`).

Callers in `apps/web` use `readyCore().vaultImagePrefix()`. Core code uses
`rust().vaultImagePrefix()` / `rust().vaultBodyPreviewChars()`. The default
`max` of `vaultBodyPreview` reads `vaultBodyPreviewChars()` in the wasm wrapper.

## Errors

`VaultPageValidationError` lives in `shared/errors.ts` and is listed in
`RUST_VALIDATION_NAMES`, so an error thrown by the glue passes `instanceof`
the same way the other validation errors do.

## Not ported

Nothing was missing from Rust. `page.rs` and `page_row.rs` already hold the
logic the removed TS file described. The use case keeps its THIN checks
(trim, required title) in TS.
