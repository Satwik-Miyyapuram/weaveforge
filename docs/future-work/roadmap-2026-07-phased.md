# WeaveForge — phased delivery plan (July 2026 roadmap)

**Date:** 2026-07-25 · **Last updated:** 2026-07-26
**Source of priorities:** `docs/competitive-research-verified-2026-07.md` §6 — a P0/P1/P2 list with effort × impact, but no sequencing.
**This document** turns that list into ordered phases with dependencies and exit criteria. Phase letters label work (A–F); the resolved decisions are labelled D1–D4 because they scope the reader phase, and are not themselves a phase.

## Why this exists

Two phase-wise plans already exist and are **both complete**:

| Plan | Scope | Status |
|------|-------|--------|
| `competitive-scan-implementation-plan.md` | Earlier internal scan — cite identity, discovery, library UX | Phases 0–5 **all done** |
| `library-knowledge-loop-plan.md` | Annotation cards, pins, custom fields, extraction table, rollups | Phases 0–7 **all done** (migrations `0103`–`0105`) |

Both predate the verified competitive research, so neither accounts for ZotFlow, the Weights & Biases downgrade, or Elicit's extraction ceiling. Two newer plans cover single features in depth (`pdf-viewer-plan.md`, `billing-and-quota-plan.md`) but neither sequences the roadmap as a whole. This document is the missing layer above them.

---

## Status at a glance (2026-07-26)

| Phase | Contents | State |
|-------|----------|-------|
| **A** | Pure domain foundations | ✅ **done** |
| **B** | Feature logic — templates, citations, artifacts, ranking | ✅ **done** |
| **C** | **UI wiring** — make B reachable by users | ⬜ next |
| **D** | Reader + provenance (read-only) | ⬜ |
| **E** | AI-assisted extraction fill | ⬜ |
| **F** | P2 tail | ⬜ |

A and B were delivered on branch `overnight/queue-2b-through-9`: 394 core tests, 52 web feature tests, all four gates green. **Every hard part is written and tested; none of it is reachable by a user yet.** That is what Phase C fixes.

## Dependency map

```
Phase A  pure domain            [DONE]
   |
   +--> Phase B  feature logic  [DONE]
            |
            +--> Phase C  UI wiring        <- needs a human, no test surface
            |
            +--> Phase D  reader + provenance
                     |
                     +--> Phase E  AI-assisted extraction fill
                              |
                              +--> Phase F  P2 tail
```

**Why UI is its own phase.** Web UI has no unit-test coverage in this repo — 23 test files under `apps/web/src/features/*/test/`, none touching `.tsx` — and the four done-check commands never exercise it. Unsupervised work there passes every gate while being functionally unverified, so it is deliberately separated and done interactively.

C and D are independent of each other and can run in either order or in parallel.

---

## Phase A — Pure domain foundations ✅ DONE

Delivered via `overnight-queue.md`, branch `overnight/queue-2b-through-9`.

| # | Item | Delivered |
|---|------|-----------|
| 1 | Zotero annotation position fields | `annotationType` · `annotationPosition` · `annotationSortIndex`, parsed defensively |
| 2 | Text-anchor resolution | `findQuoteMatches` · `pickNearestMatch` · `resolveTextAnchor` |
| 2b | Whitespace normalisation | `normaliseWhitespace` with an index map — matches in normalised space, **returns original offsets** |
| 3 | S2 citation signals | `contexts` · `intents` · `isInfluential` on `CitationCandidate` |
| 4 | Cite formatters | see Phase B |
| 5 | Anchor strategy | `chooseAnchorStrategy` — rects only when the content hash matches, else quote at low confidence |
| 6 | Source ladder | `IPdfSourceResolver` · `resolvePdfSource` — caller order preserved, throwing resolvers skipped |

**Verified independently 2026-07-26:** `typecheck` 0 · `test:core` 394/394 · `check:boundaries` genuine pass with ripgrep present · `build:core` 0.

---

## Phase B — Feature logic ✅ DONE

Every item below is implemented, tested, and exported. None is wired to a screen — that is Phase C.

| Item | Roadmap | Delivered API | Tests |
|------|---------|---------------|-------|
| **Vault note templates** | **P0** | `applyTemplate` · `mergeTemplate` · `renderTemplate` · `parseRegions` · `wrapRegion` — markers `<!-- wf:generated:name -->` / `<!-- wf:editable:name -->` | 16 |
| **Multi-format citation** | P1 | `formatCitation` · `formatPaperCitation` · `resolveCiteKey` — `latex` \| `pandoc` \| `footnote` \| `raw` | 10 |
| **Directional discovery** | P1 | `contexts` / `intents` / `isInfluential` on `CitationCandidate`; `rankCitationAlerts` · `citationAlertScore` | 14 |
| **Artifact references** | P1 | `parseArtifactRefs` · `serialiseArtifactRef` · `resolveArtifactRef` — syntax `![alt](expartifact:<experimentId>/<artifactName>)` | 12 |

The hard part of the P0 was never the templating — it was re-rendering without destroying the researcher's edits. `mergeTemplate` rebuilds from the **existing** document, so unmarked text and editable regions stay byte-identical, and any damaged marker returns the original untouched rather than guessing.

---

## Phase C — UI wiring (interactive, with a human)

Make Phase B reachable. Four jobs, all small, all against APIs that already exist and are tested. None needs a migration.

| # | Job | Uses | Notes |
|---|-----|------|-------|
| C1 | **Vault note templates** | `applyTemplate` | The **P0**. Decide the default source-note template, then call `applyTemplate` from the vault and paper note flows. Re-render must be an explicit user action with a visible result — never silent on load. |
| C2 | **Citation format picker** | `formatPaperCitation` | Offer pandoc / footnote / raw alongside the existing `[[Title]]` insertion in the editor. Remember the last choice per project. |
| C3 | **Discovery + alert ranking** | `rankCitationAlerts`, `intents` | Order alerts by "should I read this?" rather than date. Show intent as a small label; `background` is the one people skip. Absent signals must not sink an item — the fallback is recency. |
| C4 | **Artifact insertion** | `parseArtifactRefs`, `serialiseArtifactRef` | A `/experiment` picker in the report editor that inserts the `expartifact:` ref. Surface the **stale** resolution outcome as a warning on the block. |

**Exit criteria:** a researcher can create a templated source note, re-render it without losing edits, insert a citation in a non-LaTeX format, see alerts ordered by usefulness, and embed an experiment figure in a report section.

**Verification is manual.** These are UI changes and the gates do not cover them. Check each in the running app, and add Playwright coverage for C1 specifically — a template merge that eats someone's notes is the one failure here with no recovery.

---

## Decisions — resolved 2026-07-25

**Not a phase.** These were a gate that blocked the reader work; all four are now decided and Phase D is unblocked. Rationale is recorded so each can be revisited on evidence rather than re-argued from scratch.

### D1 — Reader engine: **pdf.js.** `zotero/reader` documented as fallback.

Evidence gathered 2026-07-25:

| Signal | Finding |
|--------|---------|
| Maintenance | Active — last push 2026-07-24, 201 stars |
| npm | **Not published.** Neither `@zotero/reader` nor `zotero-reader` exists |
| Build | Requires `NODE_OPTIONS=--openssl-legacy-provider`, recursive git submodules, Node 18+ |
| Standalone | The `dev` variant serves `reader.html` locally, so it *can* run outside the Zotero client |

**Decision (revised 2026-07-25): pdf.js as the engine, with `zotero/reader` as a source we may lawfully copy from — by selective vendoring, not a submodule.**

Both projects are AGPL-3.0, so copying their code is permitted. We take the parts that are genuinely hard — annotation-layer geometry, text-layer handling, pdf.js integration patterns — and write our own React/Next integration around them. This avoids the submodule and their build system while still not solving solved problems from scratch. Compliance obligations are in `pdf-viewer-plan.md` §1.2; they are not optional.

The reasons below are why we do **not** adopt their engine wholesale:

1. **No npm package** means vendoring a submodule and building it from source inside our CI. That is a permanent maintenance tax on a solo project, and it is not a decision that is cheap to reverse.
2. **`--openssl-legacy-provider`** signals a legacy webpack toolchain. Our host is Next.js 14 with a Serwist service worker and a reader-chunk budget under ~1MB gzipped (`pdf-viewer-plan.md` §6). That is an impedance mismatch, not a detail.
3. **We are buying far less than the engine sells.** Per D3 below, Phase D needs a *read-only rendering surface for provenance verification*, not a full annotator. Taking the whole engine to get a viewer is over-buying.
4. **The anchor model is already renderer-agnostic** (`packages/core/src/reader/`), so choosing pdf.js costs little and preserves the option.

**Honest counter:** ZotFlow embeds this engine successfully, so it is demonstrably possible. But ZotFlow is an Obsidian plugin — Electron, no bundle budget, no SSR, no service worker. A far friendlier host than a Next.js PWA.

**What we take instead of the whole engine:** their solutions to the specific problems that are tedious to get right — mapping selection geometry to page coordinates, aligning the text layer over the canvas, and handling zoom and rotation without anchors drifting. Copied file-by-file with attribution, under §1.2 of the reader plan.

**Revisit trigger:** `zotero/reader` publishes to npm, or drops the legacy OpenSSL requirement.

### D2 — Zotero write-back: **deferred. Phase D is read-only.**

The API spike needs live credentials and mutates a real Zotero library, so it cannot be done unsupervised. Rather than let that block everything, **remove it from the critical path**: Phase D reads and renders annotations, and creates none.

This costs little. Annotations already sync inbound (§6.1), and the provenance UI — the actual P0 — only needs to *display* evidence. Write-back becomes its own later decision with its own spike, when a human can watch it.

### D3 — Brief §11 amendment: **narrow, not broad.**

Amend the non-goal to permit **a read-only PDF rendering surface for provenance verification and jump-to-locus**. Explicitly still non-goals: creating or editing annotations in-app, becoming a PDF storage service, replacing Zotero as system of record.

This is a smaller change than `pdf-viewer-plan.md` §2 originally proposed, and it follows from D1 and D2 rather than driving them.

### D4 — Migration policy for agent work: **write, never apply.**

An agent **may author** migration files under `supabase/migrations/` when a task requires schema. It must **never apply, run, or otherwise execute them** against any database, and must never modify an existing migration.

Each new migration is committed as a file for human review and application. This unblocks persistence design without letting unsupervised work touch data. `overnight-queue.md`'s never-touch list is amended accordingly.

---

## Phase D — Reader and provenance (read-only)

**Unblocked.** Scope set by D1 (pdf.js), D2 (read-only), D3 (narrow non-goal), D4 (migrations authored not applied).

| Item | Roadmap | Effort | Notes |
|------|---------|--------|-------|
| Locus persistence | — | M | Migration **authored** for stored anchors; a human applies it (D4). |
| pdf.js render surface | — | M | Read-only. Dynamic import, worker off main thread, virtualised pages, text layer on demand. Chunk budget ~1MB gzipped; **zero bytes added to first paint on non-reader routes**. |
| Jump-to-locus | P1 | M | Uses A-2/2b/5. Resolve by quote, fall back to position, surface low confidence rather than jumping wrong. |
| **Provenance UI at `/ai-review`** | **P0** | M | Split pane: proposed write on one side, source excerpt with the used sentence highlighted on the other, surrounding context dimmed. **Design for a review queue, not a chat pane** — that constraint is what makes it ours rather than a copy of Elicit. |

**Not in this phase** (D2): creating, editing, or writing back annotations. Existing Zotero annotations render read-only.

**Exit criteria:** an AI proposal at `/ai-review` shows claim-level evidence, and clicking it opens the source at the exact locus without leaving the app.

---

## Phase E — AI-assisted extraction column fill

**Roadmap: P0, M effort, high impact.** Placed after D because it inherits D's provenance UI — filled cells need the same evidence affordance, and building it twice would be waste.

- Column-level "propose fill" on the extraction table (§6.3)
- Executes through the MCP browser relay; cells populate as **pending**, never silent writes (§6.16, §11)
- Approval at `/ai-review` with provenance per cell

**Competitive note:** Elicit caps extraction at 20 columns on Pro, 30 on Scale, 40 on Enterprise. Our table has no ceiling — that is the differentiator to hold, so do not introduce one here.

**Exit criteria:** a researcher fills a column across a reading list, reviews every proposed value with its source, and approves or rejects per cell.

---

## Phase F — P2 tail

| Item | Effort | Notes |
|------|--------|-------|
| First-class quotation types | S | Direct / paraphrase / summary on annotation cards (§6.1). Citavi-style; cheap once D exists. |
| Lab snapshot publishing | L | OSF-style freeze-and-publish to a supervisor instead of raw log exposure (§5). Needs a migration. |

---

## Parallel track — billing

`billing-and-quota-plan.md` is independent of everything above. Its Phases 1–2 (usage metering, then a read-only usage screen) are safe to ship at any time and are useful with no pricing attached. Do not start Phase 3 enforcement until real telemetry exists — that is the plan's own instruction and `COMMERCIALIZATION_AND_COST_PLAN.md` agrees.

---

## Explicitly not doing

From `competitive-research-verified-2026-07.md` §5 and §6, unchanged:

- **Typst as an authoring target** — no `.tex` export exists, no major publisher accepts Typst source, 8–12MB compressed WASM against an offline-first PWA. Revisit trigger: a major venue accepts Typst source, or official `.tex` export lands.
- **Plugin marketplace** — the opinionated schema is the advantage.
- **MLOps cluster orchestration** — outside the thesis-map scope.
- **Becoming a PDF library** — the reader renders and annotates; Zotero stays the system of record.

---

## Sequencing summary

| Phase | Gate | Roadmap items delivered |
|-------|------|------------------------|
| **A** | — | ✅ anchors · citation signals · source ladder · Zotero position fields |
| **B** | A | ✅ **P0** template engine · P1 cite formatters · P1 alert ranking · P1 artifact refs |
| **C** | B | **P0** vault templates UI · P1 citation picker · P1 alert ordering · P1 artifact insertion |
| **D** | A | **P0** provenance UI · P1 deep links (read-only) |
| **E** | D | **P0** AI extraction fill |
| **F** | D | P2 quotation types · P2 lab snapshots |

**Nothing is waiting on a decision.** C and D are independent — run them in either order, or in parallel.

**C is the shortest path to user-visible value.** All four jobs are small, need no migrations, and sit on APIs that already exist and are tested. C1 alone closes the P0 that the competitive research named as the leading threat's strongest draw.

## Deferred decisions, with triggers

Not blockers. Each has a defined moment to revisit rather than an open question sitting on the board.

| Deferred | Revisit when |
|----------|--------------|
| `zotero/reader` as engine | it publishes to npm, or drops `--openssl-legacy-provider` |
| Zotero annotation write-back | a human can supervise a spike against a real library, including a **group** library |
| Typst authoring target | a major venue accepts Typst source, or official `.tex` export lands |
| Server-side PDF storage | a user actually asks for it; it stays opt-in and quota'd regardless |
