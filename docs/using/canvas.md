---
covers:
  - apps/web/src/features/canvas
  - apps/web/src/features/editor-workspace/ui/canvas-document.tsx
  - apps/web/src/features/vault
  - crates/wf-core/src/canvas
checked: 2026-11-16
---
# Canvas

A canvas is a free-form page, like a page in OneNote. Put text boxes, pictures,
handwriting, note and file cards, web links and labelled groups anywhere on it,
and pan and zoom around it. A canvas is saved as a `.canvas` file in the JSON
Canvas format, the same format Obsidian uses, so a canvas you make here opens in
Obsidian and the reverse. Handwriting is kept in an extra field of the file that
Obsidian does not draw.

## How to

### Create a canvas

Click **New page** in the Explorer header, or **New page here** in the menu of a
folder or notes item. A canvas is a normal entry in the notes tree. You can
rename, move, tag and delete it the same way as a note. A `.canvas` file already
in your notes, for example one imported from an Obsidian vault, opens and saves
as described below.

A canvas opens in the canvas editor on the Notes page. Its card in the Notes list
says "Canvas" where a note shows its first lines. In the editor, a canvas tab and
its breadcrumb end in `.canvas`.

### Modes

The toolbar has four modes. The pressed one is the one in use.

- **Select** moves, selects and resizes things. Drag the empty background to pan.
- **Type** puts a text box where you click, open for typing.
- **Pen** draws on the page. Pick its colour and width (2, 4, 8 or 16 px) in the toolbar.
- **Eraser** removes the strokes it passes over.

### Add things

- **Text** puts a text box in the middle of the view. In Select mode, double-click
  empty space to make one there.
- Double-click a text box to write Markdown in it. Press Escape to finish.
- **Group** adds a labelled frame. Type its label in place.
- **Add file** adds a card for a note, paper or attachment by its path. Pick a
  path from the list or type one. Double-click the card to open that file. If it
  is not in this workspace, the card says so.
- **Add link** adds a card for a web address. Only `http://` and `https://`
  addresses are allowed, and the address opens in your browser.
- **Pictures** are added by pasting an image or dragging one onto the page. A
  picture is shown at its natural size, up to 640 px wide.

### Move and resize

- Drag a card to move it. Shift-click adds to the selection.
- Drag a group to move the cards inside it with it.
- Select a card to show its resize corner, then drag the corner. A picture keeps
  its shape while you resize it.
- A text box grows to fit its text while you edit it.

### Pan and zoom

- Drag the empty background to pan, or drag with the middle mouse button anywhere.
- Scroll to pan.
- Ctrl and scroll zooms around the pointer. The **+**
  and **−** buttons zoom around the middle of the view. The percentage in the
  toolbar shows the zoom.

### Undo, delete and keys

- **Undo** and **Redo** are in the toolbar. Ctrl+Z undoes; Ctrl+Shift+Z or Ctrl+Y
  redoes. A text edit is one step.
- In Select mode, click a stroke to select it, and drag to move it. Shift-click
  adds to the selection.
- Select a card or a stroke, then press Delete or Backspace to remove it.
- The arrow keys move the selection 1 px, or 10 px with Shift.
- These keys act only while the canvas has focus and the screen is on show, and
  never while you are writing in a card or a toolbar field, so editing a card's
  text cannot delete it. Clicking the page gives it focus, unless the click
  lands in a text field.
- Without a mouse: press Tab to reach the page, then Tab again to step through
  the cards. A card selects when it gets focus. Enter starts editing a text
  card, opens a file card, and moves to a group's label or a link card's link.

### Ink

Pen strokes are drawn at the width you picked. A highlighter stroke, for
example one imported from Excalidraw, is drawn see-through. Pen pressure is
saved with each stroke but is not drawn yet, so every stroke has an even width.

### Arrows

Arrows already in a `.canvas` file are drawn as straight lines, with their
colours and labels. You cannot draw or move arrows in the editor yet. Edit them in
Obsidian, or in the file itself.

### Colours

Only the pen has a colour control. A colour already set in the file is shown and
kept. The presets 1 to 6 follow your theme, and a hex colour such as `#e0a030` is
drawn as it is. You cannot change a card's colour here; edit the `.canvas` file in
an editor or in Obsidian.

### Save

Changes save a moment after you stop editing. You do not need a save button.
If the status at the right of the toolbar shows a count of issues, the file has
something the JSON Canvas format does not allow, such as an edge that points at a
node that does not exist. Hover the count to see each issue. If a save fails, the
error shows in the same place.

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
- Handwriting is stored in an extra field that Obsidian does not draw, so strokes
  made here show only in WeaveForge.
- A file that is not valid JSON Canvas does not open. The editor shows the
  error instead, and the file is not changed.

## Limits

- Canvases are for arranging things. For long writing, use a [note](notes.md).
- Pinch to zoom on a touch screen is not supported yet; use the + and − buttons
  or Ctrl and scroll.
