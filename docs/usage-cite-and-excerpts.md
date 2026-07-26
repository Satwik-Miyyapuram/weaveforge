# Using citations, excerpts, and Overleaf export

How WeaveForge connects reading (Zotero) → notes → report writing → LaTeX.

See also: [competitive scan](competitive-scan.md) · [implementation plan](plans/completed/competitive-scan-implementation-plan.md)

---

## Cite while writing

In **Notes**, **Papers** (paper note), and **Report** (section notes):

1. Type `[[` and pick a title, **or** type `@` after a space/punctuation with a few letters of the title.
2. Completions for papers show **Author (year) · Title** when available.
3. Accepting a completion always inserts `[[Exact Title]]` (title match is what the graph and LaTeX export use).

**Jump to** any paper, note, or section: `Ctrl+K` / `Cmd+K`. With an empty query, recently opened targets appear first (project-scoped, stored in the browser).

---

## Annotations from Zotero (under the paper)

1. Configure Zotero in Settings and run **Sync Zotero** on Papers.
2. Highlights / notes are cached on the paper (`metadata.annotations`) and shown as **read-only cards** under the paper note (synced from Zotero — not two-way editable yet).
3. Cards show quote, comment, page, colour, and tags when available.

### Copy quote + cite

On a paper’s annotation list: **Copy quote + cite** puts a blockquote and `[[Paper Title]]` on the clipboard for pasting into a section note.

### Pin to a report section

On an annotation card, use **Pin to section**. Pins live in the `annotation_pins` table (not vault notes).

Open a report section. The **Pinned annotations** pane lists those cards:

- **Insert** appends quote + `[[Paper]]` into the section draft
- **Copy** / **Unpin** as needed

---

## Custom fields and extraction table

On a paper note, **Manage** under Custom fields to define project-scoped fields (`text`, `number`, `select`, `multi_select`, `relation`, `rollup`). Values edit inline on the paper and in a reading-list **Table** view.

On **Lists**, toggle **Tree | Table** on a list. The table flattens member papers (including nested sublists), shows selected columns, edits field cells, and can **Copy markdown** / **Copy CSV** for the report.

Relation fields pick other papers in the project. Rollups (`count` / `values` / `sum` / `avg`) are computed and read-only.

---

## Overleaf / LaTeX export

On **Report → Overleaf**, export a ZIP (`main.tex`, `references.bib`, figures):

- Section-note `[[Paper Title]]` becomes `\cite{key}` when bibliography is included.
- Cite keys prefer, in order:
  1. `paper.metadata.citeKey` (or `citationKey`)
  2. Key inside existing `paper.bibtex`
  3. Better BibTeX-style `Citation Key:` in Zotero `extra` (if stored on the paper)
  4. DOI / arXiv / paper id fallback

Compile in Overleaf with **biber** (biblatex is preconfigured in `main.tex`).

---

## Find related papers

On a paper note (needs DOI or arXiv id): **Find related papers** queries Semantic Scholar recommendations (then citation neighbors). **Add to library** creates the paper locally. Existing library items (same DOI/arXiv/title) are filtered out.

---

## Papers board

Papers layout toggle: **Cards | List | Board**. Board columns are paper status (`to_read`, `reading`, …).

---

## Graph

The citation graph includes papers, notes, tags, and **report sections**. Wikilinks from vault bodies, paper summaries, and section notes become edges.
