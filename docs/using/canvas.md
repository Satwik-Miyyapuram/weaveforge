---
covers:
  - apps/web/src/features/canvas
  - apps/web/src/features/editor-workspace/ui/canvas-document.tsx
  - apps/web/src/features/vault
  - crates/wf-core/src/canvas
checked: 2026-11-16
---
# Canvas

A canvas is a free-form board in your notes tree. You place text, notes,
files, web links and groups on it, draw arrows between them, and pan and zoom
around the board. A canvas is saved as a `.canvas` file in the JSON Canvas
format, the same format Obsidian uses, so a canvas you make here opens in
Obsidian and the reverse.

## How to

### Create a canvas

1. In the notes tree, select a folder, then click **New canvas here**. You can
   also click **New canvas** in the explorer header.
2. Name the canvas. It opens in the editor pane.

A canvas is a normal entry in the notes tree. You can rename, move, tag and
delete it the same way as a note.

A canvas also opens in the canvas editor on the Notes page, and its card in the
Notes list says "Canvas" where a note shows its first lines. The card never
shows the canvas's JSON, or tags picked out of it. In the editor, a canvas tab
and its breadcrumb end in `.canvas`.

### Add nodes

The toolbar above the board has these buttons:

- **Text** adds a text node in the middle of the view. Double-click it to write
  Markdown in the note editor.
- **Group** adds a labelled frame. Drag a group and the nodes inside it move
  with it.
- **Note or file…** adds a note, paper or attachment by its path. Pick a path
  from the list, or type one. Double-click the node to open that file.
- **Web address** adds a link node with the address you type.

### Move around

- Drag the empty background to pan.
- Scroll or pinch to zoom.
- Drag a node to move it. Select a node to show its resize corners.
- Drag from one of a node's four side handles to another node to draw an arrow.

### Delete and keys

Select a node or an arrow, then press Backspace or Delete to remove it. The keys
only act while the canvas has focus and the screen is on show, and never while
you are writing in a card, so editing a card's text cannot delete it. Clicking
the board gives it focus, unless the click lands in a text field.

### Colours

The editor has no colour controls, so you cannot set a colour here. A colour
that is already in the file is shown and kept. The presets 1 to 6 follow your
theme, and a hex colour such as `#e0a030` is drawn as it is. To set one, edit
the `.canvas` file in an editor or in Obsidian.

### Save

Changes save a moment after you stop editing. You do not need a save button.
If the status at the right of the toolbar shows a count of issues, the file
has something the JSON Canvas format does not allow, such as an edge that points
at a node that does not exist. Hover the count to see each issue.

### Saving and conflicts

Two places can edit the same canvas, for example two devices or a teammate. A
save is checked against what is stored. If nobody else changed the canvas, your
version is written. If somebody did, the two versions are merged. When the
merge is clean, the merged canvas is written. When it is not clean, or the
merge would not be a valid canvas, your version is saved and theirs is kept as a
copy named "<title> (conflict copy <date> <time>)" beside it. The copy is a
canvas too, so you can open it and move things across. Nothing is thrown away.

While you are editing, a change made somewhere else waits until your save
lands. Then the canvas shows what was stored: the merge, or their version if it
was saved after yours.

If a save fails, for example because you are offline, the editor keeps your
changes and tries again, waiting longer each time up to 30 seconds. If the
canvas keeps changing under you, the save stops with "This note kept changing
while it was being saved; your text is still in the editor." and you can save
again.

### In your workspace folder

With a [workspace folder](workspace-folder.md) connected, each canvas is written
as a `.canvas` file in `notes/`, named after its title, with no frontmatter. You
can edit it in Obsidian and the change comes back in. A canvas you rename in the
folder is matched to its canvas by its content, and its file is never deleted
on the way in. If both sides changed it, see
[a note or canvas edited in two places](sync.md#a-note-or-canvas-edited-in-two-places).

## Obsidian compatibility

- Canvases are plain `.canvas` files, so you can copy them to an Obsidian vault
  and open them there.
- Anything in a `.canvas` file that WeaveForge does not show, such as a field
  added by another app, is kept when you save. Colours set elsewhere are shown
  and kept too (see Colours above).
- A file that is not valid JSON Canvas does not open. The editor shows the
  error instead, and the file is not changed.

## Limits

- Canvases are for arranging things. For long writing, use a [note](notes.md).
