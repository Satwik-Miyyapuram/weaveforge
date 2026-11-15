# Reader annotation rows (`reader::annotation_rows`)

Rust: `crates/wf-core/src/reader/annotation_rows.rs`.
Wasm: none. The function is not exported to wasm or TS.
Caller: `crates/wf-core/src/repos/reader_annotations.rs` (`use crate::reader::annotation_rows::to_domain`).
TS: the reader annotation store in `apps/web/src/features/reader/infrastructure/parts-1.ts` (`// --- reader-annotation-repository ---`).

Pure logic: maps a stored annotation row (snake_case columns) to the domain `ReaderAnnotation`.

## Exports

| Rust | Notes |
| --- | --- |
| `to_domain(row) -> Result<ReaderAnnotation, String>` | Returns `Err` on an unknown type. |

`ReaderAnnotationRow` (Rust) is the stored row shape. Its `kind` field serialises as `type`.

## Rules

- Error text: `Invalid annotation type in store: {type}`. The Rust side returns it as the `Err` string.
- `syncState`: kept when `is_annotation_sync_state` accepts it, otherwise `"local"`.
- `zoteroVersion`: `null` when absent.
- `comment`: always set (`Some`).
- `tags` and `anchor`: default to an empty list and an empty object when absent.

## Parity notes

- The TS store (`parts-1.ts`) does not map `sync_state` or `zotero_version`; it passes rows to Rust. Rust reads both with serde defaults, so absent and null take the same path.
- `anchor` default serialisation is unverified against the TS `anchor ?? {}` for every `CombinedPdfAnchor` variant.
