# Workspace explorer, VS Code style — plan

Requested 2026-09-13. The desktop editor's left panel and tab strip get the
VS Code arrangement: creation and renaming happen in the tree, the panel can
be put away, rows can be dragged, and the strip's controls stop scrolling
with the tabs. Papers open their PDF in the pane rather than on a separate
route.

## 1. Rules

| Section | New file | New folder | Rename | Drag to move |
|---|---|---|---|---|
| Notes | yes (note or ink note) | yes — a folder *is* a note with children, so "folder" makes a note | yes | yes, any note under any note or to the root |
| Papers | no | no | no | no |
| Report | yes (a section) | no | yes | yes, only within Report |

Target of "new file" from the head buttons or `⌘N`: the folder of the
document on screen when it is a note (or section, for a section); otherwise
the Notes root. Never Papers.

## 2. Inline create and rename

- A head button, a hover button on a Notes/Report row, or `⌘N` inserts a
  *draft row* under the target, indented as a child, holding a text box.
  Enter creates; Escape or blur with nothing typed cancels. The row's folder
  opens so the draft is visible.
- `F2` or a slow second click on the label edits it in place. Enter saves
  through `manageVaultPage.update({ title })` / `manageReportSection.setTitle`;
  a duplicate title shows the use case's message under the row.
- The centred `NewDocumentDialog` goes. The `folders` list it needed goes with it.

## 3. Drag and drop

Rows carry `application/x-weaveforge-node` = `kind:id`. A row of the same
section accepts a drop (a note onto a note or the Notes root; a section onto
a section or the Report root), except onto itself or its own descendant —
that would loop the parent chain. The drop calls
`manageVaultPage.update(id, { parentId })` (new field) or
`manageReportSection.setParent`, then the tree reloads.

## 4. Panel

- `⌘B` / a strip button hides the explorer; the width goes to 0 and a thin
  "show" handle stays at the edge. Persisted in `localStorage`
  (`weaveforge.explorer.hidden`).
- Collapse all / Expand all buttons removed; `collapseAll`/`expandAll`
  stay in `explorer-state.ts` for the tests and any future command.
- Head stays one row; the filter stays.

## 5. Tab strip

- `.pane-tab-actions` leaves the scrolling flex row: the strip becomes a
  two-column grid — scrolling tabs, then the pinned actions.
- An ink tab shows neither Edit/Read (it has one view) nor the image button;
  its own bar handles insertion. The ink bar's "Insert PDF page" becomes
  "Insert page from PDF or image": an image file becomes a page whose
  background is the image, through the same path a PDF page takes.

## 6. Papers: the reader in the pane

- A paper tab gets a third mode, `pdf`, beside Edit and Read. It renders
  `PaperPdfPane` — the paper half of `ReaderScreen` (source ladder,
  annotations load/save, `PdfReader`) lifted into its own component, which
  `ReaderScreen` then uses too, so the route and the pane share one path.
- "Load PDF" in the pane's tools picks a local file and writes its bytes to
  the reader's IndexedDB byte cache under the paper id — the cache is the
  first rung of the ladder, so the paper opens from it from then on, on the
  route and in the pane alike.

## 7. Order of work

1. Core: `parentId` on `EditVaultPageInput`; `setTitle`/`setParent` on
   report sections. Tests.
2. Explorer: remove collapse/expand buttons, hideable panel, pinned strip
   actions, ink tab chrome.
3. Inline create + rename; delete the dialog.
4. Drag and drop.
5. Ink image page.
6. Paper PDF mode + Load PDF.
7. Build, install, drive with CDP, log rows.
8. The three asks below, landed between 5 and 6.

## 8. Added mid-flight

Three asks that arrived while the above was being built, and where they went.

### 8.1 PDFs live in the folder; the web copy fetches online

- `IPdfByteCache` gets a second implementation, `WorkspacePdfStore`, over the
  workspace folder at `papers/pdf/<id>.pdf` (`paperPdfPath` in core). The
  reader's shared cache is a `RoutedPdfByteCache`: the folder store when a
  folder is open, IndexedDB otherwise. Nothing above the cache changes — the
  ladder's cache rung is the same rung, it now reads from disk on desktop.
- `downloadLibraryPdfs` walks the library once a folder is adopted and pulls
  every paper's PDF through the same ladder, three seconds apart, into the
  store. Held papers are skipped; a paper with no source is skipped. The
  desktop build therefore opens PDFs from disk, offline included; the web
  build fetches when the cache is cold and keeps up to 32 in IndexedDB.
- "Load PDF…" (§6) writes to the same cache, so a user-supplied PDF lands in
  the folder on desktop.

### 8.2 A pan at zoom keeps the ink

- The canvas was the size of the page in CSS pixels, so at 4× it was a
  surface the compositor re-tiled on every scroll, and the tiles arrived
  after the strokes disappeared. The canvas is now a window: `.ink-sheet`
  is the page's full box (paper is its background, and it is what scrolls),
  and `.ink-canvas` inside it is `position: sticky`, sized to the scroller's
  client box, never larger.
- The camera offset is where the sheet's corner sits relative to the canvas,
  in CSS pixels, re-sent on every scroll (one message, no re-raster). The
  WebGL shader, the canvas2d transform and `boundsToClip` all read the same
  offset, scaled by dpr at the edge. `project` uses the sheet's rect and the
  page's own size, so an older, non-A4 page still projects correctly.

### 8.3 Every page is A4

- An inserted page — a PDF page or an image — is placed on a white A4 sheet
  (1654 × 2339 px at 200 dpi), fit inside and centred (`placeOnSheet`), and
  the page's size is `INK_A4_WIDTH × INK_A4_HEIGHT`. Print later is one
  page per page, no scaling surprises.
