---
covers:
  - apps/web/src/features/vault/application/onenote-import.ts
  - apps/web/src/features/vault/ui/vault-screen/vault-screen.tsx
  - crates/wf-core/src/onenote
checked: 2026-11-17
---
# Import a OneNote section

You can bring a OneNote section into WeaveForge. Each page in the section
becomes one free-form page, a [canvas](canvas.md), so it looks like the page
did in OneNote: text sits where it sat, pictures stay in place, and your
handwriting comes across as pen strokes you can still move, erase and draw
over.

## How to

1. In OneNote, get the section's `.one` file. A section is one tab of a
   notebook. Export or copy the section file to your computer.
2. In WeaveForge, open **Notes** and click **More** at the head of the list.
3. Click **Import OneNote section…** and pick the `.one` file.
4. When the import ends, a line reads, for example,
   `Imported 3 pages, 2 images, 1 warning.`

The pages appear in the notes list. Each one is a canvas you can open, edit,
rename, move and delete like any other page.

## What you get

- **One page per OneNote page.** The page's title is its OneNote title.
- **Nested pages.** A page that sat under another page in OneNote is nested
  under it in the list, so the structure is kept.
- **Typed text** becomes text boxes at the places they were on the page.
- **Pictures** appear as picture cards at their places. A picture that could
  not be placed is stacked below the rest of the page.
- **Handwriting** comes across as pen strokes. A highlighter stroke stays a
  highlighter. Text that OneNote recognised from your handwriting is not added
  again, because the strokes already show it.
- **Printed or scanned pages** that you wrote on in OneNote come across as a
  picture behind the handwriting, so the strokes sit on the page they were
  written on.

## When something is left out

- A picture that cannot be saved is skipped. The page still imports without
  it, and the problem is logged as a warning in the app's log.
- Files attached to a page, such as PDFs or Office documents, are not imported.
  Open them in OneNote if you need them.
- Only one section at a time. A whole notebook is not read in one go; import
  each section file.
- A picture's alt text (the description OneNote keeps for it) is not kept.
- A picture inside a table is left out. The table's text is kept.

## Good to know

- The import adds pages to your notes. It does not change or remove pages you
  already have. If a page has the same name as one in your notes, the new page
  gets a different name.
- The import works on section files up to 64 MB. A picture over 20 MB is not
  imported.
- If the import stops part way because a page could not be written, the pages
  it had already made are removed again, so no half-imported section is left.
  Your existing pages are not touched.
- Handwriting is kept as ink strokes. Pressure is stored but not drawn yet, so
  strokes look the same at every pressure.

## Related

- [Canvas](canvas.md): how the free-form pages work.
- [Notes](notes.md): the notes list and its import options.
