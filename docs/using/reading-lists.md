---
covers:
  - apps/web/src/features/reading-lists
  - crates/wf-core/src/reading_lists
checked: 2026-11-13
---
# Reading lists

A reading list is a named group of papers and notes. You make lists on the Lists
screen, nest them as sublists, and keep the reason each group is there. A list is a
view over your papers: removing a paper from a list does not delete the paper.

## How to

### Create a list

1. On the Lists screen, click **New list**. The dialog is titled "New list".
2. Type a name in **List name**. The placeholder is "Disentanglement".
3. Pick a colour from the **Color** swatches. The first swatch is selected by default.
4. Leave **Sublist of** at **None (top level)**, or choose a list to nest this one under it.
5. Click **Create**. The button reads "Creating…" while the list is saved.
6. The dialog closes when the list is saved. The list appears in the left rail.

### Add a paper or note to a list

1. Select the list in the left rail. Its items show on the right.
2. Click **+ Add a paper or note**. The link shows only when a paper or note in the
   project is not yet in this list.
3. Open the dropdown. Its first entry is "Choose a paper or note…". Type to search;
   the search box reads "Search papers and notes…". Papers are under **Papers**,
   notes under **Notes**.
4. Click **Add**. The button reads "Adding…" while it saves. Click **Cancel** to close
   the row without adding.

Items already in the list are not offered, so the picker cannot add the same paper
or note twice.

### Nest a list as a sublist

1. Click **New list**.
2. In **Sublist of**, choose the parent list. Every list in the project is offered.
3. In the parent list, items from its sublists show with a `via` badge that names the
   sublist.

### Reorder or remove items

1. Drag an item by its handle (title "Drag to reorder") onto another item, or use
   **Move up** and **Move down** on the row.
2. **Move up** is disabled on the first item. **Move down** is disabled on the last.
3. Click **Remove from list** to take an item out of this list. This runs at once and
   has no Undo. The paper or note stays in the project and in any other list.

On a list shared with you, these controls are hidden.

### Delete a list

1. Open the card menu on the list header and click **Delete list**.
2. The list disappears at once. The toast reads `"<name>" deleted`. If the list has
   sublists, it reads `"<name>" deleted with N sublist(s)`.
3. Click **Undo** on the toast to bring the list back.
4. The list and its sublists are removed only when the toast closes. The papers and
   notes in them are kept.

On a list shared with you, the menu item reads **Remove from lists**. It removes only
your copy. The toast reads `"<name>" removed from your lists`.

### Screen the papers in a list

1. Open the list and click the view icon named **Screening view**.
2. Pick a stage: **Title & abstract** or **Full text**.
3. Optionally type a reason in the field placeholder "reason". Then click **Include**,
   **Exclude** or **Unsure**.
4. Every reviewer's answer shows on the row. If two reviewers differ, the verdict reads
   **reviewers disagree**.
5. Click **Copy PRISMA figure** to copy a LaTeX figure. Paste it into a report section.

Screening covers only the list's own items. Items inherited from a sublist are not
screened in the parent.

### Compare papers in a table

1. Click the view icon named **Table view**. The columns are Title, Year and Status.
2. Use **Columns** to show or hide columns. Project paper fields add more columns.
3. Edit a text, number or select cell in place. A text or number cell saves when you
   leave it. A number that is not a number is reset.
4. Click **Copy markdown** or **Copy CSV** to copy the table.
5. Click **Propose fill** on a field column to copy an agent prompt. Nothing is saved
   until you approve each cell on AI review. The link reads **Open AI review →**.

## Reference

### Required fields

| Field | Rule | Message |
|---|---|---|
| **List name** | Required. A name of only spaces is refused. | Reading list name is required. |

### Labels on a list

| Shown | When |
|---|---|
| `Empty` | The list has no papers or notes. |
| `3 papers, 1 note` | Counts of the list's own papers and notes, with plurals. |
| No papers or notes in this list yet. | The list has no items. |
| `2 lists · 1 sublist` | The Lists screen header, counting top-level lists and sublists. |
| No reading lists yet | The project has no lists. |

### Screening

| Label | Meaning |
|---|---|
| **Title & abstract** | The first screening stage. |
| **Full text** | The second screening stage. |
| **Include** / **Exclude** / **Unsure** | Your decision on one item. |
| `undecided` | No reviewer has decided. |
| **reviewers disagree** | Reviewers have decided differently. |
| `(1 other reviewer)` | Shown when another reviewer has also decided. |
| Nothing in this list to screen yet. | The list has no items of its own. |

### Messages

| Message | Cause |
|---|---|
| Reading list name is required. | The name is blank once spaces are removed. |
| Sign in to record a screening decision. | No signed-in user. |
| Every paper in this column already has a pending fill — review or reject those first. | **Propose fill** found no paper without a pending fill. |
| Clipboard unavailable: followed by the error | The browser refused the copy. |
| Copied markdown table, Copied CSV | A table copy worked. |
| PRISMA figure copied — paste it into a report section. | **Copy PRISMA figure** worked. |
| Loading reading lists… | The screen is loading. |

## How it works

The screen is in `apps/web/src/features/reading-lists/`. Its components are in `ui/`,
and they reach data only through the app container. The list rules, such as the name
check, are in `crates/wf-core/src/reading_lists/`.

Screening counts and reviewer agreement are computed from the decisions on every
render. Nothing stores a count, so the numbers always match the decisions.

## Related

- [Papers](papers.md) — adding the papers that go into a list
- [Search](search.md) — finding lists and papers by name
- [Sharing](sharing.md) — sharing a list with others
- [AI assistant](ai-assistant.md) — proposing table fills for AI review
