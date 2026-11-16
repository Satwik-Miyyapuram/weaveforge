---
covers:
  - apps/web/src/features/canvas
  - apps/web/src/features/editor-workspace/ui/canvas-document.tsx
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

### Save

Changes save a moment after you stop editing. You do not need a save button.
If the status at the right of the toolbar shows a count of issues, the file
has something the JSON Canvas format does not allow, such as an edge that points
at a node that does not exist. Hover the count to see each issue.

## Obsidian compatibility

- Canvases are plain `.canvas` files, so you can copy them to an Obsidian vault
  and open them there.
- Anything in a `.canvas` file that WeaveForge does not show, such as a node
  colour preset you did not set here or a field added by another app, is kept
  when you save.
- A file that is not valid JSON Canvas does not open. The editor shows the
  error instead, and the file is not changed.

## Limits

- Canvases are for arranging things. For long writing, use a [note](notes.md).
