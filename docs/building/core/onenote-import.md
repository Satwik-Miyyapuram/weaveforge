# OneNote import core module

The `onenote` module turns one OneNote section file (`.one`) into WeaveForge
freeform pages. It reads the file with the `onenote_parser` crate and hands back
plain data: each page's outline pieces (text and pictures) with their positions,
the pictures as bytes, and the handwriting as ink sheets with their origin on
the OneNote page. It has no network or database code. The app passes the file's
bytes in and creates the pages itself.

Each OneNote page becomes one canvas (`kind: "canvas"`, see
[canvas.md](canvas.md)). Typed text becomes text nodes at their OneNote
positions, pictures become file nodes, and handwriting becomes strokes in the
canvas's top-level `wfInk` field.

## What lives in Rust

- `crates/wf-core/src/onenote/mod.rs`: `import_section(bytes, file_name)` and
  `freeform_page_text(layout, files, ink)`.
  - Walks the section's pages in order. A page that fails to convert adds a
    warning instead of stopping the import.
  - `page_layout` turns each outline element into an `OneNoteLayoutItem`: a
    `text` item carrying its Markdown, or an `image` item keyed by the
    picture's name.
  - `placement` converts OneNote's offsets and sizes into 0.1 mm. A value that
    is missing or not finite stays missing, so the item has no place on the
    page.
  - Keeps links only for `http`, `https` and `mailto`. Other links stay as
    plain text.
  - Moves page indent levels so the shallowest page is level 0.
  - Rejects files over `ONENOTE_MAX_BYTES` (64 MiB) and pictures over 20 MiB.
  - Turns an attached file into a line that says it was not imported.
  - `freeform_page_text` places each ink sheet's strokes at the sheet's origin
    and hands everything to `freeform_canvas`.
- `crates/wf-core/src/onenote/freeform.rs`: builds the canvas.
  - `freeform_canvas(layout, files, strokes)` writes the JSON Canvas text. A
    text item becomes a text node. An image item becomes a file node whose
    `file` is the vault path from `files`; an image with no vault path is
    dropped.
  - Coordinates are canvas pixels. OneNote's 0.1 mm values scale by `48 / 127`
    (one half inch is 48 px, and a half inch is 127 tenths of a mm).
  - Items with no geometry stack in a column under the bottom of the placed
    items, with a 48 px gap, so they do not overlap placed content.
  - `ink_strokes(origin, page, id_prefix)` turns an `InkPage` into
    `FreeStroke`s (`id`, `x`, `y`, `w`, `c`, `t`, `p`, `r`). Each point is a
    flat tenths-of-px offset from the stroke's start, pressure is 0 to 255, and
    a highlighter stroke keeps its tool.
- `crates/wf-core/src/onenote/ink.rs`: handwriting placement.
  - Places strokes from their outline and ink offsets, in 0.1 mm, and groups
    them into sheets by printout. Each sheet records its origin
    (`origin_x`, `origin_y`) on the OneNote page.
  - `colour_hex` maps OneNote colours to hex colours.
- `crates/wf-core/tests/onenote_import.rs`: integration tests on a sample
  section in `tests/fixtures/onenote/`.

## How the app calls it

`crates/wf-wasm/src/onenote.rs` exports two functions:

- `importOneNoteSection(bytes, fileName)` returns `OneNoteSection { name, pages,
  warnings }`. Each page has `title`, `level`, `markdown`, `images` (name, alt
  text, base64 bytes), `ink` (`OneNoteInkPage { page, background, originX,
  originY, text }`) and `layout` (`OneNoteLayoutItem`s).
- `oneNoteFreeformText(layout, files, ink)` returns canvas text. `files` maps
  each image name to its vault path, and `ink` is the page's ink sheets.

The freeform path reads `layout`, `images` and `ink`. It does not read
`markdown` or an ink sheet's `text`, because the outline text is already in
`layout`.

`apps/web/src/features/vault/application/onenote-import.ts` creates the pages:

1. One canvas per page, nested by page level. There is no page for the section
   itself. Titles are planned with `planImportTitles`, which keeps them unique
   against the vault's existing titles.
2. Each picture that an image item places is uploaded under its canvas. A
   failed upload adds a warning (`Image X on "Page" not imported`) and the
   picture is left out; the rest of the page still imports.
3. The page's text and ink are built with `oneNoteFreeformText`, normalised
   with `normalizeCanvasText`, and written to the canvas body.

The UI entry is **Import OneNote section…** in the notes More menu
(`apps/web/src/features/vault/ui/vault-screen/vault-screen.tsx`).

## What stays in TypeScript, and why

- **Creating pages and uploading pictures.** These are database and storage
  writes, so they stay with the vault facade.

## Limits

- Only one section (`.one`) at a time. A whole notebook (`.onetoc2`) is not
  read.
- Attached files (PDFs, Office files) are not imported.
- Handwriting inside a table cell is not collected.
- Alt text is not kept. A canvas file node has no alt field, so a picture's
  alt text is dropped.
