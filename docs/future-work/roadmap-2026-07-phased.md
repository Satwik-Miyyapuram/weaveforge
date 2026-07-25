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

## Phase C — Decision gate (human required)

Nothing in Phase D can start until these are answered. All four are cheap to answer and expensive to guess.

| # | Decision | Where | Blocks |
|---|----------|-------|--------|
| C1 | **Reader engine** — `zotero/reader` (AGPL, now available to us) vs pdf.js | `pdf-viewer-plan.md` §1.1, six pass/fail criteria | All of Phase D |
| C2 | **Zotero annotation write-back** — run the API spike, test a group library | `pdf-viewer-plan.md` §5.3 | Annotation sync scope |
| C3 | **Brief §11 amendment** — the in-app reader non-goal | `pdf-viewer-plan.md` §2 | Formal scope of D |
| C4 | **Migration policy for agent work** — currently on the never-touch list | `overnight-queue.md` | Persistence in D |

C1 is the big one: if `zotero/reader` runs standalone at acceptable size, Phase D shrinks dramatically and brings EPUB and HTML with it.

---

## Phase D — Reader and provenance

**Blocked by C1–C4.** This is where the P0 provenance UI lands.

| Item | Roadmap | Effort | Notes |
|------|---------|--------|-------|
| Locus persistence | — | M | Migration for stored anchors. Gated on C4. |
| Reader integration | — | M–L | Size depends entirely on C1. |
| Jump-to-locus | P1 | M | Uses A-2/2b/5. Works without a viewer by handing off externally; better with one. |
| **Provenance UI at `/ai-review`** | **P0** | M | Split pane: proposed write on one side, source excerpt with the used sentence highlighted on the other. **Design for a review queue, not a chat pane** — that constraint is what makes it ours rather than a copy of Elicit. |

**Exit criteria:** an AI proposal at `/ai-review` shows claim-level evidence, and clicking it reaches the exact source locus.

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
| **C** | human decisions | — |
| **D** | C1–C4 | **P0** provenance UI · P1 deep links |
| **E** | D | **P0** AI extraction fill |
| **F** | D | P2 quotation types · P2 lab snapshots |

**Do B while C is being decided.** It contains a P0 at S effort and needs no decisions — leaving it idle behind the reader gate is the most likely way to waste the next fortnight.
