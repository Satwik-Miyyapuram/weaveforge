# Annotation drafts (`reader::annotation_draft`)

Rust: `crates/wf-core/src/reader/annotation_draft.rs` (17 tests).
Wasm: `crates/wf-wasm/src/reader_annotation_draft.rs`.
TS wrapper: `packages/wf-wasm/src/wrappers-7.ts` (re-exported from `index.ts`).

Turns a user gesture (text selection, ink, image region, text box) into the
new annotation to save.

## Exports

| TS | Rust | Notes |
| --- | --- | --- |
| `draftFromTextSelection(input)` | `draft_from_text_selection` | `NewReaderAnnotation \| null`; null when no placeable text. |
| `draftInkAnnotation(input)` | `draft_ink_annotation` | Null when nothing was drawn. Strokes are compacted within `PDF_INK_SAVE_TOLERANCE` (0.1 pt). |
| `appendInkStroke(anchor, path)` | `append_ink_stroke` | Returns the anchor with one more path, or null for a stroke too short to keep. |
| `eraseInkPaths(anchor, x, y, radius)` | `erase_ink_paths` | Null when every path was removed. |
| `draftImageRegion(input)` | `draft_image_region` | Null for an empty region. |
| `grownTextRect(rect, height)` | `grown_text_rect` | Grows downward to `height`; never shrinks. |
| `textBoxFromRect(rect)` | `text_box_from_rect` | Rect to `{x, y, width, height}`. |
| `draftTextBox(input)` | `draft_text_box` | Text-box mark. |

## Types

`TextSelectionDraft`, `InkDraft`, `ImageRegionDraft`, `TextBoxDraft`,
`TextBoxRect` come from `./bindings.ts` (generated). The anchor argument and
result of `appendInkStroke` and `eraseInkPaths` use the hand-written
`CombinedPdfAnchor` (`reader-types.ts`); the wrapper casts at the raw boundary,
as `reader-selection.ts` does. Drafts return the hand-written
`NewReaderAnnotation` from `@weaveforge/core`.

## Parity notes

- Input and output shapes follow the old TS `draft-local-annotation.ts`.
- `PDF_INK_SAVE_TOLERANCE` is 0.1 pt, the same drift bound the ink tests check.
- Raw wasm functions take `JsValue`, so no typed input casts are needed.
