# WeaveForge — phased delivery plan (July 2026 roadmap)

**Date:** 2026-07-25 · **Last updated:** 2026-07-27
**Source of priorities:** `docs/competitive-research-verified-2026-07.md` §6 — a P0/P1/P2 list with effort × impact, but no sequencing.
**This document** turns that list into ordered phases with dependencies and exit criteria. Phase letters label work (A–F); the resolved decisions are labelled D1–D4 because they scope the reader phase, and are not themselves a phase.

## The gate — run `npm run check:all` before calling any phase done

Added 2026-07-27, after a Phase C/D review found two failures that had survived **eleven** review-and-harden loops. Neither could have been caught, because nothing ran the check that fails:

1. **The production build was broken.** `api/pdf-proxy/route.ts` exported helpers "for unit tests". A Next.js App Router route module may export only route handlers and route config, so `next build` failed on its generated route types — while `tsc --noEmit` passed clean. **`typecheck` is not a proxy for `build`.**
2. **`next lint` failed with an error**, not a warning, on a `react-hooks/exhaustive-deps` violation. Lint was in no aggregate gate.

Two further blind spots found at the same time:

3. **No script ran the web unit tests.** `check:boundaries` and `test:core` both passed while 282 web tests sat unrun unless invoked per-workspace.
4. **The web test glob missed files.** `src/**/test/*.test.ts` requires a directory literally named `test`, so `src/lib/recent-targets.test.ts` had never run. Widened to `src/**/*.test.ts`; the count went 282 → 284.

```bash
npm run check:all
```

That is `typecheck` → `lint` → `check:boundaries` → `test:core` → `test:web` → `build`, in that order — cheapest signal first, the ~2-minute build last. A phase is not done until this exits 0.

**Integration tests are not in `check:all`** because they need live Supabase credentials. They were also silently self-skipping: `test:integration` never loaded `.env.local` or `local-dev/test-accounts.env`, so the guard clause tripped every run and the output read as passing. Fixed with a `--import ./scripts/load-test-env.ts` preload. Run them separately, and read "skipped" as "not verified":

```bash
npm run test:integration:web
```

---

## Why this exists

Two phase-wise plans already exist and are **both complete**:

| Plan | Scope | Status |
|------|-------|--------|
| [`../completed/competitive-scan-implementation-plan.md`](../completed/competitive-scan-implementation-plan.md) | Earlier internal scan — cite identity, discovery, library UX | Phases 0–5 **all done** |
| [`../completed/library-knowledge-loop-plan.md`](../completed/library-knowledge-loop-plan.md) | Annotation cards, pins, custom fields, extraction table, rollups | Phases 0–7 **all done** (migrations `0103`–`0105`) |

Both predate the verified competitive research, so neither accounts for ZotFlow, the Weights & Biases downgrade, or Elicit's extraction ceiling. Two newer plans cover single features in depth ([`../completed/pdf-viewer-plan.md`](../completed/pdf-viewer-plan.md), [`../future/billing-and-quota-plan.md`](../future/billing-and-quota-plan.md)) but neither sequences the roadmap as a whole. This document is the missing layer above them.

---

## Status at a glance (2026-07-27)

| Phase | Contents | State |
|-------|----------|-------|
| **A** | Pure domain foundations | ✅ **done** |
| **B** | Feature logic — templates, citations, artifacts, ranking | ✅ **done** |
| **C** | UI wiring — make B reachable by users | ✅ **done** |
| **D** | Reader + provenance (read-only) | ✅ **done** — exit criteria met; `0106` applied |
| **E** | **AI-assisted extraction fill** | ✅ **done** |
| **F** | P2 tail | ✅ **done** |

A and B were delivered on branch `overnight/queue-2b-through-9`. C and D followed on `phase-c-d/ui-and-reader`. Current tree: 406 core tests, 290 web tests, 1 integration test, `npm run check:all` exits 0.

**All six phases are delivered.** Migrations `0106`–`0108` were applied by a human on 2026-07-27; `paper_locus_anchors`, `annotation_quotation_types`, and `lab_snapshots` are live and verified against the project.

### Outstanding after the 2026-07-27 review

**`0109_phase_f_corrections.sql` — authored, needs applying.** Two defects found reviewing Phase F *after* 0107/0108 went live. Because those files are applied, they are left untouched (D4) and the fixes are forward-only:

1. `annotation_quotation_types.updated_at` had no trigger, so it held the insert time forever. Quotation types are re-classified in place (direct → paraphrase), so the column was silently wrong rather than merely unused. 0107 mirrors `annotation_pins` (0103), which has no `updated_at` at all — which is why the omission was easy to miss.
2. `lab_snapshots` granted UPDATE to the owner, which defeats the freeze. The table exists so a supervisee controls what the supervisor reviews; an owner who can rewrite `content` after publishing means the supervisor cannot trust what they are reading, and `published_at` does not move on update, so the change leaves no trace. No application code ever called update, so removing it breaks nothing.

**The reader is being taken further — see [`reader-and-annotation-plan.md`](reader-and-annotation-plan.md).** Phases R0–R6 turn the provenance pane into a full annotation surface and then into Zotero write-back. D3 is superseded and D2 is scheduled as R5. R0 alone (fit-width, zoom, rotate, page controls) fixes the reader rendering every PDF at a fixed 135% and overflowing the pane.

**The old PDF reader plan is mis-filed.** `docs/plans/completed/pdf-viewer-plan.md` sits under `completed/` but is only partially delivered — Phase D built what `/ai-review` needed and correctly stopped. Missing from its own Phase 1: the source-resolution ladder (`packages/core/src/reader/pdf-source-ladder.ts` is implemented and **never called**), an IndexedDB byte cache, zoom/rotate/page controls, **a text layer at all** (so no text selection or copy), and Zotero annotation overlays. Phases 2–4 are undelivered, and Phase 2 is deferred by decision (D2/D3), not oversight. The document now carries a verified status table at the top; consider moving it back to `current/`.

## Dependency map

```
Phase A  pure domain            [DONE]
   |
   +--> Phase B  feature logic  [DONE]
            |
            +--> Phase C  UI wiring              [DONE]
            |
            +--> Phase D  reader + provenance    [DONE]
                     |
                     +--> Phase E  AI-assisted extraction fill   [DONE]
                              |
                              +--> Phase F  P2 tail   [DONE]
```

**Why UI is its own phase.** Web UI still has no unit-test coverage in this repo — 81 test files under `apps/web/src`, none touching `.tsx` — and `check:all` does not exercise rendered behaviour. Unsupervised work there passes every gate while being functionally unverified, so it is deliberately separated and done interactively. `check:all` now at least catches the *build* and lint failures that `typecheck` alone missed; it still cannot tell you a screen looks right.

C and D were independent of each other and shipped together on one branch.

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

## Phase C — UI wiring ✅ DONE

Make Phase B reachable. Four jobs, all small, all against APIs that already exist and are tested. None needs a migration.

| # | Job | Uses | Notes |
|---|-----|------|-------|
| C1 | **Vault note templates** | `applyTemplate` | The **P0**. Decide the default source-note template, then call `applyTemplate` from the vault and paper note flows. Re-render must be an explicit user action with a visible result — never silent on load. |
| C2 | **Citation format picker** | `formatPaperCitation` | Offer pandoc / footnote / raw alongside the existing `[[Title]]` insertion in the editor. Remember the last choice per project. |
| C3 | **Discovery + alert ranking** | `rankCitationAlerts`, `intents` | Order alerts by "should I read this?" rather than date. Show intent as a small label; `background` is the one people skip. Absent signals must not sink an item — the fallback is recency. |
| C4 | **Artifact insertion** | `parseArtifactRefs`, `serialiseArtifactRef` | A `/experiment` picker in the report editor that inserts the `expartifact:` ref. Surface the **stale** resolution outcome as a warning on the block. |

**Exit criteria:** a researcher can create a templated source note, re-render it without losing edits, insert a citation in a non-LaTeX format, see alerts ordered by usefulness, and embed an experiment figure in a report section.

**Verification is manual.** These are UI changes and the gates do not cover them. Check each in the running app, and add Playwright coverage for C1 specifically — a template merge that eats someone's notes is the one failure here with no recovery.

### Delivered 2026-07-26 — review findings

| # | State | Evidence |
|---|-------|----------|
| C1 | **Done.** `reRenderPaperSourceNote` behind an explicit "Re-render template" button. The no-marker path prompts APPEND/REPLACE before it can discard a draft. `mergeTemplate` fails closed on any marker damage. Playwright coverage exists (`e2e/template-notes.spec.ts`) and asserts a sentinel survives a re-render. | `papers-list.tsx`, `note-template-engine.ts` |
| C2 | **Done.** `CitationFormatSelect` in the paper and report editors; preference is per-project, keyed `thesis.citeFormat.<projectId>`. | `use-citation-format-preference.ts` |
| C3 | **Done.** `rankCitationAlerts` orders the alert, and `intentLabel` renders the strongest intent as an inline `` `label` `` per row (`influential · result`, `method`, `background`). Alerts surface as a **logbook entry**, not a list screen — which is why the label lives in `check-citation-alerts.use-case.ts` rather than a `.tsx`. `background` sinks by ranking rather than being hidden. | `rank-citation-alerts.ts`, `check-citation-alerts.use-case.ts` |
| C4 | **Done.** `ExperimentArtifactPicker` inserts `expartifact:` refs; stale resolution surfaces as a warning on the block. | `experiment-artifact-picker.tsx` |

**Phase C is complete.** All four exit criteria are met.

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

### D2 — Zotero write-back: **deferred → SCHEDULED 2026-07-27 as R5.**

*Original decision:* the API spike needs live credentials and mutates a real Zotero library, so it cannot be done unsupervised. Rather than let that block everything, it was removed from the critical path — Phase D reads and renders annotations, and creates none.

**Still true, and still the reason it is late in the order.** What changed is that it is now on the schedule rather than pending a future decision: [`reader-and-annotation-plan.md`](reader-and-annotation-plan.md) R5, after local annotation works. The supervision requirement is unchanged — R5 spikes against a scratch library with a human watching.

### D3 — Brief §11 amendment: ~~narrow, not broad~~ **SUPERSEDED 2026-07-27.**

*Original decision:* permit only a read-only rendering surface for provenance verification, keeping "creating or editing annotations in-app" a non-goal.

**That was correct for shipping `/ai-review` and wrong as a resting place.** What it produced is a pane that renders a PDF at a fixed 135% zoom with no controls, no text selection, and no annotations — it verifies AI claims and does nothing else a researcher wants.

**New position:** the reader is a first-class reading *and annotation* surface. See [`reader-and-annotation-plan.md`](reader-and-annotation-plan.md) §1. Brief §11's "Full in-app PDF annotator (Zotero owns PDFs/annotations)" is now wrong on both halves and should be struck rather than narrowed. Zotero stays the system of record for the *library*; annotations are ours to create and sync back.

Non-goals that survive: becoming a PDF storage service by default, an OCR pipeline, or a Zotero replacement.

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

### Delivered 2026-07-26 — review findings

**Exit criteria met.** `/ai-review` renders a split pane with the used sentence highlighted and the surrounding context dimmed; "Open source at this passage" builds the locus link from `evidence.paperId` rather than trusting a stored href, and `/reader` resolves it.

Bundle claim verified against a real production build: `/reader` is 5.24 kB (124 kB first load) while every other route is unchanged at 478 kB, and pdf.js is absent from the 91.2 kB shared chunk. "Zero bytes added to first paint on non-reader routes" holds.

| Item | State |
|------|-------|
| pdf.js render surface | **Done.** Dynamic import, worker served same-origin from `public/` via `copy-pdf-worker.mjs`, pages render lazily on intersection. |
| Jump-to-locus | **Done.** Text-scan before paint, hinted page first, low confidence surfaced rather than jumping wrong. `resolveTextAnchor` now normalises whitespace (incl. soft hyphens at line wraps) and maps spans back to original offsets. |
| Provenance UI at `/ai-review` | **Done.** Split pane, per-claim evidence, "unverified match" and "locus not found" warnings. |
| Locus persistence | **Schema only.** `0106_paper_locus_anchors.sql` is authored with owner-only RLS and, per D4, not applied. **No code reads or writes the table** — loci travel inline in the deep link today. Persistence is real work still outstanding; the exit criteria do not depend on it. |

A same-origin PDF proxy (`/api/pdf-proxy`) was added beyond the original scope, because publishers omit CORS headers. It is authenticated, restricted to an https host allowlist, re-validates the allowlist on every redirect hop, sniffs `%PDF` magic bytes, and caps the streamed body at 80 MiB.

---

## Phase E — AI-assisted extraction column fill ✅ DONE

**Roadmap: P0, M effort, high impact.** Placed after D because it inherits D's provenance UI — filled cells need the same evidence affordance, and building it twice would be waste.

- Column-level "propose fill" on the extraction table (§6.3)
- Executes through the MCP browser relay; cells populate as **pending**, never silent writes (§6.16, §11)
- Approval at `/ai-review` with provenance per cell

**Competitive note:** Elicit caps extraction at 20 columns on Pro, 30 on Scale, 40 on Enterprise. Our table has no ceiling — that is the differentiator to hold, so do not introduce one here.

**Exit criteria:** a researcher fills a column across a reading list, reviews every proposed value with its source, and approves or rejects per cell.

### Delivered 2026-07-27 — review findings

**Exit criteria met** for the product path (MCP agent → pending → `/ai-review`). The extraction-table **Propose fill** button copies an agent prompt only — it never enqueues stub values (Option A). Tests exercise pending join / executor via direct `proposeDraft`-style payloads (Option B, tests only).

| Item | State |
|------|-------|
| `propose_paper_field_value` MCP tool | **Done.** Requires `sourceId` + `quoteExact`; builds `AiEvidence` like append-note. |
| Executor | **Done.** `paper_field_value` → `ManagePaperFieldsUseCase.setValue`; revision conflict; fail-closed value parse. |
| Extraction table UX | **Done.** Column **Propose fill** → copy prompt; pending hatch + banner → `/ai-review`; direct edit blocked while pending. |
| `/ai-review` | **Done.** Per-cell labels; excluded from “Approve all safe additions”. |
| Column ceiling | **None.** |

---

## Phase F — P2 tail ✅ DONE

| Item | Effort | Notes |
|------|--------|-------|
| First-class quotation types | S | Direct / paraphrase / summary on annotation cards (§6.1). Citavi-style; cheap once D exists. |
| Lab snapshot publishing | L | OSF-style freeze-and-publish to a supervisor instead of raw log exposure (§5). Needs a migration. |

### Delivered 2026-07-27 — review findings

**Exit criteria met** for the product path.

| Item | State |
|------|-------|
| Quotation types | **Done.** Side table `annotation_quotation_types` (`0107`, **applied 2026-07-27**); selector on annotation cards; survives Zotero sync. Keying on `(project, paper, annotation_key)` mirrors `annotation_pins` (`0103`) and is what makes it survive a sync that replaces `papers.metadata.annotations`. |
| Lab snapshots | **Done.** `lab_snapshots` (`0108`, **applied 2026-07-27**); publish from logbook; `/supervision` prefers published freezes, falls back to live plan/log. `SELECT` widens to `can_access(user_id)` — the same supervisor-subtree function milestones and logs have used since `0015` — so no new exposure path was invented for this table. |

**Two defects found reviewing the applied migrations; fixed forward in `0109` (see the status section at the top).** `updated_at` on the quotation types table was never maintained, and `lab_snapshots` allowed the owner to edit a published snapshot, which defeats the freeze the supervisor is meant to trust.

---

## Parallel track — billing

`billing-and-quota-plan.md` is independent of everything above. Its Phases 1–2 (usage metering, then a read-only usage screen) are safe to ship at any time and are useful with no pricing attached. Do not start Phase 3 enforcement until real telemetry exists — that is the plan's own instruction and [`../future/COMMERCIALIZATION_AND_COST_PLAN.md`](../future/COMMERCIALIZATION_AND_COST_PLAN.md) agrees.

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
| **E** | D | ✅ **P0** AI extraction fill |
| **F** | D | ✅ P2 quotation types · P2 lab snapshots |

**Nothing is waiting on a decision.** Roadmap phases A–F are complete.

## Deferred decisions, with triggers

Not blockers. Each has a defined moment to revisit rather than an open question sitting on the board.

| Deferred | Revisit when |
|----------|--------------|
| `zotero/reader` as engine | it publishes to npm, or drops `--openssl-legacy-provider` |
| Zotero annotation write-back | a human can supervise a spike against a real library, including a **group** library |
| Typst authoring target | a major venue accepts Typst source, or official `.tex` export lands |
| Server-side PDF storage | a user actually asks for it; it stays opt-in and quota'd regardless |
