# Canvas (core)

`crates/wf-core/src/canvas/` reads, checks and writes JSON Canvas 1.0 text. A
canvas is stored as the body of a vault page whose `kind` is `canvas` (see
[vault-page](vault-page.md)). The module is pure: it takes the body text.

## API

| Rust fn | Returns | wasm export |
| --- | --- | --- |
| `parse_canvas(text)` | `Result<Canvas, String>` | none |
| `canvas_text(&Canvas)` | the file text | none |
| `normalize_canvas_text(text)` | `Result<String, String>` | `normalizeCanvasText` |
| `validate(&Canvas)` | `Vec<CanvasIssue>` | `validateCanvasText` |
| `canvas_bounds(&Canvas)` | `Option<CanvasRect>` | `canvasBounds` |
| `group_members(&Canvas, group_id)` | `Vec<String>` | `canvasGroupMembers` |

The wasm exports (`crates/wf-wasm/src/canvas.rs`) all take the body text, so no
canvas object crosses the boundary.

## Rules

- Reading is lenient and lossless. `Canvas`, `CanvasNode` and `CanvasEdge` each
  keep unknown fields in a flattened `extra`, so another app's fields survive a
  save. An Obsidian sample round-trips byte for byte.
- Blank text is an empty canvas. Text that is not JSON, not an object, or has a
  field of the wrong type is an error.
- `canvas_text` indents with tabs, writes one compact node or edge per line,
  adds no trailing newline and writes whole numbers without a fraction. A
  missing `x` or `y` is not invented and not written.
- `validate` lists issues nodes first, in file order. Codes: `missing-id`,
  `duplicate-id`, `missing-field`, `bad-size`, `missing-node`, `bad-side`,
  `bad-end` and `bad-color`. Sides are top, right, bottom and left. Ends are
  none and arrow.
- `node_rect` treats a negative or missing size as 0. `canvas_bounds` is `None`
  for an empty canvas and is what "fit to view" shows.
- `group_members` returns the nodes wholly inside the group, in z-order. Edges
  may touch. It is empty when there is no such group.

## TS side

`apps/web/src/features/canvas`:

- `application/canvas-doc.ts` turns the body into React Flow nodes and edges and
  back. `data.raw` keeps the unknown fields.
- `application/canvas-files.ts` resolves a file node to a workspace document by
  exact path, then by title and extension.
- `application/canvas-save.ts` is the debounced `CanvasSaver` (600 ms). It
  retries a failed write up to 30 s apart and remembers the last 8 saves to
  ignore its own echoes. It sends one write at a time, each with the body it
  was built on (`base`), through the guarded save in
  [vault_page_guard](vault_page_guard.md), which merges or keeps a conflict
  copy. While a change is unsaved, a body from elsewhere is not shown; when the
  write lands, `onStored` shows the stored merge, or a body that arrived during
  the write and was stored after it.
- `application/canvas-keys.ts` decides when Backspace and Delete remove a
  selection, and when a press moves focus to the board.
- `ui/` holds the editor and the node views. `index.tsx` exports
  `LazyCanvasEditor`, a client-only dynamic import.
- The editor workspace hosts it in `editor-workspace/ui/canvas-document.tsx`
  and the Notes page in `vault/ui/vault-screen/page-editor.tsx`.

## Related

- [Canvas (using)](../../using/canvas.md)
- [Editor workspace](editor-workspace.md) creates canvases from the explorer.
- [Sync](sync.md) writes a canvas as a `.canvas` file.
