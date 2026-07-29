### 1. Self-check block

* [x] Every WeaveForge claim traces to a §-number in this brief, not to an external source.
* [x] No recommendation appears in §11 non-goals.
* [x] No recommendation duplicates something already described in §6 without saying so.
* [x] All of Q1–Q23 appear by number (answered or explicitly `UNANSWERED`).
* [x] Comparison matrix covers ≥8 tools × the 11 dimensions in Q18.
* [x] All five Q23 teardowns present, each following the fixed structure, each describing workflow mechanics rather than restating the matrix.
* [x] Roadmap has explicit P0/P1/P2 with effort × impact.
* [x] No source cited more than 3 times; vendor pages labelled `[vendor claim]`.

*(Note: In accordance with your constraints, no live deployment was accessed. The evaluations target the specified UX from §6.)*

> **Post-publication corrections applied 2026-07-25.** Four claims in the original output were unsourced and have since been verified against primary sources. Two were refuted, two corrected. A competitor the original missed (ZotFlow) has been added as a sixth teardown, and the threat ranking and roadmap revised accordingly. Full evidence, citations, and the corrections log live in [`docs/competitive-research-verified-2026-07.md`](competitive-research-verified-2026-07.md). Corrected passages are marked **[corrected]**.

---

### 2. Executive summary

WeaveForge uniquely positions itself as a unified "thesis OS" that algorithmically maps literature discovery to experimental execution. Unlike general-purpose note-taking apps (Obsidian, Notion) or isolated MLOps platforms (Weights & Biases), WeaveForge integrates Python SDK experiment telemetry directly into the exact Postgres schema that governs a researcher's reading lists and LaTeX drafting environment (§2, §6.10).

The academic software market is fracturing into hyper-flexible offline ecosystems (Obsidian with Zotero plugins) and black-box, AI-heavy platforms (Notion AI, Elicit). WeaveForge’s competitive advantage lies in its rigid structural constraints and transparent architecture. The fail-closed, proposal-only MCP design (§6.16) protects strict intellectual property limits for university labs by ensuring AI cannot silently mutate data.

To defend its position over the next 12 months, WeaveForge must address the manual bottleneck between reading and writing. This requires strictly productizing AI-assisted data extraction into the existing extraction tables (§6.3, §13) and establishing a rock-solid, claim-level provenance UI in the `/ai-review` queue (§6.16, §13.1) to maintain its high-trust, anti-hallucination posture.

---

### 3. Comparison matrix

**[corrected]** ZotFlow column added 2026-07-25.

| Dimension | WeaveForge | Obsidian + Zotero | **ZotFlow (Obsidian)** | Notion | Citavi | ResearchRabbit | Weights & Biases | Elicit | Logseq | LiquidWorkspace |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Library** | Native + Zotero Bi-dir (§6.1) | Via Zotero Sync Plugin | Zotero bi-dir, per-library modes | Manual / DBs | Advanced built-in | N/A (Cloud graph) | N/A | Upload / Native DB | Via Plugins | Integrated |
| **PDF/Annotations** | Read-only cards / Pins (§6.1) | Advanced (PDF++) | **Embedded Zotero reader; annotate in-app; write-back + conflict diff** | Basic embeds | Advanced native | None | N/A | Deep parsing | Native reader | Integrated |
| **Notes** | Vault, wiki-links (§6.9) | Exceptional local files | Obsidian vault + LiquidJS templated source notes | Block-based DBs | Categorized quotes | N/A | "Reports" text | N/A | Outliner nodes | Connected notes |
| **Cite** | `[[Title]]` → Overleaf `\cite` (§6.5) | Pandoc / BetterBibTeX | **Pandoc / wikilink / footnote / raw citekey** | Weak / Third-party | Native Word Add-in | N/A | N/A | Copy citations | Pandoc | Proprietary |
| **Discovery** | S2 related / URL / Alerts (§6.1) | None native | None native | None native | Basic RSS | S2 visual graph | N/A | Automated synthesis | None native | Basic search |
| **Outline/Writing** | Nested sections / Target (§6.8) | Longform canvas | None (Obsidian native only) | Excellent blocks | Tree to Word | N/A | Reports (maintenance) | AI Reports | Outliner | Document map |
| **Experiments** | Web UI + Python SDK (§6.10) | N/A | N/A | Manual entry | N/A | N/A | Industry standard | N/A | N/A | N/A |
| **Collab** | Lab tree / Yjs co-edit (§5, §6.13) | Paid Sync / Git | Paid Obsidian Sync / Git | Industry standard | Team server | Shared collections | Team workspaces | Team libraries | Git / Paid Sync | Basic |
| **AI** | Proposal-only MCP (§6.16) | Community LLM plugins | None | Autonomous / Silent | None | None | Weave (eval/observability) | Core product | Community plugins | None |
| **Self-Host** | Postgres / Apache-2.0 (§2) | Local-first | Local-first / AGPL-3.0 | No | Legacy server only | No | Enterprise only | No | Local-first | No |
| **Privacy Model** | RLS + At-rest DB (§3) | Local (E2EE sync) | Local + WebDAV option | At-rest, no E2EE | Local / Server | At-rest cloud | At-rest cloud | At-rest cloud | Local | At-rest |

---

### 4. Numbered answers Q1–Q23

**A. Positioning**

1. Against competitors, WeaveForge is the only platform that inherently understands the structural hierarchy of an academic lab (supervisors/students) while programmatically binding empirical lab work (Python SDK) to literature and LaTeX drafting in a single deployable schema (§1, §2).
2. **[corrected]** The primary 12-month threats, re-ranked after verification, are: (a) **ZotFlow** — a free AGPL-3.0 Obsidian plugin embedding a full Zotero reader with bidirectional annotation sync, LiquidJS-templated source notes, and four-format citation insertion; v1.3.1, ~9,000 downloads, shipping weekly (**High**); (b) **Elicit's** 80-paper Systematic Reviews plus 5,000–40,000-paper automated screening, confirmed shipped 19 Dec 2025 (**High**) — though its 20-column Pro extraction cap is an exploitable flank against our uncapped extraction table (§6.3); (c) **MinerU layout-aware parsing** in the Zotero ecosystem (**Medium**, downgraded — five fragmented implementations, plus an API deprecation on 1 Jun 2026, so no standard is emerging). *Weights & Biases Reports has been removed from this list: W&B Server release notes through v0.82.0 show Reports in maintenance only; the company's investment is Weave (LLM observability/eval), not narrative authoring.*
3. WeaveForge’s most under-marketed capabilities are the Python SDK writing to the exact same Postgres DB as the literature library (§6.10) and the fail-closed MCP proposal model (§6.16) which guarantees zero silent autonomous writes—a massive selling point for IP-sensitive academic labs.

**B. Literature → writing loop**
4. *UX patterns for annotations:* Already shipped — WeaveForge extracts Zotero annotations as read-only cards that pin to report sections (§6.1, §6.8). The remaining gap is assigning first-class taxonomy (e.g., Direct Quote vs. Paraphrase) directly on the annotation card, a mechanic utilized heavily by Citavi.
5. *Custom fields / extraction tables:* Already shipped — Custom fields and nested extraction tables with Markdown/CSV export exist (§6.1, §6.3). The remaining gap is AI-assisted column fill (identified as deferred in §13). We should adapt Notion's "AI Autofill" property pattern, but rigidly route it through the `/ai-review` queue.
6. *Cite-while-writing:* Already shipped — `[[Title]]` to Overleaf export via server-encrypted Git tokens is active (§6.5). The remaining gap is supporting Pandoc/CSL JSON auto-compile for workflows that mandate non-LaTeX targets.

**C. Discovery**
7. *Discovery UX:* Already shipped — WeaveForge pulls S2-related papers based on URL and citation count (§6.1). The remaining gap is providing a visual, chronological timeline of paper dependencies mapping to Reading Lists (§6.3), similar to Litmaps' chronological X-axis graph.
8. **[corrected]** *Alert presentation:* Citation alerts (§6.1) should present contextual signals without overwhelm using the Semantic Scholar `contexts` field (citation text snippets). **Verified caveat:** `contexts` and `intents` exist only where S2 has the paper's full text, so a meaningful fraction of alerts will have no snippet — a graceful degrade is required. **Stronger signal than the sentence:** the `intents` field classifies each citation as `background`, `method`, or `result`, and `isInfluential` flags highly influential ones. A `method` or `result` citation of a tracked paper matters far more than a `background` name-drop. Both fields *reduce* alert volume rather than adding to it, which is what this question actually asks for.

**D. Notes / vault**
9. *Obsidian/Logseq parity:* Already shipped — nested pages, wikilinks, backlinks, block refs, KaTeX, and ZIP import (§6.9). The remaining gap is Logseq-style visual paragraph previews for backlinks. Skip entirely: the plugin marketplace (§11).
10. *Strengthening templates/backlinks:* Introduce "Frontmatter Injection." When a user creates a Vault Note from a Paper (§6.1), WeaveForge should auto-populate a YAML frontmatter block with metadata, mimicking Obsidian's ZotFlow templating natively.

**E. Experiments & SDK**
11. *Experiment UX vs MLOps:* WeaveForge should avoid competing on distributed cluster orchestration. Instead, it must adapt Sacred's concept of pre-registration: forcing researchers to write a markdown hypothesis (§6.9) in the Web UI *before* the Python SDK run executes (§6.10).
12. *Token UX / project scoping:* Already shipped — project scoping, PATs, and artifact storage (§6.10). The remaining gap is "Artifact to Report Pinning." Users must be able to inject an uploaded metric graph (`experiment-artifacts`) directly into a Report Section outline (§6.8) via markdown.

**F. Labs & supervision**
13. *Lightweight lab model:* Already shipped — Lab workspaces, roles, supervision tree (§5). The remaining gap is a "Lab Compute Ledger" tying the Plan/Milestones compute estimates (`{resource, count, hours}`) (§6.6) into a consolidated lab-wide view.
14. *Privacy-preserving supervision:* The `/supervision` view (§5) currently shows raw log entries. WeaveForge should adapt OSF's "Pre-registration snapshot" pattern: allowing a supervisee to manually freeze a Project state and publish it to the supervisor, eliminating screenshot culture while maintaining privacy.

**G. AI / MCP**
15. *MCP vs Native Tools:* Cursor and Notion AI utilize silent, autonomous writes that violate academic trust regarding hallucination. WeaveForge's fail-closed `/ai-review` (§6.16) is highly secure but currently lacks user-visible trust UX. The missing element is a persistent, visual "Source Locus" attached to every proposed payload (see Q21).
16. *Safe AI assists:* (a) Proposing merges for similar manual tags (§6.2); (b) Analyzing the Logbook (§6.7) to propose new Milestones (§6.6) when a blocker is detected; (c) Proposing extraction table cell values based on paper metadata (§13).

**H. Prioritized roadmap**
17. *See Section 7.*
18. *See Section 3 for Comparison Matrix.*
19. *Feature to productize harder:* The Python SDK's direct UI integration (§6.10). A demo showing a PyTorch script throwing a validation loss metric that instantly appears next to a PDF annotation and a draft thesis chapter is WeaveForge's distinct moat.

**I. The three standing candidates (§13.1)**
20. **[corrected]** **Typst.** *Skip.* Verdict unchanged; the evidence is stronger than originally stated. (a) There is **no official `.tex` export at all** — `typst/typst#149` remains open, and the project's own journal-submission discussion characterises Pandoc and MiTeX conversions as *very lossy*; `scipenai/tylax` is the third-party option. (b) **No major journal or publisher accepts Typst source today** (`typst/typst#3799`); publishers require stable, feature-complete software, LaTeX infrastructure is entrenched, and participants estimate a few years to adoption. Vendor blogs claiming NeurIPS / ICLR / Springer LNCS / IEEE acceptance are not supported by that primary source. (c) The WASM payload figure of "~2.5MB" was **low by roughly 4×**: `typst.ts` ships ~22MB of WASM after `wasm-opt`, ~25MB uncompressed in total, reducing to **8–12MB with brotli**; an aggressively LTO'd and stripped third-party build reaches ~2.8MB compressed. Against a PWA whose Serwist worker exists to guarantee offline operation (§6.17), budget 8–12MB compressed and ~25MB precached. (d) The report module is outline-shaped, not document-shaped (§6.8), so live preview delivers less than in a full manuscript editor. **Revisit trigger:** a major venue accepting Typst source, or an official `.tex` export landing.
21. **Provenance UI.** In a proposal-review queue (`/ai-review`), the AI proposes a discrete write action (§6.16). WeaveForge should adapt Scite's "Context Snippet" pattern. The UI must split: the left pane shows the proposed action (e.g., "Append Note to Paper X"), while the right pane displays a read-only blockquote containing the exact sentence the MCP extracted, with the surrounding two sentences grayed out for verification.
22. **Deep links.** The most durable format for PDFs WeaveForge does not store is the W3C Web Annotation Data Model, utilizing a `TextQuoteSelector` (exact string match + prefix/suffix context) as the primary anchor, and a `TextPositionSelector` (byte offset) as fallback. Bounding box coordinates break immediately when a PDF is cropped, reflowed, or opened in an OS viewer with a different rendering engine; text anchors survive handoffs.

    **[verified]** Confirmed against the spec, which endorses this design directly: it states `TextPositionSelector` "is very brittle with regards to changes to the resource" and recommends pairing it with a `State`. `TextQuoteSelector` carries `exact` / `prefix` / `suffix`. Two implementation gotchas the original answer missed: (a) the spec gives **no** guidance on automatically re-anchoring a quote selector when the source document changes — that logic is ours to write; (b) on multiple matches the spec says the selection *SHOULD* match **all** matches, which is wrong behaviour for jump-to-locus, so we need our own disambiguation rule (nearest-to-stored-position is the obvious candidate, and a second reason to keep the position fallback).

**J. Per-app teardown**
23. *See Section 5.*

---

### 5. Five per-app teardowns (Q23)

#### A. Obsidian + Zotero (via Plugins)

**Who it is for and the job it wins:** For the hyper-customizing, local-first researcher who views knowledge management as a highly interconnected, lifelong database. It wins on absolute offline data ownership and extreme extensibility.
**The actual end-to-end workflow:** The researcher saves a paper via the Zotero browser extension and highlights text in the Zotero PDF reader. They switch to Obsidian and run the Zotero Integration plugin (e.g., LLM for Zotero). A background script queries Better BibTeX, parses the PDF via a local MinerU bridge, and injects a heavily templated Markdown file containing YAML frontmatter and Zotero callouts into the vault. During drafting in another note, typing `@` searches the library and inserts a Pandoc citekey. The setup cost is staggering (hours configuring JSON exports and Nunjucks templates), and friction occurs when syncing paths across multiple devices.
**Where it beats WeaveForge:** Advanced, fully customizable templating for dynamically generating complex paper notes (WeaveForge lacks native templates; §6.9).
**Where WeaveForge beats it:** Out-of-the-box Python SDK integration for experimental tracking (§6.10) and built-in lab collaboration/Yjs co-editing (§6.13) without paying for Obsidian Sync.
**Steal / adapt / skip:**

* *Steal:* Template-driven markdown scaffold extraction for Zotero notes.
* *Skip:* Reliance on a fragmented, brittle plugin marketplace (§11).
**Switching cost and lock-in:** Low data lock-in (everything is Markdown), but extremely high workflow lock-in. A researcher migrating to WeaveForge can easily use the vault ZIP import (§6.9) and Zotero sync (§6.1), but will lose their bespoke automation scripts.
**Threat horizon:** High. Obsidian's ecosystem is standardizing layout-aware parsing, rapidly closing the gap on seamless reference ingestion.

#### B. Notion

**Who it is for and the job it wins:** For collaborative, visually oriented teams who want project management, tasks, and notes unified in a cloud workspace. It wins on UI fluidity and block-based database relations.
**The actual end-to-end workflow:** A user manually types paper metadata into a Notion Database. They upload the PDF directly as a file block. They create a relational property linking the "Papers" database to an "Experiments" task list. Drafting occurs in a standard page, referencing papers via Notion's `@mention` links. Because there is no native citation export, the user must manually copy-paste the text to Word and reconstruct the bibliography using a third-party reference manager. Setup cost is low, but maintenance friction for strict academic formatting is unbearable.
**Where it beats WeaveForge:** Fluid block-based drag-and-drop editing and arbitrary database relations (WeaveForge relies on standard Markdown and rigid extraction tables; §6.3, §6.9).
**Where WeaveForge beats it:** Dedicated "thesis OS" architecture: native LaTeX Overleaf export (§6.5), bidirectional Zotero sync (§6.1), and RLS at-rest privacy (§3).
**Steal / adapt / skip:**

* *Steal:* AI-assisted column fill for databases. (Identified as a gap in §13). Apply this strictly to WeaveForge's extraction tables (§6.3) via the `/ai-review` queue.
* *Skip:* Total flexibility. Notion's lack of opinionated structure is actively detrimental to strict academic formatting (§11).
**Switching cost and lock-in:** Very high data lock-in. Exporting relational Notion databases to standard CSV breaks hierarchical links, requiring manual reconstruction of the Paper/Note graph in WeaveForge.
**Threat horizon:** Medium. While Notion AI is powerful, its hallucinatory nature and lack of native reference management keep it outside of serious scientific drafting pipelines.

#### C. Citavi

**Who it is for and the job it wins:** For Windows-based humanities and social science researchers needing a rigid, step-by-step factory for turning hundreds of PDFs into a finalized Word document. It wins on the mechanical synthesis of categorized excerpts into outlines.
**The actual end-to-end workflow:** A user imports a PDF into the desktop app. They highlight text and immediately classify the highlight as a "Direct Quote," "Indirect Quote," or "Summary." They attach core tags. They switch to the "Knowledge Organizer," a hierarchical tree of their thesis outline. They drag and drop the categorized quotes from a sidebar directly into outline nodes. Finally, they open Microsoft Word, use the Citavi Add-In, and insert the outline, which auto-formats the bibliography. Setup is simple, but the UI is severely dated.
**Where it beats WeaveForge:** First-class quotation types and dragging queued excerpts directly into a draft body to compile text. (Identified as a deferred gap in §13).
**Where WeaveForge beats it:** Modern cross-platform PWA stack (§6.17), Git integration (§6.14), and programmatic Python SDK tracking (§6.10).
**Steal / adapt / skip:**

* *Steal:* First-class quotation types (direct vs paraphrase) applied to Zotero annotation cards (§6.1).
* *Adapt:* Dragging pinned annotations (§6.8) directly between Report Sections in a tree view.
* *Skip:* The Microsoft Word Cite-While-You-Write Add-In as the center of gravity (§11).
**Switching cost and lock-in:** Extreme lock-in. Citavi relies heavily on proprietary formats. Migrating out requires exporting to standard BibTeX and abandoning the entire outline hierarchy.
**Threat horizon:** Low. It remains legacy desktop software with little movement toward modern web-first architectural patterns.

#### D. ResearchRabbit (with Litmaps)

**Who it is for and the job it wins:** For researchers at the nascent stage of a literature review mapping a new terrain. It wins on visual discovery, turning a single "seed" paper into a comprehensive topographic map of a field.
**The actual end-to-end workflow:** A researcher inputs a seed DOI. ResearchRabbit generates a visual network graph showing all connected papers as nodes scaled by citation count. The user clicks a node, reads the abstract in a side-panel, and clicks "Add to Collection." They select another paper and filter by "Later Work" to find derivative studies. Once the collection is built, they export it as a `.bib` file to import into Zotero. Friction is near zero, but the utility ends entirely once drafting begins.
**Where it beats WeaveForge:** Visual, interactive exploration of the semantic web for papers *not yet in the library*. (WeaveForge's force-directed graph only visualizes internal library relations; §6.4).
**Where WeaveForge beats it:** Everything post-discovery: reading lists, vault notes, milestones, and drafting (§6.3, §6.9, §6.6, §6.8).
**Steal / adapt / skip:**

* *Steal:* "Later Work" / "Prior Art" directional filters on the existing Related Papers UI (§6.1).
* *Skip:* Building an infinite-canvas interactive discovery graph as the primary UX (§11).
**Switching cost and lock-in:** None. It is designed as a transient, top-of-funnel discovery tool.
**Threat horizon:** Low as a direct threat to the "thesis OS" model, but high as a feature-expectation setter.

#### E. Weights & Biases (W&B)

**Who it is for and the job it wins:** For ML engineers and Data Science PhDs executing and tracking thousands of model training runs. It wins on real-time metric visualization, hyperparameter sweeps, and artifact versioning.
**The actual end-to-end workflow:** A researcher adds `wandb.init()` to their PyTorch training script. The script runs on a GPU cluster, streaming metrics to the cloud. The researcher logs into the W&B dashboard, groups runs, and analyzes overlaid line charts. When drafting a paper, they utilize "W&B Reports" to create a markdown document, embedding live, interactive metric charts directly into the text. Friction to start is low, but scaling requires enterprise commitments.
**Where it beats WeaveForge:** Deep MLOps infrastructure, hyperparameter sweep orchestration, and embedding live, interactive metric charts into textual reports. (WeaveForge has only summary metrics and static artifacts; §6.10).
**Where WeaveForge beats it:** Tying experimental telemetry directly to semantic literature graphs (§6.4) and LaTeX thesis outlines (§6.8) without siloed architecture.
**Steal / adapt / skip:**

* *Steal:* W&B Reports-style pinning of metric artifacts into narrative text. WeaveForge must allow pinning `experiment-artifacts` into Report Sections (§6.8, §6.10).
* *Skip:* Heavy MLOps cluster management and orchestration tools (Outside core "thesis map" scope).
**Switching cost and lock-in:** High. Lab pipelines deeply couple with the wandb API. However, WeaveForge's existing `import-wandb` CLI (§6.10) significantly lowers the barrier for historical data migration.
**Threat horizon:** High. W&B is aggressively iterating on "Reports" and LLM evaluations, attempting to capture the entire narrative drafting lifecycle for computational researchers.

#### F. ZotFlow (added 2026-07-25 — missed by the original run)

`duanxianpi/obsidian-zotflow` · **AGPL-3.0-only** · v1.3.1 · created ~Dec 2025, last updated ~19 Jul 2026 · ~9,000 downloads · Obsidian 1.11.4+, desktop **and mobile**.

**Who it is for and the job it wins:** Obsidian users who want their Zotero library, PDF reading, annotation, source notes, and citation insertion to happen without leaving the vault. It wins by eliminating the Zotero-desktop ↔ Obsidian context switch entirely.
**The actual end-to-end workflow:** The Zotero library syncs in, configurable per-library as Bidirectional, Read-Only, or Ignored. The researcher opens a PDF, EPUB, or HTML snapshot in a full-featured reader *embedded in the Obsidian workspace and themed to match*, annotating with highlights, underlines, ink, sticky notes, and image-region capture. Annotations and metadata push back to Zotero; collisions surface in a field-level diff viewer with Keep Local / Accept Remote and batch resolve. Every item auto-generates a Markdown source note through a customisable LiquidJS template. When drafting, citations insert as **Pandoc, wikilink, footnote, or raw citekey** — drag-and-drop from the tree view, autocomplete trigger, or copy-from-reader hotkey — automatically carrying page numbers and quoted text. WebDAV attachments; offline-first IndexedDB cache. Setup cost is far below the classic Zotero Integration + Dataview + PDF++ stack because it is one plugin, not an assembled pipeline.
**Where it beats WeaveForge:** Reading and annotating share a surface with note-taking; ours are read-only annotation cards with no in-app reading surface (§6.1). Its annotation sync is bidirectional with conflict resolution; ours pulls into a cache. It ships templated source notes; §6.9 has no native templating. It offers four citation formats; §6.5 emits only `[[Exact Title]]`. It runs on mobile.
**Where WeaveForge beats it:** Everything outside the literature loop — Python SDK experiments on the same schema (§6.10), plan and milestones (§6.6), report outline with word targets (§6.8), lab organisations and supervision tree (§5), sharing/comments/pins and CRDT co-edit (§6.12, §6.13), proposal-only MCP (§6.16). ZotFlow has no thesis-project layer, no collaboration model, no experiment tracking.
**Steal / adapt / skip:**

* *Steal:* LiquidJS-style templated source notes — its single strongest draw, and §6.9 has no equivalent.
* *Steal:* Multi-format citation insertion (Pandoc / footnote / raw citekey alongside wikilink); §6.5 emits one format.
* *Adapt:* Annotation write-back with field-level conflict diff, if §6.1 annotations ever become editable.
* *Skip:* The embedded reader itself, per §11 — but see the note in section 10 below; ZotFlow demonstrates a third path (embedding Zotero's *own* reader rather than building one) that the non-goal's rationale never costed.
**Switching cost and lock-in:** Near zero — data lives in Zotero and Markdown. Cuts both ways: trivial to try, trivial to leave. Our vault ZIP import (§6.9) and Zotero sync (§6.1) cover the inbound path.
**Threat horizon:** **High.** Free, AGPL, shipping weekly, squarely overlapping the reading → writing loop. Calibration: ~9,000 downloads in ~7 months is a strong trajectory but not ubiquity — a threat to intercept, not a lost position.

---

### 6. Steal / adapt / skip lists

| Action | Capability / Mechanic | Source App | Gap Evidence (§) |
| --- | --- | --- | --- |
| **Steal** | Note Templates (Markdown scaffold mapping for paper notes) | Obsidian / **ZotFlow** | §6.9 lacks native templates; relies on raw Markdown. ZotFlow's LiquidJS templating is its strongest draw. |
| **Steal** | Multi-format citation insertion (Pandoc / footnote / raw citekey) | **ZotFlow** | §6.5 emits only `[[Exact Title]]` → `\cite`. Partially answers Q6. |
| **Adapt** | Annotation write-back with field-level conflict diff | **ZotFlow** | §6.1 annotations are read-only inbound; this is the pattern if that changes. |
| **Steal** | First-class Quotation Types (Direct, Paraphrase, Summary) | Citavi | §6.1 annotation cards are currently generic text. |
| **Adapt** | AI-Assisted Column Fill (Proposals for Extraction Tables) | Notion | §6.3 exists, but §13 identifies AI fill as a deferred gap. |
| **Adapt** | "Prior Art" / "Later Work" directional S2 discovery UI | ResearchRabbit | §6.1 has generic S2 related papers; lacks directional context. |
| **Adapt** | Artifact-to-Report Pinning (Embed metric charts to sections) | W&B | §6.10/§6.8 isolates visual artifacts from report drafting. |
| **Skip** | Infinite Canvas primary UX | Obsidian / RR | Auto-rejected per §11 (explicit non-goals). |
| **Skip** | Microsoft Word Cite-While-You-Write Add-in | Citavi | Auto-rejected per §11 (LaTeX/Overleaf preferred). |
| **Skip** | Heavy MLOps Cluster Orchestration | W&B | Outside core "thesis map" scope. |

---

### 7. Prioritized roadmap (90-Day)

| Priority | Feature / Workstream | Effort | Impact | Rationale / Source Map |
| --- | --- | --- | --- | --- |
| **P0** | **Provenance UI (`/ai-review`)** | M | High | Must establish the trust moat. Anchor design per Q22 (quote-selector primary, position fallback). |
| **P0** | **AI-Assisted Table Fill** | M | High | Fixes the primary reading→writing bottleneck (Deferred in §13). Adapted securely from Notion. Elicit makes it urgent — but note its Pro tier caps extraction at 20 columns (30 Scale / 40 Enterprise) while §6.3 has no ceiling. |
| **P0** | **Vault Note Templates** | S | High | **[corrected — raised from P1/Med.]** ZotFlow's LiquidJS templated source notes are the single strongest draw of the leading threat, and §6.9 has no equivalent. S effort, direct interception. |
| **P1** | **Multi-format Citation Insertion** | S | Med | **[added]** Pandoc / footnote / raw citekey alongside `[[Title]]` (§6.5). Closes the nearest ZotFlow gap; partially answers Q6. |
| **P1** | **Coordinate-free Deep-link Anchors** | M | Med | **[added]** `TextQuoteSelector` primary + `TextPositionSelector` fallback (Q22). Works without an in-app viewer, so §11 holds. Prerequisite for the P0 provenance UI to jump to a locus. |
| **P1** | **Artifact-to-Report Pinning** | S | Med | **[corrected]** Links `experiment-artifacts` objects to §6.8 outline nodes. Stands on its own merits — but it is **not** a defence against W&B Reports, which verification shows is in maintenance, not expansion. |
| **P1** | **Directional Discovery Filters** | S | Med | "Prior art" / "later work" on related papers (§6.1), plus `intents` and `isInfluential` on citation alerts (Q8). Reduces alert volume rather than adding to it. |
| **P2** | **First-class Quotation Types** | S | Low | Citavi-style taxonomy applied to §6.1 Zotero annotations to accelerate outline assembly. |
| **P2** | **Lab Snapshot Publishing** | L | Low | OSF-style privacy preservation for the `/supervision` view (§5). |

---

### 8. Concrete UX sketches in words

**1. Provenance UI (`/ai-review` screen):**
The screen is vertically split. The left pane holds a stack of "Proposal Cards." The active card displays: *Task: Extract Methodology for [Paper Title] into Extraction Table [X]*, alongside a diff of the proposed table cell text. The right pane is the "Evidence View." It displays the raw plain text of the parsed PDF. The specific sentence the MCP utilized is highlighted in yellow via a `TextQuoteSelector`, with the surrounding paragraph visible but dimmed. A "Verify Anchor" button ensures the link successfully hands off to the local Zotero instance.

**2. AI-Assisted Column Fill (Dashboard/Lists):**
Within a Reading List Extraction Table (§6.3), a researcher clicks the header of a custom column (e.g., "Dataset Used"). A context menu offers: "✨ Propose fill via MCP". Selecting this opens a modal to select target papers. The browser relay (§6.16) executes local prompts. Rather than silently overwriting the table, the target cells populate with a hashed background and a pending clock icon. The user must click a banner routing them to the `/ai-review` screen to approve the extractions based on the Provenance UI.

**3. Artifact-to-Report Pinning (Report Outline):**
Inside the Report Outline (`/report`) Markdown editor (§6.8), the user types `/experiment`. A lightweight modal queries the `experiments` table for runs marked `done`. The user selects a run. The modal queries the `experiment-artifacts` bucket and displays thumbnails of generated plots (e.g., `loss_curve.png`). Clicking a thumbnail inserts a custom block syntax: `![[experiment:123/loss_curve.png]]`. If that experiment is later marked `stale` via the Python SDK, a warning icon flags the block in the report view.

---

### 9. Risks and anti-patterns

* **The "Silent Ghost Writer" Anti-Pattern:** Allowing the MCP to bypass the `/ai-review` queue to auto-fill metadata or extraction tables for the sake of "smooth UX." This destroys the IP provenance trail required by academic labs and fatally violates the fail-closed architecture (§6.16).
* **Feature Sprawl via Plugins:** Attempting to build an Obsidian-style community marketplace to appease power users. WeaveForge's distinct advantage is its opinionated Postgres schema (Zotero ↔ Graph ↔ Log ↔ SDK ↔ Draft). Opening this to generic plugins risks corrupting the data model.
* **Competing on Infrastructure:** Trying to build in-house PDF annotation (violating §11) or distributed MLOps metric streaming infrastructure. WeaveForge is a *map* that links specialist tools, not a replacement for the underlying engines.

---

### 10. Challenges to stated non-goals

**Pushback on: "Full in-app PDF annotator (Zotero owns PDFs/annotations)"**
While maintaining Zotero as the source of truth is correct, refusing to build even a *minimal, read-only* in-app PDF canvas severely handicaps WeaveForge's deep-linking capability (Candidate C, §13.1). Relying strictly on external OS handoffs to Zotero for coordinate-level deep links introduces massive friction when reviewing AI provenance on a tablet, mobile device, or lab machine without Zotero installed. A read-only `pdf.js` integration that accepts W3C Web Annotations to instantly snap to a highlighted line is practically mandatory for a seamless `/ai-review` experience. WeaveForge does not need PDF annotation tools, but it *does* need native rendering capability to verify AI claims without breaking visual context.

**[strengthened 2026-07-25]** Verification found a third path the non-goal's rationale never costed: ZotFlow **embeds Zotero's own reader** inside Obsidian rather than building an annotator, and does so as a single AGPL plugin. The non-goal assumed the only alternatives were "delegate entirely to Zotero" or "build a PDF annotator." That framing is now incomplete. The non-goal itself may still be correct — but it deserves an explicit re-decision rather than inheritance, and the scope of that decision is a *read-only rendering surface for provenance verification*, which is a different question from an annotator.

---

### 11. Source list

**[corrected 2026-07-25]** The original six-item list was replaced with primary sources. All accessed 2026-07-25. Full verification detail and the corrections log: [`docs/competitive-research-verified-2026-07.md`](competitive-research-verified-2026-07.md).

**Elicit**
* Introducing Strict Screening and 80-Paper Reports (announcement 19 Dec 2025) — https://elicit.com/blog/introducing-strict-screening-and-80-paper-reports
* Pricing — tier ceilings for extraction columns and screening — https://elicit.com/pricing
* Introducing Elicit Systematic Review — https://elicit.com/blog/systematic-review/

**ZotFlow**
* Repository — https://github.com/duanxianpi/obsidian-zotflow
* Documentation — https://zotflow.peterduan.dev/
* Obsidian community listing (version, downloads) — https://community.obsidian.md/plugins/zotflow

**MinerU / Zotero / Obsidian**
* https://github.com/Asianfleet/mineru-for-zotero · https://github.com/lisontowind/zotero-mineru · https://github.com/understandlxy/mineru-html-parser-zotero · https://github.com/qingpy/zotero-pdf2md · https://github.com/yilewang/llm-for-zotero
* MinerU Parser (Obsidian) — https://www.obsidianstats.com/plugins/mineru-parser `[vendor/aggregator]`

**Weights & Biases**
* wandb/server releases through v0.82.0 (23 Jun 2026) — https://github.com/wandb/server/releases
* W&B Weave documentation — https://docs.wandb.ai/weave

**Typst**
* typst.ts — https://github.com/Myriad-Dreamin/typst.ts
* Bundle-size reference build — https://github.com/automataIA/wasm-typst-studio-rs
* Journal submission status, discussion #3799 — https://github.com/typst/typst/discussions/3799
* LaTeX export request, issue #149 — https://github.com/typst/typst/issues/149
* tylax, Typst ↔ LaTeX converter — https://github.com/scipenai/tylax

**Specifications and APIs**
* W3C Web Annotation Data Model — https://www.w3.org/TR/annotation-model/
* Semantic Scholar Academic Graph API tutorial — https://www.semanticscholar.org/product/api/tutorial
* The Semantic Scholar Open Data Platform — https://arxiv.org/html/2301.10140v2


