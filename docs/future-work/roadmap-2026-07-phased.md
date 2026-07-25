# WeaveForge — phased delivery plan (July 2026 roadmap)

**Date:** 2026-07-25
**Source of priorities:** `docs/competitive-research-verified-2026-07.md` §6 — a P0/P1/P2 list with effort × impact, but no sequencing.
**This document** turns that list into ordered phases with dependencies, decision gates, and exit criteria.

## Why this exists

Two phase-wise plans already exist and are **both complete**:

| Plan | Scope | Status |
|------|-------|--------|
| `competitive-scan-implementation-plan.md` | Earlier internal scan — cite identity, discovery, library UX | Phases 0–5 **all done** |
| `library-knowledge-loop-plan.md` | Annotation cards, pins, custom fields, extraction table, rollups | Phases 0–7 **all done** (migrations `0103`–`0105`) |

Both predate the verified competitive research, so neither accounts for ZotFlow, the Weights & Biases downgrade, or Elicit's extraction ceiling. Two newer plans cover single features in depth (`pdf-viewer-plan.md`, `billing-and-quota-plan.md`) but neither sequences the roadmap as a whole. This document is the missing layer above them.

---

## Dependency map

```
Phase A  pure domain (no UI, no migrations, no network)
   |
   +--> Phase B  independent features        [no decisions needed]
   |
   +--> Phase C  DECISION GATE               [human required]
              |
              +--> Phase D  reader + provenance
                       |
                       +--> Phase E  AI-assisted extraction fill
                                |
                                +--> Phase F  P2 tail
```

Phase B runs in parallel with C and D. Nothing in B is blocked by the reader decision — that is the point of splitting it out.

---

## Phase A — Pure domain foundations

**Status: in flight.** Tracked in `overnight-queue.md`.

| # | Item | Roadmap ref | State |
|---|------|-------------|-------|
| 1 | Zotero annotation position fields | enables P1 anchors | ✅ done (`05db56f`, `a71f536`) |
| 2 | Text-anchor resolution | P1 deep links | ✅ done (`e1781cc`, `bdc0250`) |
| 2b | Whitespace normalisation | P1 deep links | ⬜ required fix |
| 3 | S2 `contexts` / `intents` / `isInfluential` | P1 discovery filters | ⬜ |
| 4 | Multi-format cite formatters | P1 multi-format citation | ⬜ |
| 5 | Zotero rects ↔ `PdfLocus` bridge | P1 deep links | ⬜ |
| 6 | Source resolution ladder ordering | reader §4 | ⬜ |

**Exit criteria:** all seven green on `typecheck`, `test:core`, `check:boundaries`, `build:core` — with ripgrep genuinely present, or the SOLID gate is a no-op.

---

## Phase B — Independent features (start any time)

None of these depend on the reader decision. Highest value per unit of effort in the whole roadmap.

| Item | Roadmap | Effort | Depends on | Notes |
|------|---------|--------|-----------|-------|
| **Vault note templates** | **P0** | S | nothing | Highest priority unblocked item. ZotFlow's LiquidJS templating is its single strongest draw and §6.9 has no equivalent. **Copy the editable-region mechanic** — re-rendering a template must not clobber the researcher's own edits. That is the hard part, not the templating. |
| **Multi-format citation wiring** | P1 | S | A-4 | Wire the pure formatters into the editor: Pandoc, footnote, raw citekey alongside `[[Title]]`. |
| **Directional discovery filters** | P1 | S | A-3 | "Prior art" / "later work" on related papers; surface `intents` and `isInfluential` on alerts. These *reduce* alert volume, which is what the question asked for. |
| **Artifact-to-report pinning** | P1 | S | nothing | Insert `experiment-artifacts` plots into report sections. Stands on merit — **not** a defence against W&B, which verification showed is in maintenance. |

**Exit criteria:** each shipped behind its own tests; no migration required for templates, citation wiring, or discovery filters. Artifact pinning may need a small migration — treat that as its own gate.

---

## Phase C — Decisions ✅ RESOLVED 2026-07-25

All four are decided. Phase D is unblocked. Rationale recorded so each can be revisited on evidence rather than re-argued from scratch.

### C1 — Reader engine: **pdf.js.** `zotero/reader` documented as fallback.

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
3. **We are buying far less than the engine sells.** Per C3 below, Phase D needs a *read-only rendering surface for provenance verification*, not a full annotator. Taking the whole engine to get a viewer is over-buying.
4. **The anchor model is already renderer-agnostic** (`packages/core/src/reader/`), so choosing pdf.js costs little and preserves the option.

**Honest counter:** ZotFlow embeds this engine successfully, so it is demonstrably possible. But ZotFlow is an Obsidian plugin — Electron, no bundle budget, no SSR, no service worker. A far friendlier host than a Next.js PWA.

**What we take instead of the whole engine:** their solutions to the specific problems that are tedious to get right — mapping selection geometry to page coordinates, aligning the text layer over the canvas, and handling zoom and rotation without anchors drifting. Copied file-by-file with attribution, under §1.2 of the reader plan.

**Revisit trigger:** `zotero/reader` publishes to npm, or drops the legacy OpenSSL requirement.

### C2 — Zotero write-back: **deferred. Phase D is read-only.**

The API spike needs live credentials and mutates a real Zotero library, so it cannot be done unsupervised. Rather than let that block everything, **remove it from the critical path**: Phase D reads and renders annotations, and creates none.

This costs little. Annotations already sync inbound (§6.1), and the provenance UI — the actual P0 — only needs to *display* evidence. Write-back becomes its own later decision with its own spike, when a human can watch it.

### C3 — Brief §11 amendment: **narrow, not broad.**

Amend the non-goal to permit **a read-only PDF rendering surface for provenance verification and jump-to-locus**. Explicitly still non-goals: creating or editing annotations in-app, becoming a PDF storage service, replacing Zotero as system of record.

This is a smaller change than `pdf-viewer-plan.md` §2 originally proposed, and it follows from C1 and C2 rather than driving them.

### C4 — Migration policy for agent work: **write, never apply.**

An agent **may author** migration files under `supabase/migrations/` when a task requires schema. It must **never apply, run, or otherwise execute them** against any database, and must never modify an existing migration.

Each new migration is committed as a file for human review and application. This unblocks persistence design without letting unsupervised work touch data. `overnight-queue.md`'s never-touch list is amended accordingly.

---

## Phase D — Reader and provenance (read-only)

**Unblocked.** Scope set by C1 (pdf.js), C2 (read-only), C3 (narrow non-goal), C4 (migrations authored not applied).

| Item | Roadmap | Effort | Notes |
|------|---------|--------|-------|
| Locus persistence | — | M | Migration **authored** for stored anchors; a human applies it (C4). |
| pdf.js render surface | — | M | Read-only. Dynamic import, worker off main thread, virtualised pages, text layer on demand. Chunk budget ~1MB gzipped; **zero bytes added to first paint on non-reader routes**. |
| Jump-to-locus | P1 | M | Uses A-2/2b/5. Resolve by quote, fall back to position, surface low confidence rather than jumping wrong. |
| **Provenance UI at `/ai-review`** | **P0** | M | Split pane: proposed write on one side, source excerpt with the used sentence highlighted on the other, surrounding context dimmed. **Design for a review queue, not a chat pane** — that constraint is what makes it ours rather than a copy of Elicit. |

**Not in this phase** (C2): creating, editing, or writing back annotations. Existing Zotero annotations render read-only.

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
| **A** | none — in flight | foundations for P1 anchors, discovery, citation |
| **B** | none | **P0** vault templates · P1 citation wiring · P1 discovery filters · P1 artifact pinning |
| **C** | ✅ resolved 2026-07-25 | — |
| **D** | unblocked | **P0** provenance UI · P1 deep links (read-only) |
| **E** | D | **P0** AI extraction fill |
| **F** | D | P2 quotation types · P2 lab snapshots |

**Every gate is now closed and nothing is waiting on a decision.** A and B can run in parallel; D follows A.

## Deferred decisions, with triggers

Not blockers. Each has a defined moment to revisit rather than an open question sitting on the board.

| Deferred | Revisit when |
|----------|--------------|
| `zotero/reader` as engine | it publishes to npm, or drops `--openssl-legacy-provider` |
| Zotero annotation write-back | a human can supervise a spike against a real library, including a **group** library |
| Typst authoring target | a major venue accepts Typst source, or official `.tex` export lands |
| Server-side PDF storage | a user actually asks for it; it stays opt-in and quota'd regardless |
