# Annotation helpers (`reader::annotation_helpers`)

Rust: `crates/wf-core/src/reader/annotation_helpers.rs`.
Wasm: `crates/wf-wasm/src/reader_annotation_helpers.rs`.
TS wrapper: `packages/wf-wasm/src/wrappers-7.ts` (re-exported from `index.ts`).

Pure record helpers for local annotations: pin keys, edits, optimistic rows, and the
list the Annotations sidebar shows.

## Exports

| TS | Rust | Notes |
| --- | --- | --- |
| `annotationPinKey(id, zoteroKey?)` | `annotation_pin_key` | The Zotero key when present and non-blank, else the local id. |
| `applyAnnotationPatch(ann, patch)` | `apply_annotation_patch` | Returns the full merged annotation (design change, see below). |
| `optimisticAnnotationFromDraft(draft, id, now)` | `optimistic_annotation_from_draft` | The row to paint before its write returns. `now` is an ISO timestamp from the caller. |
| `listedAnnotations(annotations)` | `listed_annotations` | Ink marks left out. |

`PENDING_ANNOTATION_PREFIX` (`"pending:"`) stays in
`apps/web/src/features/reader/application/reader-annotation-helpers.ts` with the
UI-side constants and tool predicates.

## Design change

`applyAnnotationPatch` returns the full merged `ReaderAnnotation`. The old TS
merged in place and returned the same object shape, so callers see no change.

## Parity notes

- `isDismissTap`, `isInkTool` and `toolOwnsThePage` have no TS forwarder; callers use `readyCore()` directly.
- Pin-key logic matches the old TS: a blank Zotero key falls back to the id.
