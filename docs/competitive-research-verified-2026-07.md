# WeaveForge — Verified competitive findings (July 2026)

**Date:** 2026-07-25
**Product:** WeaveForge (repo/SDK code name `thesis-tracker`) — a research workspace for Master's/PhD researchers connecting literature, notes, plan, experiments, writing outline, and lab collaboration in one Next.js + Supabase PWA, plus a Python SDK writing the same Postgres schema.
**Status:** Standalone. Every finding below is verified against a primary source and carries its own citation. `§` references point to `docs/DEEP_RESEARCH_PRODUCT_BRIEF.md` for product ground truth, but no other document is required to act on this one.

---

## 1. Headline findings

1. **ZotFlow is the closest live competitor and was previously unranked.** A free AGPL-3.0 Obsidian plugin that embeds a full Zotero reader, syncs annotations bidirectionally, generates templated source notes, and inserts citations in four formats. v1.3.1, ~9,000 downloads, actively developed. **New High threat.**
2. **Weights & Biases is not moving into narrative writing.** Reports appears in W&B Server release notes only as bug fixes and display polish. The company's investment is Weave (LLM observability/eval). **Threat downgraded High → Low–Medium.**
3. **Elicit's extraction ceiling is confirmed and is a real opening.** Column caps are 20 (Pro) / 30 (Scale) / 40 (Enterprise). Our extraction table (§6.3) has no ceiling. **Threat stays High, but with an exploitable flank.**
4. **MinerU PDF parsing is fragmenting, not standardizing.** Five competing implementations across Zotero and Obsidian, plus an API deprecation on 1 June 2026. **Threat downgraded High → Medium.**
5. **Typst is a confirmed Skip.** No official `.tex` export, no major publisher accepting Typst source, and an 8–12MB compressed WASM payload against an offline-first PWA. Prior internal estimate of ~2.5MB was low by roughly 4×.

---

## 2. Verified competitor findings

### 2.1 ZotFlow — Threat: HIGH

`duanxianpi/obsidian-zotflow` · **AGPL-3.0-only** · v1.3.1 · repo created **6 Jan 2026**, last push **19 Jul 2026** · **158 stars, 22 open issues** · ~9,000 downloads · `minAppVersion` 1.11.4, `isDesktopOnly: false` · author Xianpi Duan.

*Verified 2026-07-25 against the README, `manifest.json`, docs site, and GitHub API — an earlier revision of this section relied on secondary summaries and got two facts wrong; both are corrected below.*

**It vendors Zotero Reader.** The README credits "the PDF/EPUB/HTML reader engine embedded in ZotFlow" to the Zotero Reader project, the Markdown editor to Task Genius, and editor design to Zotero Better Notes. That is why the plugin is AGPL-3.0-only — the licence came with the engine. **Update 2026-07-25: WeaveForge is now AGPL-3.0-only as well, so the same engine is available to us on the same terms.** See `docs/plans/completed/pdf-viewer-plan.md` §1.1 for the adoption spike.

**Who it is for and the job it wins.** Obsidian users who want their Zotero library, PDF reading, annotation, source notes, and citation insertion to happen without leaving the vault. It wins by eliminating the Zotero-desktop ↔ Obsidian context switch entirely.

**The actual end-to-end workflow.** The Zotero library syncs into Obsidian, configurable per-library as Bidirectional, Read-Only, or Ignored. The researcher opens a PDF, EPUB, or HTML file in a full-featured reader **embedded in the Obsidian workspace and themed to match** — annotating with highlights, underlines, ink drawings, sticky notes, and image-region capture ("all annotation types that Zotero supports"). Annotations sync back to Zotero; collisions surface in a field-level diff viewer. Native Zotero child notes can be created and edited in place and also sync back. Every Zotero item auto-generates a Markdown source note rendered through a LiquidJS template with **persistent and editable regions**, so re-rendering does not clobber the researcher's own edits. When drafting, citations insert as **Pandoc `[@key]`, wikilink, footnote, raw citekey, or a CSL style rendered through citeproc** — by drag-and-drop from the tree view, autocomplete on the `@@` trigger, or copy-from-reader hotkeys — automatically carrying page numbers and quoted text. Batch operations generate every source note, extract every annotation image, or re-render every template in one action. An Activity Center reports sync progress and task logs. Vault PDFs and EPUBs can be annotated with **no Zotero connection at all**, stored in a sidecar `.zf.json` that stays local. Attachments come from Zotero cloud, a WebDAV server, or a linked attachment base directory. Offline-first with IndexedDB caching; credentials sit in platform-native SecretStorage, never in synced files; no telemetry.

Setup cost is materially lower than the classic Zotero Integration + Dataview + PDF++ stack, because it is one plugin rather than an assembled pipeline.

**Where it beats WeaveForge.** Reading and annotating share a surface with note-taking; ours are read-only annotation cards pulled from Zotero (§6.1) with no in-app reading surface. Its annotation sync is bidirectional with conflict resolution; ours pulls annotations into a cache. It ships templated source notes with editable regions; our vault has no native templating (§6.9). It offers five citation output formats including CSL via citeproc; we emit `[[Exact Title]]` resolving to `\cite` on Overleaf export (§6.5). It has batch operations, an Activity Center, and local-file annotation without any Zotero account.

**Where WeaveForge beats it.** Everything outside the literature loop: experiments with a Python SDK writing the same schema (§6.10), milestones and plan (§6.6), report outline with word targets and status (§6.8), lab organisations with a supervision tree (§5), sharing/comments/pins and CRDT co-edit (§6.12, §6.13), and a proposal-only MCP layer (§6.16). ZotFlow is a literature plugin — no thesis-project layer, no collaboration model, no experiment tracking.

**Steal / adapt / skip.**

- *Steal:* **Templated source notes.** ZotFlow's LiquidJS templating is the specific mechanic drawing researchers in, and §6.9 has no equivalent.
- *Steal:* **Multi-format citation insertion.** Pandoc / footnote / raw citekey alongside wikilink. §6.5 emits only `[[Title]]`.
- *Adapt:* **Annotation write-back with field-level conflict diff.** §6.1 treats annotations as read-only inbound; this is the pattern to copy if that ever changes.
- *Skip:* The embedded reader itself, per §11 — but see the non-goal note below.

**Switching cost and lock-in.** Near zero — data lives in Zotero and Markdown. That cuts both ways: trivial for a researcher to try it, trivial to leave. Our vault ZIP import (§6.9) and Zotero sync (§6.1) already cover the migration path inbound.

**Threat horizon: High.** Free, AGPL, shipping fast — last push within a week of writing, on a repo barely six months old. Squarely overlaps the reading → writing loop our competitive scan names as the product's mid-layer bet.

Calibration: ~9,000 downloads and 158 stars in roughly six months is a strong trajectory but not ubiquity, and 22 open issues on a young project suggests it is still stabilising. **Mobile is weaker than first reported** — `isDesktopOnly` is false, but the README states support is "currently limited," so the mobile flank is not yet lost. This is a threat to intercept, not a lost position.

**Implication for the §11 PDF non-goal.** Our non-goal — "Full in-app PDF annotator (Zotero owns PDFs/annotations)" — was premised on a PDF annotator being expensive and off-mission.

ZotFlow demonstrates a third path: embed Zotero's own reader rather than build one. The engine is AGPL, which is exactly why ZotFlow is AGPL.

**Update 2026-07-25 — WeaveForge relicensed to AGPL-3.0-only, so this path is open to us.** The relicensing decision was made on independent grounds (protecting the work from being taken closed and monetised without attribution — see `docs/pricing-strategy.md` §1), but a direct consequence is that `zotero/reader` is now available on the same terms ZotFlow got it. The non-goal's core rationale — "an in-app reader is expensive" — is substantially weakened, because most of that expense was building the reader.

The decision to make is now narrower and cheaper than it looked: adopt the engine if the standalone `web` build holds up, and scope the surface to what `/ai-review` provenance verification actually needs. See `docs/plans/completed/pdf-viewer-plan.md` §1 and §1.1.

### 2.2 Elicit — Threat: HIGH, with an exploitable ceiling

**Confirmed capability expansion.** On **19 December 2025** Elicit doubled systematic review report capacity from 40 to 80 papers, and shipped "strict" screening criteria that auto-exclude failing papers — with "Maybe" papers included by default to avoid false exclusions, manual override, and clear labelling of exclusions. Live for Pro, Teams, and Enterprise.

**Confirmed tier ceilings** (from Elicit's own pricing page):

| Tier | Extraction columns | Screening capacity | Report data sources |
|------|-------------------|--------------------|---------------------|
| Pro | 20 at a time | 5,000 papers | up to 135 |
| Scale | 30 at a time | ~25,000 (5× Pro) | up to 200 |
| Enterprise | 40 | 40,000 papers | custom / unlimited API |

Enterprise additionally advertises "PRISMA-grade screening and extraction accuracy."

**Why the ceiling matters.** Clinical PRISMA extraction forms commonly need 25–35 fields. A 20-column cap on Pro means the tier most individual researchers buy cannot hold a full clinical extraction form. Our extraction table (§6.3) has no column ceiling, custom field kinds include `relation` and `rollup`, and export is Markdown or CSV. That is a concrete, checkable differentiator worth naming in positioning — not a vague "we're more flexible."

**What genuinely threatens us.** Automated screening at 5,000+ papers and AI-populated extraction columns are capabilities our extraction table does not have. AI-assisted column fill is already flagged deferred in the brief's known gaps; this is the competitor making it urgent.

**Correction to note:** an earlier internal draft recorded "synthesis across up to 200 papers." The pricing page figure of 200 is **data sources**, not papers. The paper figure is 80.

### 2.3 Weights & Biases — Threat: LOW–MEDIUM (downgraded)

**Claim tested:** "W&B is aggressively expanding Reports to bridge LLM evaluations with narrative text."

**Refuted.** Across W&B Server releases through v0.82.0 (23 June 2026), Reports appears only as maintenance:

- v0.77.0 — fixed low-resolution images in PDF export of a Report; fixed a too-narrow run Notes field
- v0.76.0 — Reports truncate long media panel titles; fixed line charts not updating in sync with run selector changes
- v0.75.0 — fixed a layout break when pinning all columns in the run selector; report publishing storage configuration

No authoring interface, no narrative document features, no evaluation-result embedding. Recent feature work (v0.78.0) centres on API key security, shared configuration between single-run and multi-run workspaces, line plot shading, and media panel sync — workspace and experiment concerns, not writing.

**Where W&B is actually investing: Weave** — LLM observability and evaluation. One-line tracing producing searchable, versioned, shareable traces; scoring functions over datasets producing comparison dashboards; built-in scorers (exact match, regex, model-graded, embedding similarity); Guardrails covering toxicity, bias, PII detection, hallucination, coherence, fluency, context relevance.

**Corrected reading.** W&B is expanding into LLM evaluation, adjacent to our experiments module (§6.10) but not into thesis narrative writing. The "W&B captures the drafting lifecycle" thesis is unsupported.

This does not invalidate artifact-to-report pinning as a roadmap item — linking `experiment-artifacts` into report sections (§6.8 + §6.10) stands on its own merits. It is simply not a defensive move.

### 2.4 MinerU layout-aware PDF parsing — Threat: MEDIUM (downgraded)

**Claim tested:** "Obsidian's Zotero integration is standardizing MinerU layout-aware PDF parsing."

**Corrected.** MinerU integration is landing predominantly as **Zotero** plugins, not through an Obsidian Zotero integration:

- `Asianfleet/mineru-for-zotero` — submits PDFs to the official MinerU API; copy structured content from MinerU boxes inside the Zotero reader
- `lisontowind/zotero-mineru` — Zotero 8/9; parsed results saved back as Markdown attachments; AI summary and translation workflows
- `understandlxy/mineru-html-parser-zotero` — attaches generated HTML
- `qingpy/zotero-pdf2md` — PDF → Markdown with batch export
- `yilewang/llm-for-zotero` — higher-fidelity extraction for tables, equations, and figures; supports local `mineru-api` servers

Obsidian separately has a **standalone** `MinerU Parser` community plugin (PDF/Office/images → Markdown), unrelated to Zotero sync.

Five competing implementations across two ecosystems is fragmentation. `llm-for-zotero` further notes the built-in MinerU API may not be supported after **1 June 2026**, pushing users to personal API keys — a stability risk, not a consolidating force.

**What is real underneath.** Layout-aware PDF → Markdown extraction (tables, equations, figures) is becoming a baseline *expectation* in the Zotero ecosystem, which sits upstream of us. Worth tracking. Not a 12-month threat.

---

## 3. Threat ranking

| Threat | Rating | Basis |
|--------|--------|-------|
| **ZotFlow** | **High** | Direct overlap on the reading → writing loop; free; AGPL; embedded reader + bidirectional annotation sync + templated source notes; shipping weekly; mobile |
| **Elicit systematic review** | **High** | Confirmed 19 Dec 2025; 80-paper reports; strict screening; 5,000–40,000 paper screening. Flank: 20-column Pro extraction cap |
| **MinerU in Zotero** | **Medium** | Five fragmented implementations; API deprecation 1 Jun 2026; sets a parsing baseline but establishes no standard |
| **W&B Reports** | **Low–Medium** | Refuted — Reports is in maintenance; expansion is Weave/LLM-eval, not narrative authoring |

---

## 4. Verified implementation answers

Both survived verification intact and are directly actionable.

### 4.1 Durable deep-link anchors for PDFs we do not store

The W3C Web Annotation Data Model defines nine selector types: `FragmentSelector`, `CssSelector`, `XPathSelector`, `TextQuoteSelector`, `TextPositionSelector`, `DataPositionSelector`, `SvgSelector`, `RangeSelector`, `RefinementSelector`.

`TextQuoteSelector` carries three properties:

- `exact` — the selected text after normalization
- `prefix` — snippet immediately before
- `suffix` — snippet immediately after

**The spec endorses the recommended design directly.** On `TextPositionSelector` it states the selector "is very brittle with regards to changes to the resource" and recommends pairing it with a `State` identifying the correct representation.

**Design:** `TextQuoteSelector` as primary anchor, `TextPositionSelector` as fallback. Reject bounding-box coordinates — they break on crop, reflow, or a different rendering engine. This works without an in-app viewer, so it respects the §11 non-goal; the link can hand off to Zotero, ZotMoov, or the OS viewer.

**Two gotchas to design around:**

1. The spec gives **no** guidance on automatically re-anchoring a `TextQuoteSelector` when the source document changes. That logic is ours to write.
2. On multiple matches, the spec says the selection *SHOULD* be treated as matching **all** matches. For a jump-to-locus feature that is wrong behaviour — we need our own disambiguation rule. Nearest-to-stored-position is the obvious candidate, which is a second reason to keep the position fallback.

### 4.2 Citation alert signals

The Semantic Scholar Academic Graph API exposes, on citation edges:

- `contexts` — citation contexts as text snippets
- `intents` — classified `background`, `method`, or `result`
- `isInfluential` — flags highly influential citations

`background` means historical context or justification of importance. `method` means the citing work uses the cited procedures or experiments. `result` means it extends the cited findings.

**Caveat that changes the UX.** Intent and context data exist only for papers where Semantic Scholar has the full text. The "show the exact citing sentence" alert will be empty for a meaningful fraction of papers and needs a graceful degrade path.

**Design note.** `intents` is likely a stronger "should I read this?" signal than the sentence itself. A `method` or `result` citation of a tracked paper matters far more than a `background` name-drop, and `isInfluential` gives a second free filter. Both *reduce* alert volume rather than adding to it — which is the actual problem to solve.

---

## 5. Typst decision record

**Verdict: Skip as an authoring target. Revisit no earlier than 2027.**

Grounds, all verified:

1. **No official `.tex` export exists.** `typst/typst#149` remains open. In the project's own journal-submission discussion, both Pandoc and MiTeX conversions are characterised as *very lossy* and impractical for formal submission. `scipenai/tylax` is the third-party bidirectional converter.
2. **No major journal or publisher accepts Typst source today** (`typst/typst#3799`). Publishers require stable, feature-complete software before adoption; LaTeX publishing infrastructure is entrenched; security models for untrusted author code differ. Participants including an IACR contributor estimate a few years to adoption. Vendor blogs claiming NeurIPS / ICLR / Springer LNCS / IEEE acceptance are not supported by this primary source.
3. **WASM payload is 8–12MB compressed, ~25MB precached.** `typst.ts` ships ~22MB of WASM after `wasm-opt`, ~25MB total uncompressed, reducing to 8–12MB with brotli. An aggressively LTO'd and stripped third-party build reaches ~2.8MB compressed; another project reports ~13MB. Size varies with embedded fonts — dropping them shrinks the bundle at the cost of cross-platform rendering consistency. This lands against a PWA whose Serwist service worker exists specifically to guarantee offline operation (§6.17).
4. **Our report module is outline-shaped, not document-shaped** (§6.8), so split-pane live preview delivers less than it would in a full manuscript editor.

**Revisit trigger:** a major venue accepting Typst source, or an official `.tex` export landing. Watch `typst/typst#149` and `#3799`.

**Unaffected.** The multi-format citation gap (Pandoc / CSL for non-LaTeX targets) is real and independent of Typst. ZotFlow's four-format insertion is the nearer competitive reference point.

---

## 6. Roadmap

Effort S/M/L, impact low/med/high.

> **Sequenced delivery plan:** this section is a *priority* list, not an execution order. For phases, dependencies, decision gates, and exit criteria see [`docs/plans/current/roadmap-2026-07-phased.md`](plans/current/roadmap-2026-07-phased.md).

### P0

| Item | Effort | Impact | Rationale |
|------|--------|--------|-----------|
| **Provenance UI for `/ai-review`** | M | High | Claim-level evidence attached to every AI proposal. Our AI surface is a proposal-review queue, not a chat pane (§6.16), so the pattern must justify a *proposed write*, not a chat answer. Split view: proposed action and diff on one side, read-only source excerpt with the used sentence highlighted on the other, surrounding context dimmed. Anchor design in §4.1. |
| **AI-assisted extraction column fill** | M | High | The primary reading → writing bottleneck, already flagged deferred. Elicit is the competitor making it urgent. Must route through `/ai-review` as pending proposals — never a silent write (§6.16, §11). |
| **Vault note templates** | S | High | ZotFlow's LiquidJS templated source notes are its single strongest draw and §6.9 has no equivalent. S effort, high impact, direct interception of the leading threat. |

### P1

| Item | Effort | Impact | Rationale |
|------|--------|--------|-----------|
| **Multi-format citation insertion** | S | Med | Pandoc, footnote, and raw citekey alongside `[[Title]]` (§6.5). Closes the nearest ZotFlow gap and partially addresses non-LaTeX export needs. |
| **Coordinate-free deep-link anchors** | M | Med | `TextQuoteSelector` primary + `TextPositionSelector` fallback per §4.1. Works without an in-app viewer; hands off to Zotero or the OS. Prerequisite for the P0 provenance UI to jump to a locus. |
| **Artifact-to-report pinning** | S | Med | Insert `experiment-artifacts` plots into report sections (§6.8 + §6.10). Stands on merit; **not** a defence against W&B — see §2.3. |
| **Directional discovery filters** | S | Med | "Prior art" / "later work" on the existing related-papers UI (§6.1), plus `intents` and `isInfluential` on citation alerts per §4.2. Reduces alert volume rather than adding to it. |

### P2

| Item | Effort | Impact | Rationale |
|------|--------|--------|-----------|
| **First-class quotation types** | S | Low | Direct / paraphrase / summary taxonomy on annotation cards (§6.1). Citavi-style; accelerates outline assembly. |
| **Lab snapshot publishing** | L | Low | Freeze-and-publish a project state to a supervisor, OSF-style, instead of raw log exposure in `/supervision` (§5). |

### Explicitly not doing

- **Typst as an authoring target** — see §5.
- **Full in-app PDF annotator** — §11 non-goal. But the *rationale* needs revisiting given §2.1; a minimal read-only rendering surface for provenance verification is a separate question from an annotator.
- **Plugin marketplace** — §11. The opinionated schema is the advantage.
- **MLOps cluster orchestration** — outside the thesis-map scope.

---

## 7. Corrections log

For audit. Each entry is a claim that circulated internally and turned out to be wrong.

| Claim | Status | Correction |
|-------|--------|------------|
| "W&B aggressively expanding Reports to bridge LLM evals with narrative text" | **Refuted** | Reports is in maintenance through v0.82.0. Investment is Weave. §2.3 |
| "Obsidian's Zotero integration standardizing MinerU parsing" | **Corrected** | Five fragmented implementations, mostly Zotero-side; API deprecation 1 Jun 2026. §2.4 |
| "Typst WASM adds ~2.5MB to the PWA" | **Corrected** | 8–12MB compressed, ~25MB precached. Low by ~4×. §5 |
| "Journals increasingly accept Typst source (NeurIPS, ICLR, Springer, IEEE)" | **Refuted** | No major publisher accepts Typst source today per `typst/typst#3799`. §5 |
| "Elicit synthesizes across up to 200 papers" | **Corrected** | 200 is *data sources*, not papers. Paper limit is 80. §2.2 |
| "Elicit Pro caps extraction at 20 columns" | **Confirmed** | Verified on the pricing page. 20 Pro / 30 Scale / 40 Enterprise. §2.2 |
| "Supervision tracks daily hours dedicated" | **Refuted** | No hours field exists in the domain model (§6.7 explicitly warns against this assumption). |
| "ZotFlow builds its own pdf.js bundle; Zotero is inspiration only" | **Refuted** | Its README credits the embedded reader engine to Zotero Reader. This was my error — the claim came from a landing-page summary of a *different* repo (`obsidian-zotero-reader-plugin`) and was conflated. Consequence: the AGPL path is closed to us, and matching the reader is real engineering, not a shortcut. §2.1 |
| "ZotFlow runs on Obsidian mobile" | **Corrected** | `isDesktopOnly: false`, but the README says mobile support is "currently limited." The mobile flank is not lost. §2.1 |

---

## 8. Open items

- **ZotFlow adoption trajectory.** ~9,000 downloads over ~7 months is verified; growth rate and retention are not. Re-check the Obsidian community stats in a quarter to decide whether the High rating holds.
- **Elicit pricing figures.** Tier *limits* are confirmed from the pricing page; the dollar amounts circulating in review listicles conflict ($49/mo vs $348/yr for Pro) and were not used here.
- **MinerU API status after 1 June 2026.** The deprecation warning comes from a plugin README, not from MinerU. Confirm before relying on it.

---

## 9. Primary sources

All accessed 2026-07-25.

**Elicit**
- Introducing Strict Screening and 80-Paper Reports (announcement dated 19 Dec 2025) — https://elicit.com/blog/introducing-strict-screening-and-80-paper-reports
- Pricing (tier ceilings) — https://elicit.com/pricing
- Introducing Elicit Systematic Review — https://elicit.com/blog/systematic-review/

**ZotFlow**
- Repository — https://github.com/duanxianpi/obsidian-zotflow
- Documentation — https://zotflow.peterduan.dev/
- Obsidian community listing (version, downloads) — https://community.obsidian.md/plugins/zotflow

**MinerU / Zotero / Obsidian**
- mineru-for-zotero — https://github.com/Asianfleet/mineru-for-zotero
- zotero-mineru — https://github.com/lisontowind/zotero-mineru
- mineru-html-parser-zotero — https://github.com/understandlxy/mineru-html-parser-zotero
- zotero-pdf2md — https://github.com/qingpy/zotero-pdf2md
- llm-for-zotero — https://github.com/yilewang/llm-for-zotero
- MinerU Parser (Obsidian) — https://www.obsidianstats.com/plugins/mineru-parser

**Weights & Biases**
- wandb/server releases (through v0.82.0, 23 Jun 2026) — https://github.com/wandb/server/releases
- W&B Weave documentation — https://docs.wandb.ai/weave

**Typst**
- typst.ts — https://github.com/Myriad-Dreamin/typst.ts
- wasm-typst-studio-rs (bundle-size reference build) — https://github.com/automataIA/wasm-typst-studio-rs
- Journal submission status, discussion #3799 — https://github.com/typst/typst/discussions/3799
- LaTeX export request, issue #149 — https://github.com/typst/typst/issues/149
- tylax, Typst ↔ LaTeX converter — https://github.com/scipenai/tylax

**Specifications and APIs**
- W3C Web Annotation Data Model — https://www.w3.org/TR/annotation-model/
- Semantic Scholar Academic Graph API tutorial — https://www.semanticscholar.org/product/api/tutorial
- The Semantic Scholar Open Data Platform — https://arxiv.org/html/2301.10140v2

---

## 10. Provenance and related documents

This file consolidates verification over two external Deep Research runs commissioned against `docs/DEEP_RESEARCH_PRODUCT_BRIEF.md`:

| Source document | Outcome |
|-----------------|---------|
| `docs/Research App Analysis and Improvement.md` | Usable. Followed the brief's structure; the `§`-citation gate correctly reclassified seven recommendations as already-shipped. Undersourced — six references for a nine-tool matrix. Corrections from §7 above have been applied to it. |
| `docs/plans/completed/Competitive Strategy Report Plan.md` | Failed. Reported §14 as "omitted from the source document", invented its own Q1–Q10, and marked Q11–Q22 `UNANSWERED` against a section that exists. Teardowns sliced by workflow phase rather than by app. No matrix, no self-check, no consolidated roadmap. Retain only for the name-collision note below. |

Other internal docs: `docs/competitive-scan.md` (prior internal scan), `docs/future-work/BACKLOG.md` (shipped vs deferred).

**Name collision note** — partially salvageable from the failed run, and partially wrong. Verified 2026-07-25: `WEAVEFORGE LIMITED` is an active UK-registered company (property/investment, number 04598210); `glyphweaveforge` is an unrelated Rust crate; `WeaveFox` is an unrelated platform; the GitHub org `weaveforge` is held by an unrelated dormant dev team; multiple GitHub repositories are named `thesis-tracker`. **The claimed TTRPG using the WeaveForge name does not appear to exist** — that came from the failed run citing a Reddit thread, and direct searching finds only a game called *Weave*. No software trademark for WeaveForge was found. Resolution and rationale: `docs/licensing.md`.
