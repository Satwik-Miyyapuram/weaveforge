# Annotation geometry (`reader::annotation_geometry`)

Rust: `crates/wf-core/src/reader/annotation_geometry.rs` (20 tests).
Wasm: `crates/wf-wasm/src/reader_annotation_geometry.rs`.
TS wrapper: `packages/wf-wasm/src/wrappers-6.ts` (re-exported from `index.ts`).

Groups annotations by the page they paint on, and projects one page's annotations
to CSS-pixel boxes and strokes.

## Exports

| TS | Rust | Notes |
| --- | --- | --- |
| `bucketAnnotationsByPage(annotations)` | `bucket_annotations_by_page` | Returns `Map<number, ReaderAnnotation[]>` keyed by 1-based page number, in first-insertion order. |
| `projectPageAnnotationGeometry(input)` | `project_page_annotation_geometry` | Returns `{ boxes, strokes }` in CSS pixels for one page. |

The raw core returns index buckets (`PageBucket[]`, `annotationIndices`). The
wrapper rebuilds the Map so `pdf-reader.tsx` keeps its shape.

## Types

`AnnotationBox`, `AnnotationStroke`, `PageAnnotationGeometry`,
`ProjectGeometryInput`, `PageBucket` come from `./bindings.ts`. Annotations are
the hand-written `ReaderAnnotation` from `@weaveforge/core`.

## Parity notes

- A cross-page highlight lands in both page buckets.
- Annotations that cannot be placed (no `pageIndex`, negative, or fractional)
  are dropped from the buckets. The old TS did the same.
- Uses `ink::js_math` (`min`, `max`, `round`, `hypot`) so NaN propagates and -0
  behaves as in JS.
