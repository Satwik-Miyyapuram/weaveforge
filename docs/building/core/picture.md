# Pictures (`reader::picture`)

Rust: `crates/wf-core/src/reader/picture.rs` (5 tests).
Wasm: `crates/wf-wasm/src/reader_picture.rs`.
TS types: declared in Rust; served straight from the wasm package (no TS wrapper).

Placed picture marks: their stored metadata (file path, crop, stacking order), the
figure rect on the page, and the draft for a new picture.

## Exports

| TS | Rust | Notes |
| --- | --- | --- |
| `pictureMeta(kind, comment?)` | `picture_meta` | `PictureMeta \| null`; null when the mark is not a picture. |
| `pictureComment(meta)` | `picture_comment` | The comment text that stores crop and stacking order. |
| `pagePictures(annotations, pageHeight)` | `page_pictures` | Placed pictures on a page, figure-ready, in paint order. |
| `pictureRect(figure, pageHeight)` | `picture_rect` | `[x1, y1, x2, y2]` in PDF user space. |
| `draftPicture(input)` | `draft_picture` | New picture mark, half the page wide at the picture's aspect. |

`picturePath` is not exported from this module. It lives in
`reader-mark-actions.ts` (`reader::mark_actions::picture_path`), so the two
exports do not collide.

## Types

`PictureMeta`, `FigureGeometry`, `PagePicture`, `PictureDraftInput` come from
`./bindings.ts`. Annotations and the drafted mark use the hand-written
`ReaderAnnotation` and `NewReaderAnnotation` from `@weaveforge/core`.
