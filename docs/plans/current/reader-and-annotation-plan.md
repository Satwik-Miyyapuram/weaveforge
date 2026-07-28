# Reader and annotation — full implementation plan

**Date:** 2026-07-27
**Status:** Current. This is the active plan for the reader.
**Supersedes:** the reader sections of [`../completed/pdf-viewer-plan.md`](../completed/pdf-viewer-plan.md) (§8 Phases 1–4). That document's licensing analysis (§1), source ladder (§4), anchor design (§5), and ZotFlow parity checklist (§8.1) remain authoritative and are referenced rather than repeated.
**Goal:** match ZotFlow on the literature loop, then exceed it. Read → annotate → source note → cite, without leaving the app.

---

## 0. Why this plan replaces the old one

The old plan scoped the reader to *provenance verification only* (decisions D2, D3). That was the right call for shipping `/ai-review`, and it worked — but it produced a reader that renders a PDF at a fixed 135% zoom with no controls, no text selection, and no annotations. It verifies AI claims and does nothing else.

**Decision reversed, 2026-07-27.** The reader becomes a first-class research surface. D3's narrow amendment is replaced by the position in §1 below. D2 (write-back deferred) is not cancelled — it is *scheduled*, as R5.

**The ordering constraint from the outset:** we ship a usable reader first (R1–R2), then the annotator (R3–R5). But **every interface written in R1 is written for the annotator**, so R3 adds implementations rather than rewriting the render path. §3 is where that is made concrete, and it is the part of this plan that actually matters — the phases are just sequencing.

---

## 1. What the reader is for (revised position)

WeaveForge renders PDFs in-app as a full reading and annotation surface. A researcher can read a paper, highlight it, take notes on it, pull those highlights into a report section, and cite it — without opening Zotero.

**Zotero remains the system of record for the library.** We do not become a reference manager. But annotations are ours to create, and they sync back.

Non-goals, unchanged: becoming a PDF storage service by default (§4 of the old plan — the ladder stands), an OCR pipeline, or a Zotero replacement.

**Amend brief §11 and §6.1** accordingly. §11's "Full in-app PDF annotator (Zotero owns PDFs/annotations)" is now wrong on both halves and should be struck rather than narrowed.

---

## 2. What exists today (verified against the code, 2026-07-27)

Build on this; do not rediscover it.

| Asset | Location | State |
|---|---|---|
| pdf.js render pane | `features/reader/ui/pdf-reader.tsx` | Canvas only, `IntersectionObserver` virtualisation, worker from `public/` |
| Jump-to-locus | same | Quote-first, position fallback, low-confidence surfaced |
| Anchor resolution | `packages/core/src/reader/anchor-resolution.ts` | Whitespace-normalised, maps spans back to original offsets |
| **Dual anchor model** | `packages/core/src/reader/anchor-strategy.ts` | `CombinedPdfAnchor` = Zotero rects + W3C locus + `contentHash`. **Already write-back shaped** |
| Locus deep links | `packages/core/src/reader/locus-link.ts` | Encode/decode, bounded, validated |
| **Source ladder** | `packages/core/src/reader/pdf-source-ladder.ts` | `IPdfSourceResolver`, Open/Closed. **Implemented and never called** |
| Zotero annotation fields | `features/papers/domain/zotero.ts` | `annotationType`, `annotationPosition` (pageIndex + rects), `annotationSortIndex` all captured |
| Same-origin PDF proxy | `app/api/pdf-proxy/` | Auth, https allowlist, per-hop redirect revalidation, magic sniff, 80 MiB cap |
| Annotation pins | `0103` | Annotation → report section |
| Quotation types | `0107` | direct / paraphrase / summary |

**Missing:** text layer, zoom/rotate/page controls, byte cache, ladder wiring, annotation rendering, annotation creation, write-back.

The single most useful existing asset is `CombinedPdfAnchor`. It was designed for write-back interop before there was a reader to use it, and it is why R3 is cheaper than it looks.

---

## 3. The architecture that makes R3 cheap — decide now, build in R1

Four commitments. Getting these wrong means rewriting the reader when annotation lands; getting them right means R3 is additive.

### 3.1 One annotation model, not two

**Do not render "Zotero annotations" as a special case.** The reader consumes a single `ReaderAnnotation[]`, and Zotero's are projected into that shape at sync time.

```ts
// packages/core/src/reader/reader-annotation.ts
export type AnnotationOrigin = "zotero" | "local";

export interface ReaderAnnotation {
  id: string;
  origin: AnnotationOrigin;
  /** Zotero item key when origin === "zotero"; null for local-only. */
  zoteroKey: string | null;
  type: "highlight" | "underline" | "strikeout" | "note" | "image" | "ink";
  color: string;
  /** Selected text (empty for ink/image). */
  text: string;
  comment: string;
  tags: string[];
  /** Rects for fidelity, locus for durability. Both, always. */
  anchor: CombinedPdfAnchor;
  /** Zotero's ordering key, or a synthesised equivalent for local ones. */
  sortIndex: string;
  createdAt: string;
  updatedAt: string;
}
```

Consequence: R2 renders read-only Zotero annotations through exactly the component R3 uses for editable local ones. The render path is written once. `origin` drives only a badge and whether editing is offered.

### 3.2 Reads and writes are ports from day one

```ts
export interface IReaderAnnotationSource {
  list(paperId: string): Promise<ReaderAnnotation[]>;
}

/** Implemented as local-only in R3; Zotero-backed in R5. */
export interface IReaderAnnotationSink {
  create(paperId: string, draft: NewReaderAnnotation): Promise<ReaderAnnotation>;
  update(id: string, patch: ReaderAnnotationPatch): Promise<ReaderAnnotation>;
  remove(id: string): Promise<void>;
}
```

R1 wires a source with no sink. The UI asks the container whether a sink exists and shows creation affordances only when it does — so R3 is a composition-root change plus a repository, not a UI rewrite. This is the same decorator/port discipline as `IBlobStore` and `billing-and-quota-plan.md`.

### 3.3 Three layers per page, one coordinate system

Each page is a stack, all positioned by the same `viewport.transform`:

1. **canvas** — pdf.js render (exists)
2. **text layer** — absolutely positioned spans from `getTextContent()`, transparent, selectable
3. **annotation layer** — overlay divs for existing annotations, plus the in-progress selection

The text layer is not a nice-to-have for reading; **it is the input device for annotation.** A user highlights by selecting text, and a DOM selection is only convertible into rects and a quote if a text layer exists. R1 builds it because R3 depends on it, not merely because copy/paste is expected.

Selection → anchor is one pure function, testable without a browser:

```ts
selectionToAnchor(range: Range, page: PageTextGeometry): CombinedPdfAnchor
```

### 3.4 Zoom, rotation, and page state live in a controller

`scale` is currently a prop defaulting to `1.35`, and `reader-screen.tsx` never passes one — which is the reported bug: every PDF renders at 135% and overflows the pane.

Replace with a `useReaderViewport()` controller owning `{ scale, fit, rotation, page }`, defaulting to **fit-width**. Annotation overlays must survive zoom and rotation, so this cannot stay a constant. Anchors are stored in **PDF user space**, never screen pixels — screen coordinates are derived at render time, which is what makes zoom-independence fall out for free.

---

## 4. Data model

One new table. Local annotations are ours; Zotero-origin annotations stay cached on the paper as today and are projected at read time, so a Zotero sync that replaces `papers.metadata.annotations` cannot destroy user work.

```sql
-- 0110_reader_annotations.sql  (authored, human applies — D4)
create table reader_annotations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade default auth.uid(),
  project_id     uuid not null references projects(id) on delete cascade,
  paper_id       uuid not null references papers(id) on delete cascade,
  origin         text not null default 'local' check (origin in ('local','zotero')),
  zotero_key     text,
  type           text not null check (type in ('highlight','underline','strikeout','note','image','ink')),
  color          text not null default '#ffd400',
  text           text not null default '',
  comment        text not null default '',
  tags           text[] not null default '{}',
  -- CombinedPdfAnchor: { contentHash, zoteroPosition:{pageIndex,rects}, locus }
  anchor         jsonb not null,
  page_index     integer not null,          -- denormalised for cheap per-page queries
  sort_index     text not null default '',
  -- Write-back bookkeeping (R5). Null until Zotero sync touches the row.
  zotero_version integer,
  sync_state     text not null default 'local'
                   check (sync_state in ('local','synced','pending','conflict')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (project_id, paper_id, zotero_key)
);

create index reader_annotations_page_idx
  on reader_annotations (project_id, paper_id, page_index);
```

Owner-only RLS, and an `updated_at` trigger — the defect found in `0107` and fixed in `0109`. Do not repeat it.

`zotero_version` and `sync_state` are included **in R3, unused**, because adding sync bookkeeping to a populated table later is a migration against live user data. Columns are cheap; migrations over real annotations are not.

---

## 5. Phases

Each phase ships something a researcher can use. `npm run check:all` must exit 0 before any phase is called done.

### R0 — Fix what is broken (half a day)

The reader is currently worse than no reader, and this is the cheapest possible fix.

- Replace fixed `scale` with the §3.4 viewport controller; **default fit-width**
- Zoom in/out, fit-width, fit-page, rotate, page number + jump
- Wire `resolvePdfSource` — the ladder in core that is implemented and never called
- Keyboard: arrows, PageUp/Down, Home/End, `+`/`-`

**Exit:** a PDF opens fitting the pane, and the whole page is visible without horizontal scrolling.

### R1 — Text layer and reading (the foundation for everything after)

- Text layer per page, aligned over the canvas, selectable and copyable
- `selectionToAnchor()` (§3.3) — pure, unit-tested
- In-document full-text search with match highlighting and next/prev
- Outline/bookmarks pane from the PDF's own TOC
- IndexedDB byte cache with a visible LRU cap (ladder step 1)
- Continuous scroll and two-page spread

**Exit:** text can be selected and copied; search finds and scrolls to a term; a selection produces a valid `CombinedPdfAnchor` in tests.

### R2 — Render Zotero annotations read-only

Uses `ReaderAnnotation` (§3.1) and the `annotationPosition` rects captured in Phase 0 of the old plan.

- Project cached Zotero annotations into `ReaderAnnotation[]`
- Overlay highlights/underlines/notes at their rects, `contentHash`-gated per `anchor-strategy.ts`; fall back to quote resolution when the hash does not match, and mark the annotation "position approximate"
- Annotation sidebar: filter by colour, tag, page, type
- Click annotation → scroll to it; click in page → focus it in the sidebar
- Show the `0107` quotation type on each card
- "Copy quote + cite" using the existing multi-format citation code

**Exit:** every Zotero annotation on a paper is visible in the reader at the right place, or explicitly flagged as approximate. **This is where the feature stops being, in your words, a BS feature.**

### R3 — Create annotations (local-only)

First write phase. `IReaderAnnotationSink` gets its local implementation; no Zotero traffic.

- Highlight, underline, strikeout from a text selection, with a colour picker
- Sticky note on a selection or a point
- Image-region capture (store the rect; rasterise only on explicit pin)
- Ink/freehand for stylus and touch
- Edit and delete own annotations; comment and tag them
- Drag a highlight into a report section → `annotation_pins` row with a live anchor
- Annotate a PDF with **no Zotero item at all** (§5.4 of the old plan) — ZotFlow needs a sidecar file for this; we have a database, so it is nearly free

**Exit:** a researcher highlights a passage, comments on it, pins it into a report section, and it survives a reload and a re-render.

### R4 — The loop closes

- Split view: reader beside the vault note or report section
- Backlinks from an annotation to every note and section citing it
- Batch: extract all annotation images, generate all source notes, re-render all templates
- Activity Center — sync progress and task log
- Annotations visible on a shared paper at `view` access
- Dark-mode PDF rendering honouring the Catppuccin themes

**Exit:** a researcher drafts a report section beside the PDF, citing their own highlights, without switching context.

### R5 — Zotero write-back (the deferred D2 spike, now scheduled)

**Needs live credentials and a human watching.** Do not attempt unsupervised.

- Spike first: create one annotation via the Zotero Web API against a scratch library, confirm it survives a round-trip
- Push local annotations as Zotero items; store `zotero_key` + `zotero_version`
- Pull remote changes; detect divergence via `zotero_version`
- **Field-level conflict diff** — keep local / accept remote / merge, with batch resolve
- Per-library modes: Bidirectional / Read-Only / Ignored
- `sync_state` drives a per-annotation badge

**Exit:** an annotation created in WeaveForge appears in Zotero desktop, and an edit made in Zotero desktop appears here with conflicts surfaced rather than silently resolved.

### R6 — Reach and formats

- EPUB via `epub.js` (BSD-3, AGPL-compatible) — same anchor model, CFI instead of a quote selector
- HTML snapshot reading
- WebDAV source (ladder step 3) with server-sealed credentials
- Linked attachment base directory
- Opt-in `paper-pdfs` bucket (ladder step 6) with quota and tier eviction
- Mobile — gated on the memory measurement in §10 of the old plan
- Offline reading for cached documents

---

## 6. Where this beats ZotFlow

Parity is the floor, not the goal. Three things fall out of our architecture that a vault plugin cannot easily match:

1. **AI provenance inside the reader.** `/ai-review` evidence already deep-links to a locus. No competitor connects "the AI claimed X" to the highlighted sentence in the source.
2. **Annotations that outlive the file.** The dual anchor re-resolves by quote when the PDF is replaced by a new version. Rect-only annotations break; ours degrade to "position approximate" and keep the text.
3. **Annotation → experiment → report as one graph.** Pins, quotation types, extraction tables, and the report outline are already ours. ZotFlow ends at the source note.

Full parity with *ZotFlow + Obsidian* remains explicitly not the target — see §8.1 of the old plan. We compete on the literature loop only.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Text layer alignment drifts at zoom/rotation | Derive everything from `viewport.transform`; never cache screen coordinates. Test at 50/100/200% and each rotation |
| Bundle budget (~1MB gz reader chunk) | Reader is already a dynamic import off first paint. Re-measure at R1 and R3; `next build` output is in `check:all` |
| Write-back corrupts a real Zotero library | R5 spikes against a scratch library first. Never bulk-push without a dry run |
| Ink/image annotations bloat storage | Store vectors and rects, not rasters. Rasterise only on explicit pin, through the existing tiered blob store |
| Zotero sync wipes local annotations | Local annotations live in `reader_annotations`, never in `papers.metadata` — which sync replaces wholesale |
| R3 needs a render-path rewrite | The whole point of §3. If R2's component cannot render a local annotation unchanged, the §3.1 commitment was broken |

---

## 8. Sequencing

```
R0 fix zoom/controls        [half a day]  <- do this first, it is the reported bug
   |
R1 text layer + search      [foundation for all annotation]
   |
R2 render Zotero annots     <- "option 2" complete here
   |
R3 create local annots      <- "option 3" begins; sink port gets an impl
   |
R4 loop closes (split view, pins, batch)
   |
R5 Zotero write-back        <- needs a human + live credentials
   |
R6 EPUB/HTML/WebDAV/mobile
```

R0–R2 need no migration. R3 needs `0110`. R5 needs live credentials and supervision.

---

## 9. Related

- [`../completed/pdf-viewer-plan.md`](../completed/pdf-viewer-plan.md) — licensing (§1), source ladder (§4), anchor design (§5), ZotFlow parity checklist (§8.1)
- [`roadmap-2026-07-phased.md`](roadmap-2026-07-phased.md) — decisions D1–D4; D2 is scheduled as R5 and D3 is superseded by §1 here
- [`../../competitive-research-verified-2026-07.md`](../../competitive-research-verified-2026-07.md) §2.1 — the verified ZotFlow teardown
