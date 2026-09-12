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
