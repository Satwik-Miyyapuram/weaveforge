---
covers:
  - apps/web/src/features/ink
  - crates/wf-core/src/ink
checked: 2026-11-14
---
# Handwriting

Handwriting is ink: you write, sketch and draw straight onto a page, the way you
would on paper. It suits quick sketches of a figure, a maths working you want to
see as you wrote it, and the margin thinking that never fits in a typed sentence.

## Start writing

1. On the Notes screen, click **New note**.
2. Choose the handwritten option instead of Text, so the body becomes a page.
3. Write with a mouse, a pen or a finger. Press P at any time to get back to
   the **Pen (P)** tool.

## Pens, tools and quick colours

The tools sit in a row on the bar: **Select (V)**, **Pen (P)**, **Highlighter (H)**,
**Eraser (E)** and **Lasso (L)**. Each tool's letter is in its name, so the key
is always on screen.

Five quick colours sit on the bar, one tap each. The pen's full palette is behind
the colour swatch: open it and you get the theme colours, the marker colours and
the nib sizes. Picking a new colour there replaces the quick colour you were using, unless that
colour is already on the bar. The choice is kept on this device.

Nib sizes are 0.1, 0.3, 0.5 and 0.7 mm for the pen. The highlighter comes in 3,
4.5, 6 and 9 mm, so it lays a wide band of colour under your words.

Keys 1 to 6 pick one of the six theme colours in palette order, so you do not
need to open the swatch at all.

## Selecting strokes

Pick the **Lasso (L)** tool and draw a loop around the strokes you want. A small
chip appears at the top right of the selection with three buttons: one copies
the strokes so you can paste them into any note, one copies their recognised
text, and one deletes them.

Press Delete or Backspace to remove the selected strokes. Press Esc to clear the
selection without deleting anything.

## Undo and redo

**Undo** and **Redo** sit on the bar. Ctrl+Z steps back one change; add Shift
(Ctrl+Shift+Z) to step forward again. When the bar is too narrow, both move into
**More ink options** as a row called **Undo · Redo**, and the shortcuts still
work.

## Figures

A figure is a picture placed on top of the paper: a photo, a screenshot or a
diagram you already have. It is not ink, so anything you write over a figure stays
ink and leaves the picture alone. A pen writes over a figure (unless **Select (V)** is on), while a
mouse dragged inside a figure moves it.

To add one, click **Insert**, then **Image from file…**. You can also drop a
picture onto the page or paste one. Big pictures arrive shrunk so that they fill
at most half the page's width and height, and they are centred where they land.

Click a figure to select it. Handles appear round it: drag the middle to move it,
and drag a corner to resize it. Arrow keys nudge the selected figure by 1 mm, and
Shift with an arrow key moves it 10 mm.

With a figure selected, its toolbar gives you the things a drag cannot say:

- **Crop** trims the picture. Drag the marks to choose what to keep, then press
  **Done**, or **Cancel** to keep the original. Double-clicking the figure also
  opens the crop.
- **Bring forward**, **Send backward**, **Bring to front** and **Send to back**
  change which figure sits on top.
- **Remove** takes the figure off the page.

## Handwriting recognition

Press **Recognise** on the bar, or Ctrl+Shift+R, to read the handwriting on the
current page. The recognised lines land in a text column beside the page. If you
correct a line in that column, it is marked as certain and saved.

Recognition needs a handwriting engine. Where this copy of WeaveForge does not
have one, the column says so and your page is left as it is.

## Paper, printing and exporting

Open **More ink options** to change the look of the page. Under **Paper** you can
pick **Blank**, **Dotted**, **Ruled**, **Grid** or **Wide**. Under **Page spacing**
you can pick **None**, **Small** or **Large**, which puts a gap between pages.

Under **Print** there are two layouts, both on A4:

- **Without comments** fits each page to the sheet, in portrait.
- **With comments** lays the comments beside each page, in landscape.

**Print or save as PDF** (Ctrl+Shift+P) opens a preview first, so you can look
over the pages before anything reaches the printer.

**Full-page PNG** (Ctrl+Shift+E) saves the page as a picture. It is sharp enough
to print, at about 508 dpi on A4. **Vector SVG** (Ctrl+Shift+G) saves the page as
a drawing you can scale without blur.

## Keyboard shortcuts

On a Mac, Ctrl means ⌘.

| Keys | What it does |
| --- | --- |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |
| Ctrl+Shift+R | Recognise this page |
| Ctrl+Shift+P | Print or save as PDF |
| Ctrl+Shift+E | Full-page PNG |
| Ctrl+Shift+G | Vector SVG |
| Ctrl+= or Ctrl++ | Zoom in |
| Ctrl+- | Zoom out |
| Ctrl+0 | Reset the zoom |
| P | Pen |
| H | Highlighter |
| E | Eraser |
| L | Lasso |
| S | Shape tool |
| V | Select: the pen points instead of writing |
| 1 to 6 | Pick one of the six theme colours |
| Delete or Backspace | Delete the selected strokes |
| Esc | Clear the selection |

## Good to know

- Pen nibs come in 0.1, 0.3, 0.5 and 0.7 mm.
- Highlighter widths are 3, 4.5, 6 and 9 mm.
- Keys 1 to 6 map to six colours; the bar keeps five quick colours.
- A PNG export is about 508 dpi on A4.
- A picture placed as a figure starts at most half the page in each direction.
- An arrow key nudges a selected figure 1 mm; with Shift, 10 mm.
- Shortcuts are ignored while you are typing in a text box.

## Stuck?

_My pen moved a picture instead of writing._
A mouse dragged inside a figure moves it. A pen tip always writes, so use the
pen over the figure, and keep the mouse for moving pictures.

_I pressed P and nothing printed._
A bare P selects the pen. Printing needs Ctrl+Shift+P.

_My shortcuts do nothing._
Shortcuts are paused while the cursor is in a text box. Move the cursor out of
the text box, then try again.

_Recognise says there is no engine._
Recognition needs a handwriting engine, and this copy does not have one. You can
still write, print and export as normal.
