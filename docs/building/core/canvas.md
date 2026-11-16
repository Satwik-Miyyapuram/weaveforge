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
| `excalidraw::import_excalidraw(text)` | `Result<ExcalidrawImport, String>` | `importExcalidraw` (gives `{ canvasText, images, warnings }`) |
| `excalidraw::export_excalidraw(&Canvas, images)` | `ExcalidrawExport` | `exportExcalidraw(text, images)` |

The wasm exports (`crates/wf-wasm/src/canvas.rs`) all take the body text, so no
canvas object crosses the boundary.

### Ink (`ink.rs`)

Handwriting is the top-level `wfInk` field (`INK_FIELD`), a list of
`FreeStroke` items `{id, x, y, w, c, t, p, r}`:

- `x`, `y` is the origin in page pixels, `w` the width, `c` the colour.
- `t` is `pen` or `highlighter`; a missing `t` reads as `pen`.
- `p` holds the points as integer `dx, dy` pairs from the origin, in tenths of
  a pixel.
- `r` holds one pressure per point, 0 to 255. It may be missing or empty (the
  core and Excalidraw import write none); those points read at constant
  pressure. Pressure is stored but not drawn yet.
- Unknown stroke fields are kept in `extra`.

| Rust fn | Does |
| --- | --- |
| `read_ink(&Canvas)` | The strokes. A missing or non-list field is none; an item that is not a stroke is skipped. |
| `write_ink(&mut Canvas, strokes)` | Replaces the strokes. None removes the field, so an ink-free canvas is written as before. |
| `stroke_rect(&FreeStroke)` | The box around the points, grown by half the width. |
| `strokes_hit(strokes, x, y, radius)` | Ids of the strokes within `radius`, counting half the width. |

`canvas_text` writes `wfInk` with one stroke per line (two tabs in), so a
three-way merge diffs per stroke. Other extras stay compact on one line, as
Obsidian writes them. A whole `f64` (such as `x: 12.0`) is written as `12`.
An Obsidian canvas with ink added and then removed comes back byte for byte.

### Merge (`merge.rs`)

`merge_canvas_with_ink(base, local, remote)` is a three-way merge for a canvas
with ink. It takes the strokes out, merges the rest line by line, and merges
the strokes by id:

- Adds on either side are kept: remote order first, then local-only strokes.
- A stroke deleted on one side and untouched on the other is deleted.
- A stroke changed on one side only takes that change.
- Both sides changing one stroke differently, or a delete against a change, is
  a conflict (`None`).
- Ink it cannot read in full (an item that is not a stroke, a `wfInk` that is
  not a list, or two strokes with one id) is a conflict, so a merge never drops
  it.
- The result must parse and every edge must still reach both its nodes.

`sync/merge.rs` routes a canvas here when any of the three versions parses as
a canvas with an `INK_FIELD` key. It checks the parsed object, not the text,
so a node whose text says `"wfInk"` does not count. Other canvases take the
plain line merge.

### Excalidraw (`excalidraw.rs`)

- `import_excalidraw(text)` reads an `.excalidraw` JSON file or an Obsidian
  `.excalidraw.md` file (a `compressed-json` block, else a `json` block, plus
  the `## Embedded Files` list). Freedraw, lines and shapes become `wfInk`
  strokes, text becomes text nodes, images become file nodes listed in
  `images` for the caller to upload. Other element types are skipped and
  named in the result's warnings.
- The packed LZ-String data is capped at `LZ_MAX_UNITS` (32 Mi UTF-16 units)
  of output and dictionary, so a few kB of crafted input cannot ask for
  gigabytes.
- `export_excalidraw(&Canvas, images)` writes `.excalidraw` JSON: strokes as
  freedraw (a highlighter at opacity 40), image nodes as images, other nodes as
  text, edges as arrows. What cannot be carried over is listed.

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

- `application/canvas-doc.ts` turns the body into canvas nodes and edges and
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
- `application/canvas-keys.ts`: `canvasKeyAction` maps a key press to delete,
  undo, redo or an arrow nudge (1 px, 10 with Shift). It returns nothing unless
  the canvas is on screen and focused, and never while a card is being edited
  or the key lands in a text field (toolbar fields included). `focusesOnPress`
  says when a press moves focus to the board.
- `application/canvas-history.ts`: undo and redo of whole files, up to 50
  steps. A text edit is one step: it is committed when the edit ends, and the
  toolbar's Undo and Redo end an open edit first.
- `application/freeform-ink.ts`: the TS side of `wfInk`. `encodeStroke` and
  `decodeStroke`; `readInk` reads what Rust writes (no `r`, no `t`);
  `unreadInk` returns the items it cannot read, which `setInk` keeps; the
  eraser's `eraseHits` and the select tool's `strokeAt` (topmost stroke under
  a press).
- `application/freeform-edit.ts`: pure edits on the file (`moveItems`,
  `patchNode`, `removeItems`, `addNode`, `addStroke`). Ids may be nodes or
  strokes.
- `application/excalidraw-transfer.ts`: `importDrawing` and `exportDrawing`
  around the core's Excalidraw calls. Import decodes each picture's data URL
  (no `fetch`, so the CSP's `connect-src` does not matter), stores it through
  the page's `store`, points its file node at it, gives any id the page
  already uses a fresh one (edges follow), and appends the drawing's cards and
  strokes after the page's own. Export reads each picture node (by
  `pictureOf`, so notes and papers are never fetched) and embeds it; a picture
  that cannot be read is left out and named in the warnings.
- `application/freeform-geometry.ts`: sizes, zoom limits, `screenToPage` and
  `zoomAt`.
- `application/canvas-doc.ts` also gives `nodeLabel`, a card's spoken name.
- `ui/canvas-editor.tsx` is the surface. A gesture (pan, ink, erase, move,
  resize) belongs to one pointer id; other pointers are ignored until it ends.
  A body shown from the store drops a gesture in progress.
- `ui/canvas-ink.tsx` draws the strokes as SVG paths. A highlighter is
  translucent (`canvas-ink__stroke--highlighter`). Pressure is not drawn.
- `ui/canvas-nodes.tsx` draws the cards. Each card is in the Tab order with a
  `nodeLabel` name; keyboard focus selects it and Enter edits a text card,
  opens a file card, or focuses a group's label or a link.
- `ui/canvas-edges.tsx` draws edges as straight lines between side anchors.
- `index.tsx` exports `LazyCanvasEditor`, a client-only dynamic import.
- The editor workspace hosts it in `editor-workspace/ui/canvas-document.tsx`
  and the Notes page in `vault/ui/vault-screen/page-editor.tsx`.

## Related

- [Canvas (using)](../../using/canvas.md)
- [Editor workspace](editor-workspace.md) creates canvases from the explorer.
- [Sync](sync.md) writes a canvas as a `.canvas` file.
