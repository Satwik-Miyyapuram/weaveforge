# Research apps → WeaveForge takeaways

Competitive scan of note / reference / writing / discovery tools for thesis workflows: what they do well, what WeaveForge already covers, and what is worth copying.

**Sources:** product sites & docs for Obsidian (+ ZotFlow), LiquidWorkspace, LiquidText, EndNote 2025, Citavi, Notion, Zotero, Mendeley, Paperpile, Readwise Reader, ResearchRabbit / Litmaps / Connected Papers / Elicit / Semantic Scholar, Logseq/RemNote patterns · WeaveForge inventory from the codebase (including `feat/cite-excerpt-report-tabs`).

**Positioning:** WeaveForge is already a thesis OS (papers + vault + report + graph + Overleaf), not a pure note app or pure reference manager. Steal the mid-layer between reading and writing — excerpts as first-class knowledge items — and the layer *before* reading — finding the right papers — not infinite canvases or Word plugins.

**Build plan:** `[plans/completed/competitive-scan-implementation-plan.md](plans/completed/competitive-scan-implementation-plan.md)` (phased delivery + docs).

---



## Where WeaveForge already stands


| Area               | Shipped today                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| Vault / notes      | Nested markdown pages, import, images, share/comments, wikilinks                                          |
| Papers / Zotero    | Library CRUD, bidir sync, annotation cache, excerpt → vault notes on sync                                 |
| Cite while writing | `[[` and `@` autocomplete → `[[Title]]`; Overleaf export → `\cite{key}`                                   |
| Report / Overleaf  | Section outline, Overleaf link, LaTeX ZIP + bib + figures                                                 |
| Graph              | Papers, notes, tags, report sections, relations + wikilinks                                               |
| Lists / plan       | Reading lists (papers + notes), milestones, logbook, supervision                                          |
| Discovery          | Semantic Scholar edges in graph; **Find related papers** on paper note (recommendations → add to library) |


---



## Product-by-product



### Obsidian (+ Zotero plugins) — steal soon

Local-first markdown vault. Graph, backlinks, wikilinks, plugins. Academic power comes from the Zotero bridge (ZotLit / ZotFlow): embedded PDF reader, templated source notes, annotation sync, cite via `@@` / Pandoc / wikilink, child notes editable in vault.

**What they nail:** Source notes as durable objects · annotation → note pipelines · flexible cite formats · community velocity · plain-text longevity

**Take for WeaveForge:**

- Templated paper source notes (metadata + TOC of excerpts)
- "Open excerpt" from paper annotation list
- Optional Pandoc / Better-BibTeX-style citekeys alongside titles
- Backlinks panel is already Obsidian-like — keep strengthening

**Skip:** Full in-app PDF annotator (Zotero already owns this) · plugin marketplace · becoming a general PKM app

---



### LiquidWorkspace ([liquidworkspace.app](https://liquidworkspace.app/)) — steal soon

macOS project binder: markdown + rich text + infinite canvas + brain map + PDF research with Zotero sync and cite-any-style. One-time purchase, local-first. Closest "whole project" framing to WeaveForge.

**What they nail:** Project as binder (files + outline + research in one shell) · brain map of the whole project · cite-while-writing with style choice · Zotero without leaving the writing surface

**Take for WeaveForge:**

- Excerpt → note with paper link (started)
- Cite palette that shows author/year, not just title
- Deeper "project binder" feel across Papers / Notes / Report (shared search / recent)
- Optional CSL / Word-ish styles later for non-LaTeX exports

**Skip:** Theme Studio (150+ knobs) · infinite canvas as primary UX · macOS-only local file binder · in-app clipboard tray (OS clipboard is enough for v1)

---



### LiquidText (different product) — maybe later

PDF analysis workspace: drag excerpts beside the document, ink-links, pinch distant pages, live link back to source locus. Tablet/stylus native. **Not** the same as LiquidWorkspace.

**What they nail:** Excerpt-as-object always linked to page locus · workspace for synthesis while reading · multi-doc comparison gestures

**Take for WeaveForge:**

- Persist page/locus on excerpts when Zotero provides it
- "Jump to source" deep-link if a PDF viewer ever ships
- Group excerpts by theme (reading-list or report-section tags) without infinite canvas

**Skip:** Infinite canvas mind-map UI · stylus ink · pinch-to-compare PDF chrome

---



### Citavi — steal soon (highest strategic fit)

Classic "knowledge organizer": quotations / thoughts / images are first-class items assigned to hierarchical categories that mirror the paper outline. Word add-in inserts category tree + knowledge items + cites. Task planner sits beside references.

**What they nail:** Quote → category → draft section pipeline · knowledge items independent of PDF · outline-driven writing · tasks tied to sources

**Take for WeaveForge:**

- Assign excerpt notes to report sections (or reading-list "themes")
- "Insert related excerpts" pane while writing a section
- Quotation types (direct / paraphrase / comment) in frontmatter
- Citavi-style compile: section outline + queued excerpts → draft body

**Skip:** Windows Word-centric add-in as the product · NVivo-depth qualitative coding

---



### EndNote 2025 — maybe later

Institutional reference manager. Cite While You Write in Word/Google Docs, huge style library, Find Full Text, Web of Science related records. 2025 adds Cite-from-PDF (quote + citation in one click), Find a Journal, AI key-takeaways.

**What they nail:** CWYW reliability · style switching · quote+cite from PDF · discovery from citation graph databases

**Take for WeaveForge:**

- "Copy quote + `[[Paper]]`" / paste into report as blockquote + cite path
- Stronger related-paper suggestions (Semantic Scholar edges already exist)
- Journal-matching is out of scope unless publishing becomes a product pillar

**Skip:** Word plugin race · paid Clarivate ecosystem lock-in · AI summary as core differentiator (gated AI exists elsewhere)

---



### Notion (3.0, 2025) — maybe later

Relational-database workspace. Databases link via relation + rollup properties into an interconnected knowledge base; Notion 3.0 (Sep 2025) adds autonomous AI agents that run multi-step workflows, and DB-aware AI that understands page/table structure.

**What they nail:** Relations + rollups turn flat lists into a queryable web · saved database views (table/board/timeline) over the same items · agentic AI that chains actions across the workspace

**Take for WeaveForge:**

- Relation/rollup-style properties on Papers (e.g. paper → method → dataset) feeding the Graph
- Saved views over the Papers library (board by status, timeline by year) — a DB-view layer, not a new surface
- The agentic-AI pattern is partly covered by the AI Review proposal queue; keep that human-in-loop framing

**Skip:** Becoming a general workspace/db builder · per-seat AI pricing model · block-level everything

---



### Zotero (reference layer) — already have

Default modern reference manager: capture, collections, PDF + annotations, groups, CSL, Better BibTeX. WeaveForge correctly treats it as the library system of record for PDFs/annotations rather than reimplementing it.

**Take:** Stay sync partner · improve Better-BibTeX citekey import for LaTeX identity stability · push only what's needed; don't fork a PDF reader

---



### Literature discovery: ResearchRabbit / Litmaps / Connected Papers / Elicit / Semantic Scholar — steal soon

The layer *before* reading. Two families: **visual citation-graph explorers** (ResearchRabbit, Litmaps, Connected Papers, Inciteful) that seed from paper(s) and surface neighbors via citation/similarity edges, with saved maps + alerts; and **AI review assistants** (Elicit, Consensus, Semantic Scholar AI) that take a question and return structured extractions across many papers. Note: Nov 2025 ResearchRabbit was acquired by Litmaps and moved to a freemium model.

**What they nail:** Seed-from-library related-paper discovery · citation-neighbor maps · saved-search / new-citation alerts · Elicit-style structured extraction (one row per paper: population, method, finding) across a set

**Take for WeaveForge:**

- "Related papers" seeded from a paper or reading list (Semantic Scholar / OpenAlex API) → results become AI Review proposals to add to the library — reuses the existing graph edges + proposal queue, no new surface
- Saved-search alerts: notify when new papers cite/relate to a tracked paper (fits the Log / Mattermost notification path)
- Elicit-style structured-extraction table over a reading list (columns = method / dataset / result), rendered as a report-ready table

**Skip:** Owning a full visual-mapping canvas (Graph already does relational viz) · general-web AI search · being a discovery destination rather than a thesis OS

---



### Adjacent tools


| Tool                 | Notes                                                            | Fit                                                                       |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Mendeley**         | PDF-first library + Notebook + newer AI. Elsevier cloud gravity. | Skip stack; optional "annotation notebook synthesis" view idea only       |
| **Paperpile**        | Browser-native, Google Docs CWYW, clean PDF sync                 | Maybe: polish of cite-insert UX; Docs path low priority vs Overleaf       |
| **Readwise Reader**  | Read-later + highlight sync; exports to Obsidian/Notion          | Maybe later: ingest highlights as excerpt notes (same pipeline as Zotero) |
| **Logseq / RemNote** | Outliner PKM, block refs, spaced repetition                      | Skip: block-ref depth and SRS are not thesis-OS priorities                |


---



## Feature matrix (research → write loop)


| Capability              | Obsidian    | LiquidWS     | Citavi     | EndNote       | Discovery tools | WeaveForge         |
| ----------------------- | ----------- | ------------ | ---------- | ------------- | --------------- | ------------------ |
| Reference library       | via Zotero  | Yes + Zotero | Yes        | Yes           | No              | Yes + Zotero       |
| PDF annotate            | via plugins | Yes          | Yes        | Yes           | No              | via Zotero         |
| Excerpts as objects     | via plugins | Partial      | Yes (core) | Cite-from-PDF | No              | Yes (vault)        |
| Cite while writing      | Yes         | Yes          | Word       | Word/Docs     | No              | `[[` / `@` + LaTeX |
| Knowledge → outline     | Manual      | Binder       | Categories | Weak          | No              | Report sections    |
| Graph / links           | Strong      | Brain map    | Weak       | Weak          | Citation maps   | Strong             |
| Related-paper discovery | Weak        | Weak         | Weak       | WoS records   | Yes (core)      | Partial (SS edges) |
| Thesis / plan OS        | No          | Partial      | Tasks      | No            | No              | Yes                |
| Overleaf / LaTeX        | Export DIY  | Weak         | LaTeX asst | Weak          | No              | Strong             |


---



## Recommended steal list (priority)


| #   | Idea                                            | Borrowed from                               | Why it fits                                                    | Effort |
| --- | ----------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------- | ------ |
| 1   | Pin excerpt → report section                    | Citavi categories                           | Closes read→write gap; both objects already exist              | M      |
| 2   | Section writing pane: related excerpts          | Citavi Word pane / Liquid cite              | Surfaces quotes while drafting section notes                   | M      |
| 3   | Copy quote + cite (OS clipboard)                | EndNote Cite-from-PDF / Liquid              | No tray; blockquote + `[[Paper]]` for paste into report        | S      |
| 4   | Templated paper source note                     | Obsidian ZotFlow                            | One durable note: metadata + linked excerpts TOC               | M      |
| 5   | Related-paper discovery → AI Review proposals   | ResearchRabbit / Litmaps / Semantic Scholar | Reuses graph edges + proposal queue; fills the pre-reading gap | M      |
| 6   | Stable Better-BibTeX citekeys                   | Zotero / JabRef                             | LaTeX `\cite` keys survive re-export                           | S–M    |
| 7   | Cite autocomplete: Author (year)                | LiquidWorkspace / CWYW                      | Titles alone are ambiguous in large libraries                  | S      |
| 8   | Structured-extraction table over a reading list | Elicit                                      | Turns a list into a report-ready comparison table              | M      |
| 9   | Saved-search / new-citation alerts              | Litmaps / EndNote                           | Rides existing Log + Mattermost notifications                  | S–M    |
| 10  | Page/locus on excerpts                          | LiquidText                                  | When Zotero sends page, store + show it                        | S      |
| 11  | Cross-surface search / recents                  | Liquid binder                               | Thesis OS coherence without a new canvas                       | M      |
| 12  | Saved DB views on Papers (board/timeline)       | Notion / Obsidian Bases                     | View layer over existing library, no new data                  | M      |

**Status:** #1–3, #5–7, #10 and the board half of #12 shipped in [PR #29](https://github.com/Satwik-Miyyapuram/weaveforge/pull/29); #9 shipped in [PR #33](https://github.com/Satwik-Miyyapuram/weaveforge/pull/33). #4, #8, #11 and the Notion relation/rollup idea are implemented on `feat/library-knowledge-loop` ([`plans/completed/library-knowledge-loop-plan.md`](plans/completed/library-knowledge-loop-plan.md)), which also replaces the `Excerpts/` vault notes with annotation cards under each paper.


---



## Explicit non-goals (for now)

- **Infinite canvas / Theme Studio** — LiquidWorkspace/LiquidText signature UX. High build cost, weak thesis-OS fit. Graph already covers relational visualization.
- **In-app PDF highlighter** — Zotero (and optional Obsidian plugins) already win. Sync annotations in; don't own the reader.
- **Word / Google Docs CWYW plugin** — EndNote/Paperpile moat. WeaveForge bet is report sections + Overleaf/LaTeX.
- **Outliner block refs / SRS** — Logseq/RemNote culture. Different product. Keep page-level wikilinks.
- **In-app clipboard tray** — OS clipboard is enough for v1.
- **Standalone discovery destination / visual citation canvas** — borrow the *related-papers query*, not a rival mapping app; Graph + AI Review absorb the results.

---



## Strategic summary

The winning pattern across Citavi + Liquid + Obsidian/Zotero is the same: **treat highlights as knowledge objects, link them to sources, then place them into the outline while citing.** The discovery tools add a bookend: **find the right sources before you read.**

WeaveForge already has the three writing pillars (excerpt vault notes, report sections, cite → LaTeX) plus latent Semantic Scholar edges. Next product moves should **connect those pillars and light up the discovery edge** — not add another surface.

---



## Sources

- Obsidian for research / plugins / Canvas — [dsebastien.net](https://www.dsebastien.net/the-must-have-obsidian-plugins-for-2026/), [geeky-gadgets.com](https://www.geeky-gadgets.com/obsidian-tips-tricks-2026/), [atlasworkspace.ai](https://www.atlasworkspace.ai/blog/obsidian-for-research)
- LiquidWorkspace — [liquidworkspace.app](https://liquidworkspace.app/)
- EndNote 2025 — [endnote.com/blog](https://endnote.com/blog/introducing-endnote-2025-ai-powered-reference-management/), [clarivate.com](https://clarivate.com/academia-government/blog/introducing-endnote-2025-the-next-generation-of-reference-management/)
- Notion 2025 / 3.0 — [kipwise.com](https://kipwise.com/blog/notion-ai-features-capabilities), [eesel.ai](https://www.eesel.ai/blog/notion-ai-for-databases), [skywork.ai](https://skywork.ai/blog/notion-ai-review-2025-features-pricing-workflows/)
- Discovery tools — [effortlessacademic.com](https://effortlessacademic.com/litmaps-vs-researchrabbit-vs-connected-papers-the-best-literature-review-tool-in-2025/), [intuitionlabs.ai](https://intuitionlabs.ai/articles/ai-literature-mapping-tools-guide), [researchrabbit.ai](https://www.researchrabbit.ai/articles/best-ai-tools-for-literature-review), [aarontay.substack.com](https://aarontay.substack.com/p/researchrabbits-2025-revamp-iterative)
- Zotero ↔ Readwise — [github.com/e-alizadeh/Zotero2Readwise](https://github.com/e-alizadeh/Zotero2Readwise), [forums.zotero.org](https://forums.zotero.org/discussion/90421/readwise)

