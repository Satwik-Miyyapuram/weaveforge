# Competitive scan — phase-wise implementation plan

Canonical strategy: [`../../competitive-scan.md`](../../strategy/competitive-scan.md).  
This document is the **build plan**: phases, acceptance criteria, and primary code entry points.

Branch: `feat/cite-excerpt-report-tabs` (cite/excerpt/report tabs + LaTeX `\cite` already in progress).

---

## Status (as of implementation pass)

| Phase | Status |
|-------|--------|
| 0 Foundation | Done on branch |
| 1 Connect pillars | Done |
| 2 Cite identity & source notes | Done (citeKey + page + paper excerpts TOC) |
| 3 Discovery | Done (Find related → add to library; not AI Review queue) |
| 4 Library UX | Done (board + Ctrl/Cmd+K jump) |
| 5 Documentation | Done |

Phase 3 ships **direct add to library** rather than AI Review proposals (avoids requiring an AI session grant for a common action). Alerts / Elicit tables remain follow-ups in the competitive scan.

---

## Goals

Connect the write loop first (excerpts ↔ report ↔ cite), then light up discovery and library polish, then document usage.

Non-goals stay as in the competitive scan (no infinite canvas, no in-app PDF highlighter, no Word CWYW, no discovery destination app).

---

## Phase 0 — Foundation (already done / in branch)

| Item | Status |
|------|--------|
| Report SubNav: Sections / Overleaf | Done |
| Zotero sync → vault excerpt notes under `Excerpts/` | Done |
| Cite AC `[[` + `@` → `[[Title]]` | Done |
| Graph: report nodes + wikilinks from vault / paper / section | Done |
| Overleaf: `[[Paper]]` → `\cite{key}` | Done |

**Accept:** existing unit tests for excerpts, graph wikilinks, markdown-to-latex cites, Overleaf export.

---

## Phase 1 — Connect pillars (Citavi / EndNote / Liquid)

| # | Work | Entry points | Accept |
|---|------|--------------|--------|
| 1.1 | Pin excerpt → report section via frontmatter `report_section_id` (+ UI to assign) | `sync-annotation-excerpts.ts`, SectionNote / excerpt helpers | Can set section on excerpt; filter by section |
| 1.2 | Related excerpts pane on section writing view | `section-note.tsx` | While editing/viewing a section, list pin-matched + paper-linked excerpts; insert blockquote+wikilink |
| 1.3 | Copy quote + cite from paper annotations | `PaperAnnotations` in `papers-list.tsx` | Clipboard gets `> quote` + `[[Paper Title]]` |
| 1.4 | Cite AC labels: Author (year) · title | `use-cite-links.ts`, `markdown-code-editor.tsx` | Completions show author/year; still insert `[[Title]]` |

---

## Phase 2 — Cite identity & source notes

| # | Work | Entry points | Accept |
|---|------|--------------|--------|
| 2.1 | Prefer stable citekeys (`metadata.citeKey` / BBT / bibtex key) in export | `build-overleaf-export.ts` `bibKey` | Same paper → same `\cite` key across exports when citeKey set |
| 2.2 | Store page/locus on excerpts when annotation has page | `BibliographyAnnotation`, sync helper | Frontmatter `page` when available |
| 2.3 | Paper note: linked excerpts TOC | `papers-list.tsx` PaperNote | List excerpt vault notes for this paper with open links |

---

## Phase 3 — Discovery (ResearchRabbit-lite)

| # | Work | Entry points | Accept |
|---|------|--------------|--------|
| 3.1 | “Find related” on a paper → AI Review `zotero_import` proposals | S2 client + `AiAssistantFacade.proposeZoteroImport` | Button proposes 3–10 non-local related papers for review |
| 3.2 | Optional: after import, offer cite relation | `propose_relation` / link citations | Soft; skip if timeboxed |

Scope: Semantic Scholar recommendations or citation neighbors only — no new canvas.

---

## Phase 4 — Library UX polish

| # | Work | Entry points | Accept |
|---|------|--------------|--------|
| 4.1 | Papers board layout by status | `papers-list.tsx` `PapersLayout` | cards \| list \| board |
| 4.2 | Lightweight cross-surface “Jump to…” (papers/notes/sections) | header or modal using `loadCiteLinkCatalog` | Cmd/Ctrl+K or header search opens picker |

Skip full omnisearch / recents DB if too large — picker over cite catalog is enough.

---

## Phase 5 — Documentation

| # | Work | Accept | Status |
|---|------|--------|--------|
| 5.1 | User-facing usage guide: excerpts, cite, Overleaf `\cite`, related papers | `docs/using/citations-and-overleaf.md` | Done |
| 5.2 | Update `docs/building/dev.md`, `docs/using/integrations.md` pointers | Linked from competitive scan | Done |
| 5.3 | Retire duplicate `docs/future-work/research-apps-takeaways.md` → redirect to competitive-scan | Single canonical strategy doc | Done |
| 5.4 | Note this plan status in competitive-scan / BACKLOG | Readers know what’s shipped | Done |

---

## Delivery order

```
Phase 0 (done) → 1 → 2 → 3 → 4 → 5
```

Verify after each phase: `npx tsc --noEmit -p apps/web` and targeted unit tests.

---

## Out of scope this plan

- Infinite canvas / Theme Studio
- In-app PDF reader/highlighter
- Word / Google Docs plugins
- Saved-search citation alerts (steal #9) — shipped separately ([PR #33](https://github.com/Satwik-Miyyapuram/weaveforge/pull/33))
- Elicit-style extraction tables (steal #8), Notion relation/rollup properties, templated source notes (#4) and recents (#11) — planned in [`library-knowledge-loop-plan.md`](library-knowledge-loop-plan.md)
