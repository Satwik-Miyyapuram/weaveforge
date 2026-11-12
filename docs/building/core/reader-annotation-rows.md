# Reader annotation rows (`reader::annotation_rows`)

Rust: `crates/wf-core/src/reader/annotation_rows.rs`.
Wasm: `crates/wf-wasm/src/reader_annotation_rows.rs`.
TS types: declared in Rust; served straight from the wasm package (no TS wrapper).
TS shim: `apps/web/src/features/reader/infrastructure/parts-1.ts` (kept; `postgrest-reader-annotation-repository.ts` importer).

Pure logic: maps a stored annotation row (snake_case columns) to the domain `ReaderAnnotation`.

## Exports

| TS | Rust | Notes |
| --- | --- | --- |
| `annotationRowToDomain(row)` | `to_domain(row) -> Result<ReaderAnnotation, String>` | Throws `Error` on an unknown type. |

`ReaderAnnotationRow` (Rust) is the stored row shape. Its `kind` field serialises as `type`.

## Rules

- Error text: `Invalid annotation type in store: {type}`. The wasm side returns it as a JS `Error` (`JsError`).
- `syncState`: kept when `is_annotation_sync_state` accepts it, otherwise `"local"`.
- `zoteroVersion`: `null` when absent.
- `comment`: always set (`Some`).
- `tags` and `anchor`: default to an empty list and an empty object when absent.

## Parity notes

- The TS shim maps absent `sync_state` and `zotero_version` to `null` before the call. Rust reads both with serde defaults, so absent and null take the same path.
- `anchor` default serialisation is unverified against the TS `anchor ?? {}` for every `CombinedPdfAnchor` variant.
