---
covers:
  - apps/web/src/features/vault
  - crates/wf-core/src/vault
checked: 2026-11-21
---
# Notes

A note is a short piece of writing you keep in your project: a derivation, a
quote, an idea you want to come back to. The Notes screen lists your notes, and
opens one at a time. Notes link to each other with `[[wikilinks]]` and tags
with `#hashtags`.

## How to

### Create a note

1. On the Notes screen, click **New note**.
2. WeaveForge makes a note titled `Untitled`. If that title is taken, it picks
   a unique title.
3. The note opens with its title selected, so you can type over it.
4. Write in the body. Start with **Text**, or switch to **Ink** for a handwritten
   note; [Handwriting](ink.md) shows how to write on the page.

Ink is kept in your workspace folder. With no folder open, a note takes no
ink: it says so and shows an **Open folder** link to the workspace settings.

### Create a note from a link

1. In a note, write `[[Some title]]` for a title that does not exist yet.
2. Click the link. WeaveForge creates a note with that title and opens it.
3. A link finished while you type creates the note without opening it.
4. If a note with the same title already exists, the link reuses it.

### Import notes

1. Drag `.md` files or a `.zip` onto the list, or click **More**.
2. Choose **Import zip…** or **Import folder…**.
3. The result line reads, for example, `Imported 3 notes, 1 folder.`

To bring in a OneNote section instead, choose **Import OneNote section…** in the
same **More** menu. See [Import a OneNote section](onenote-import.md).

### Find a note

1. Type in the **Search notes** box to search titles and text.
2. Open the **Lists** or **Tags** filter beside the list and pick values. **Tags** appears
   once a note has a tag. Click **Clear** to remove the chosen values.
3. If nothing matches, click **Clear filters**.

### Rename a note

1. Open the note. The title is an input while you are in **Text** mode.
2. Change the title and press Enter, or click outside the title.
3. Press Escape to put back the old title.
4. An empty title is not saved. The old title comes back.

Links to the note follow the new title. In your other notes, `[[Old]]`,
`[[Old|alias]]` and `[[Old#heading]]` become `[[New]]`, `[[New|alias]]` and
`[[New#heading]]`. Links inside code (a code block or `` `code` ``) are left
alone.

A note open for editing (in **Text** or **Ink** mode, or in an Editor tab) is
skipped, so your typing is never overwritten. The toast then lists the notes
whose links still use the old title. Update those by hand.

### Delete a note

1. Open the note and click **Delete note**. You go back to the list at once.
2. The toast shows `"<title>" deleted` with **Undo**.
3. Click **Undo** before the toast closes to keep the note.
4. When the toast closes, or you click its close button, the note is deleted.
   With no workspace folder open, it is then gone for good. With a folder
   open, the note's `.md` file and its ink pages move to the workspace trash
   (`.weaveforge/trash/<day>/`), where you can still get them back.
5. If the delete fails, the note comes back and a toast says so.

### When two places save at once

If someone else saves the same note while you do, the two texts are merged. If
they overlap, your text is kept and theirs appears in the list as
"<title> (conflict copy <date> <time>)". See
[a note or canvas edited in two places](sync.md#a-note-or-canvas-edited-in-two-places).

This also holds for two tabs of the web app open in the same browser. Their
saves take turns, so one tab never writes over what the other just saved.

### A note saved in an older text encoding

WeaveForge reads notes as UTF-8, the encoding almost every app uses today. A
note another app saved in an older encoding, such as Latin-1, still opens on
the desktop app. Letters that are not valid UTF-8, often accented ones, show
as `�`. When you save, the note is written back as UTF-8 with those `�` marks
in it. To keep the letters, convert the file to UTF-8 in your text editor
before you open it in WeaveForge.

### Remove a shared note from your library

1. A note shared with you can be pinned to your library.
2. On its card, choose the delete action. It reads **Remove from library**.
3. This unpins the note. It does not delete the note for its owner.

### Work with tags

1. Write `#tag` in the body. WeaveForge reads it as a tag.
2. In **Read** mode, remove a tag with its chip. This deletes the `#tag` text
   from the body.

## Reference

### Buttons and labels

| Label | Where |
|---|---|
| **New note** | Head of the list, and the empty state |
| **More** | Head of the list. Opens the import and wiki items |
| **Import zip…** | **More** menu |
| **Import folder…** | **More** menu |
| **Wiki** | **More** menu. Opens the wiki |
| **Search notes** | Search box in the head |
| **Lists**, **Tags** | Filter row beside the list. A filter with no values is hidden |
| **Clear** | Filter row, once a filter value is chosen |
| **Clear filters** | Empty state after a filter matches nothing |
| **Delete note** | Note bar, and the card action |
| **Remove from library** | Card action on a note shared with you |
| **Open in editor** | Note bar. Opens the full Editor |
| **Undo** | Delete toast |

### Messages

| Text | When |
|---|---|
| `No notes yet` | The list is empty. Body: "Notes are where the reading becomes yours…" |
| `No notes match the filter.` | Search or filters match nothing |
| `Nothing written yet.` | Empty note, read-only |
| `Nothing written yet. Start typing — #hashtags and [[wikilinks]] join this note to the graph.` | Empty note you can edit |
| `No note links here yet. Write [[<title>]] in another note and it shows up here.` | Backlinks section is empty |
| `Imported N notes…` | After an import. Lists folders, renamed and skipped counts |
| `Drop .md files or a .zip to import notes` | Drop zone on the list |
| `Loading notes…` | Screen is loading |
| `Opening note…` | A note is opening |
| `"<title>" deleted` | Delete toast |
| `Note deleted, but its file stays in the workspace folder: <reason>` | The note was deleted, but its file could not be moved to the workspace trash. An import does not offer it back unless the file is edited in the folder |
| `Renamed, but links in N notes still use the old title: <titles>` | A rename could not update every link, for example in a note open for editing. Lists up to five titles, then "and N more" |
| `Open a workspace folder to see this note's ink. On the desktop, ink is stored in the folder.` | A note with no workspace folder open, with an **Open folder** link |
| `Someone else changed this note at the same time. Your text was saved; theirs is kept as a conflict copy beside it.` | Two places saved the same note and the texts overlapped |

### Sections on an open note

| Section | Shows |
|---|---|
| **Pages** or **Text** | The body. **Pages** for an Ink note, **Text** otherwise |
| **Record** | Created and Edited dates, Words, Links from here, Links here, Tags |
| **Links here** | Notes that link to this note |

### Lists on the screen

| Heading | Shows |
|---|---|
| **Pinned** | Your notes that are pinned |
| **Shared with you** | Notes shared with you and pinned to your library |

### Modes

| Mode | Who sees it |
|---|---|
| **Text** | You, when you can edit the body |
| **Ink** | You, when you can edit the body. A handwritten note opens here |
| **Read** | People without edit rights. The Text and Ink switch is not shown |

A handwritten (Ink) note, or a shared note, cannot change its title on this screen.

## How it works

The Notes screen is `apps/web/src/app/notes/page.tsx`, which renders
`VaultScreen`. The UI lives in `apps/web/src/features/vault/ui/`. Logic is in
`apps/web/src/features/vault/application/` and `domain/`. Delete and undo use
the toast store in `apps/web/src/lib/toast/`.

Note logic in the Rust core is in `crates/wf-core/src/vault/`. It handles page
queries, link resolution and template work.

## Related

- [Canvas](canvas.md) — a board of notes, files and links in the same tree
- [Papers](papers.md) — papers you cite from a note
- [Citations, excerpts and Overleaf](citations-and-overleaf.md) — using notes and papers in the report
- [Search](search.md) — finding notes and papers
- [Wiki](wiki.md) — reading notes and papers together
- [Sharing](sharing.md) — sharing a note with others
