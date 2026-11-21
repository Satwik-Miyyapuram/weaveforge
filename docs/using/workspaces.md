---
covers:
  - apps/web/src/features/editor-workspace
  - crates/wf-core/src/editor_workspace
checked: 2026-11-21
---
# The workspace editor

The workspace is where you write. It looks like a code editor: a file explorer
on the left, your open notes as tabs, and as many side-by-side panes as your
screen can hold. Everything in it belongs to the project you have open; to
make, open or switch projects, see [Projects](projects.md).

## How to

### Open a note from the explorer

1. Look at **Files** in the explorer on the left. It shows the project's notes
   and folders as a tree.
2. Click a note. It opens as a tab in the pane you were last working in.

Want the explorer out of the way? Click **Hide explorer**, or press Ctrl+B
(Cmd+B on a Mac). Press it again to bring it back.

Want it wider or narrower? Drag the explorer's right edge. It goes from 180 to
600 pixels wide; double-click the edge to put it back to 260. With the edge
focused, the arrow keys move it a step at a time. The width is kept on this
device.

### Make a new note or folder

1. Click **New note** at the top of the explorer. You can also press Ctrl+N.
2. Type a name for it and press Enter.
3. For a folder instead, click **New folder** and name it the same way.

Press F2 to rename the note you have open.

### Find a note by name

1. Press Ctrl+P (Cmd+P on a Mac). A small search window opens.
2. Type part of the note's name. The list narrows as you type.
3. Press Enter to open the top match, or click any row.

Hold Ctrl while you pick a row, and the note opens in a new pane beside the one
you have. To search inside notes instead of their names, press Ctrl+Shift+F.

### Write next to the preview

1. Open a note.
2. Click **Preview**. The note is shown as it will read, with headings, lists
   and links drawn, and it updates as you type.

Ctrl+E switches the note between writing and reading.

### Put two notes side by side

1. Open the first note.
2. Click **Split right**. A second pane opens to the right. Ctrl+\ does the same.
3. Or click **Split down** to put the new pane underneath.
4. Open another note in the new pane. Drag the line between the panes to
   resize them.

Each pane has its own tabs. Ctrl+W closes the tab you are on, and Ctrl+Shift+T
brings back the last one you closed.

### Hide everything but the text

1. Click **Focus**, or press F11.
2. The rail, the explorer, the tab strip and the status bar go away. Only the
   note is left.
3. Press F11 again to come back.

## Keyboard shortcuts

On a Mac, use Cmd wherever this table says Ctrl. Press Ctrl+/ in the app to see
the same list.

| Keys | What it does |
| --- | --- |
| Ctrl+P | Find a note by name |
| Ctrl+Shift+P | Open the command palette |
| Ctrl+Shift+F | Search inside every note |
| Ctrl+N | New note |
| Ctrl+D | Duplicate the note |
| F2 | Rename the note |
| Ctrl+E | Switch between writing and reading |
| Ctrl+B | Show or hide the explorer |
| Ctrl+Shift+B | Show or hide the sidebar |
| Ctrl+\ | Split right |
| Ctrl+W | Close the tab |
| Ctrl+Shift+T | Reopen the last closed tab |
| Ctrl+Tab | Next tab |
| Ctrl+1 to Ctrl+8 | Go to tab 1 to 8; Ctrl+9 goes to the last tab |
| F11 | Focus: only the note |

## Good to know

- Your panes, and whether the explorer is open, are remembered on this computer.
  They come back the next time you start the app.
- Shortcuts that change text are ignored while you type in a form field, such
  as a search box. In the editor itself, they work.
- Ctrl+1 to Ctrl+8 only take effect when the pane has that many tabs. Otherwise
  your browser keeps the keys for itself.

## Stuck?

*The explorer is gone.*
Press Ctrl+B, or leave focus mode with F11.

*Ctrl+P does nothing.*
Click inside the workspace first, so the app has the keyboard, then try again.

*I closed a tab by mistake.*
Press Ctrl+Shift+T. The last closed tab comes back.

## Related

- [Projects](projects.md)
- [Notes](notes.md)
- [Search](search.md)
- [Workspace folder](workspace-folder.md)
- [Organisations](organisations.md)
- [Desktop app](desktop.md)
