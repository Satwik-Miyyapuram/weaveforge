# Graph

The graph screen (`/graph`) draws your papers, notes and report sections as dots,
and the relations between them as lines. You link two papers by hand, or let
WeaveForge find citations between them. Click a dot to see its details.

## How to

### Link two papers by hand

1. Open **Graph**. Click **Link papers**. The dialog is titled "Link papers".
2. In **From**, pick a paper. The first option reads **Pick a paper…**.
3. In **Relation**, pick a relation kind (see the table in Reference).
4. In **To**, pick the other paper.
5. The sentence under the fields shows the link, for example "‹from› cites ‹to›".
6. Click **Link**. The button reads "Linking…" while the link is saved. A toast reads "Linked".

### Find citations between your papers

1. Open the **More actions** menu next to **Link papers**.
2. Click **Auto-link citations**. The menu item has the tooltip "Create citation links from paper bibliographies".
3. The page shows the result. It reads "Added N citation edge(s)." or "No new citation edges found among your papers."

To do this for one paper, open it in the side panel and click **Auto-link citations**.

### Open a paper's relations

1. Click a paper dot. The side panel opens with the title and authors.
2. The **Relations** list shows each link from that paper. The phrase on each row reads from this paper's side. For example, a paper that is cited shows **Cited by**.
3. Click the other paper's name in a row to move to it.
4. Click **Open in Papers** to open the paper on the **Papers** screen.

### Delete a relation

1. Open the paper's side panel, or click a line on the graph.
2. In the side panel, click the close button on the relation row. Its tip reads "Delete relation".
   On a line, click **Delete relation**.
3. The line leaves the graph at once. A toast reads "Relation deleted" with **Undo**.
4. Click **Undo** to keep the relation. The delete runs when the toast closes.

### Look at one paper's neighbourhood

1. Click a paper, a tag (`#tag`), a note or a report section.
2. The graph shows only the items within a few links of it. The banner reads "Local graph · depth N".
3. In **Graph settings**, move the **Depth** slider from 1 to 3.
4. Click **Show all** on the banner, or **Show all papers** in the settings, to go back.

### Filter the graph

1. Click **Graph settings** (the gear icon on the graph bar).
2. On the **Filters** tab, use the tag and list filters, or the **Search nodes…** box.
3. Use **Relation types** to choose which kinds of line are drawn. **All** turns every kind on. **Cites only** keeps only citations.
4. Click **Clear filters** if nothing matches.

### Export the visible papers

1. Open **Graph settings**, then the **Actions** tab.
2. Click **Export visible papers (.md)**. The file is named `graph-papers.md`.

## Reference

### Relation kinds

| Kind | Label on the screen | Read from the other paper |
|---|---|---|
| `cites` | Cites | Cited by |
| `extends` | Extends | Extended by |
| `contradicts` | Contradicts | Contradicted by |
| `similar` | Similar | Similar |
| `builds_on` | Builds on | Built on by |
| `uses_method` | Uses method | Method used by |

Labels come from `crates/wf-core/src/enum_label.rs`.

### Relation sources

A relation made by **Auto-link citations** is marked "(auto)" in the side panel and drawn as a dashed line when **Dashed auto edges** is on. A relation you add in **Link papers** has no marker.

### Edge modes

**Graph settings**, **Appearance**, **Edges**:

| Label | Draws |
|---|---|
| Cites | relation lines only |
| Tags | tag links only |
| Both | relation lines and tag links |

### Limits

| Item | Limit |
|---|---|
| Local graph depth | 1 to 3 (the **Depth** slider) |
| Relations listed in a paper's side panel | 8, then **Show all N** |
| Tags in a tag's **Co-occurring** list | 12 |
| Node labels on the canvas | cut at 28 characters, ending in "…" |
| Paper names in the side panel | cut at 40 characters, ending in "…" |
| Colour groups | 12 |

**Link papers** needs at least two papers.

### Messages

| Message | When |
|---|---|
| Add at least two papers to link them | the **Link papers** button tooltip, with fewer than two papers |
| Add at least two papers before linking them. | the **Link papers** dialog, with fewer than two papers |
| Pick both papers. | **Link** with a missing paper |
| A paper can't relate to itself. | **From** and **To** are the same paper |
| Linked | a relation was saved |
| Relation deleted | a relation was deleted (toast, with **Undo**) |
| Nothing to link yet | the graph has no papers, notes or sections |
| No items match the filter. | filters hide everything |
| Brave detected. | Brave Shields block clicks on the canvas; the warning can be dismissed |

## How it works

The graph is built by the Rust core (`wf-core`). It reads the papers, notes,
report sections, relations and reading lists, and returns the nodes and links.
The TypeScript screen only draws them and passes clicks back.

An edge is drawn only when both of its papers are on screen. So a relation
hides when a filter hides one of its papers, or when that paper no longer exists.

Source: `crates/wf-core/src/relations/` (graph build, local graph, tags, colours,
sizing, relation phrases), and `apps/web/src/features/relations/` (screen, canvas,
side panel, link form, settings drawer).

## Related

- [Papers](papers.md) — adding and managing the papers in the graph
- [Citations, excerpts and Overleaf](citations-and-overleaf.md) — citations in notes and the report
- [Search](search.md) — finding items by title
- [Notes](notes.md) — notes and the links they make
