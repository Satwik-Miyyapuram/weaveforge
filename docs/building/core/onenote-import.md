# OneNote import core module

The `onenote` module turns one OneNote section file (`.one`) into WeaveForge
notes. It reads the file with the `onenote_parser` crate and hands back plain
data: each page's text as Markdown, its pictures, and its handwriting as ink
pages. It has no network or database code. The app passes the file's bytes in
and creates the notes itself.

## What lives in Rust

- `crates/wf-core/src/onenote/mod.rs`: `import_section(bytes, file_name)`.
  - Walks the section's pages in order. A page that fails to convert adds a
    warning instead of stopping the import.
  - Builds Markdown from each outline: paragraphs, bullet lists by indent,
    pipe tables and image references (`![alt](image-1.png)`).
  - Keeps links only for `http`, `https` and `mailto`. Other links stay as
    plain text.
  - Escapes a line that would otherwise start a heading, quote or list.
  - Moves page indent levels so the shallowest page is level 0.
  - Rejects files over `ONENOTE_MAX_BYTES` (64 MiB) and pictures over 20 MiB.
  - Turns an attached file into a line that says it was not imported.
- `crates/wf-core/src/onenote/ink.rs`: handwriting to `InkPage`s.
  - Places strokes from their outline and ink offsets, in 0.1 mm units.
  - Maps OneNote colours to the nearest WeaveForge ink colour.
  - Treats a translucent stroke as a highlighter.
  - Groups strokes by printout: each background image is a band, and a
    stroke goes to the band its middle falls in. Each band is one ink page
    (more if it has over `INK_PAGE_STROKE_BUDGET` strokes), with the printout
    placed as its background.
- `crates/wf-core/tests/onenote_import.rs`: integration tests on a sample
  section in `tests/fixtures/onenote/`.

## How the app calls it

`crates/wf-wasm/src/onenote.rs` exports `importOneNoteSection(bytes, fileName)`.
It returns a `OneNoteSection { name, pages, warnings }`. Each page has `title`,
`level`, `markdown`, `images` (name, alt text, base64 bytes) and `ink`, a list
of `OneNoteInkPage { page, background, text }`. `background` is the printout's
image name and its box on the page; `text` is the typed text of that band. A
page with ink has an empty `markdown`, so its typed text is not imported
twice. OneNote's recognised handwriting text is dropped: the strokes are the
handwriting.

`apps/web/src/features/vault/application/onenote-import.ts` creates the notes:

1. One note per page, nested by page level, with no note for the section.
2. Each picture uploaded as a vault attachment, and its reference replaced
   with the attachment's path.
3. A page with handwriting is one ink note instead of a text note. Each ink
   page's printout is drawn at its box on a transparent page
   (`composeOnPage`), uploaded, and set as that page's background. A page
   with more than `INK_NOTE_MAX_PAGES` ink pages splits into numbered parts.

The **More → Import OneNote section…** item on the notes list runs it.

## What stays in TypeScript, and why

- **Creating notes and uploading pictures.** These are database and storage
  writes, so they stay with the vault facade.
- **Ink chunk storage.** The ink note's pages are written through the ink
  chunk store, the same one the ink editor uses.

## Limits

- Only one section (`.one`) at a time. A whole notebook (`.onetoc2`) is not
  read.
- Attached files (PDFs, Office files) are not imported.
- Handwriting inside a table cell is not collected.
