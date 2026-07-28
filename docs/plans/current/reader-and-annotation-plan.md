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

### 2.1 We are not using rects anywhere — verified 2026-07-27

This needs stating plainly because the table above makes it look better than it is. **Three pieces of good core code are written, exported, unit-tested, and called by nothing:**

| Dead-but-correct | Called by app code? |
|---|---|
| `chooseAnchorStrategy` / `CombinedPdfAnchor` | **No.** Only docs reference it |
| `resolvePdfSource` (the ladder) | **No** |
| The `position` half of `PdfLocus` | **No** — `pageScopedLocus()` in `pdf-reader.tsx` strips it before every resolve |

What the reader actually does is call `resolveTextAnchor(pageText.text, pageScopedLocus(locus))` — **quote matching only**. The highlight boxes it draws are recomputed at render time from pdf.js text-item geometry (`Util.transform(viewport.transform, item.transform)`), not from any stored rect.

So today: no stored rects are read, no stored rects are written, and `zoteroPosition` is never populated — even though `annotationPosition` **is** captured from Zotero and sits in `papers.metadata.annotations` (and is now seeded). The data is there; nothing consumes it.

**Consequence for sequencing:** R2 is not "render the rects we already use." It is the first time rects are used at all. Budget accordingly, and treat `chooseAnchorStrategy` as untested-in-anger rather than proven.

The design is still right — it is why R3 is cheap. But "we have a dual anchor" currently describes a type, not a behaviour.

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
  /** Zotero's complete set — see §3.6. There is no `strikeout`. */
  type: "highlight" | "underline" | "note" | "image" | "ink" | "text";
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

### 3.5 The Zotero position format — verified against source, 2026-07-27

Read from `zotero/reader` directly, because **annotation fields are not in Zotero's public schema** — `itemTypes.annotation.fields` is literally `[]` in `api.zotero.org/schema`. They are special-cased in Zotero's code, so the API docs do not describe them and secondary summaries get them wrong.

```ts
// zotero/reader src/common/types.ts
export type PDFPosition = {
  pageIndex: number;           // zero-based
  rects?: number[][];          // [x1, y1, x2, y2], one per line box
  paths?: number[][];          // ink strokes — a different geometry, not rects
  nextPageRects?: number[][];  // the tail of a highlight crossing a page break
};
```

Three things follow, and all three must be handled:

1. **Rects are PDF user space, origin bottom-left** — not screen pixels, not top-left. Confirmed by the reader's own arithmetic: it takes page height from the `viewBox` and flips with `top = pageHeight - rect[3]`. This is what makes zoom and rotation free: store document coordinates, derive screen coordinates through `viewport.transform` at render time. §3.4 depends on this.

2. **`nextPageRects` — a single annotation can span two pages.** Its `pageIndex` is the *first* page; `rects` are on that page and `nextPageRects` on the next. A renderer that only reads `rects` silently truncates the highlight at the page break, and a writer that only emits `rects` corrupts a cross-page selection on write-back. Our `ZoteroAnnotationPosition` in `features/papers/domain/zotero.ts` does **not** carry this field yet — add it in R2, before anything renders.

3. **Ink is `paths`, not `rects`.** Different geometry, different overlay primitive (SVG polyline, not a box). R3's ink support cannot reuse the highlight renderer.

**`annotationSortIndex`** is a sortable string, not a number — built in `zotero/reader src/pdf/selection.js:399`:

```js
[ pageIndex.padStart(5,'0'), charOffset.padStart(6,'0'), Math.floor(top).padStart(5,'0') ].join('|')
```

So `"00008|000412|00574"` is page 8, character offset 412 into the page text, 574pt from the top. Zero-padding makes lexical sort equal reading order. Local annotations created in R3 must synthesise this in the same shape, or local and Zotero annotations will not interleave correctly in the sidebar — and R5 would push a malformed sort index back to Zotero.

**Zotero itself already uses W3C selectors — just not for PDF.** From the same file: *"PDFPosition for PDFs, a WADM Selector for EPUBs and snapshots."* WADM is the W3C Web Annotation Data Model. This is direct validation of §3.1's dual anchor: we apply to PDF the durability mechanism Zotero already trusts for EPUB. Where Zotero has only rects, a repaginated or replaced file silently renders the highlight over the wrong text; `contentHash` + quote fallback is what turns that into an honest "position approximate".

### 3.6 The annotation type set — verified, and smaller than it looks

Zotero defines exactly six, from `chrome/content/zotero/xpcom/annotations.js`:

| Type | ID | Geometry | Notes |
|---|---|---|---|
| `highlight` | 1 | `rects` | |
| `note` | 2 | `rects` (small anchor box) | Sticky note |
| `image` | 3 | `rects` (region) | Rasterise only on explicit pin |
| `ink` | 4 | **`paths`** | Not a rect renderer |
| `underline` | 5 | `rects` | |
| `text` | 6 | `rects` | Free-standing typed text box, not tied to a selection |

**There is no `strikeout`.** An earlier draft of this plan listed one and omitted `text` — both wrong. Inventing a type Zotero does not have produces annotations that cannot be written back in R5, and omitting a real one means we silently drop it on the way in. That second failure was live: `ANNOTATION_TYPES` in `zotero-annotations.ts` had five entries, and `parseAnnotationType` degrades unknown values to `undefined`, so a Zotero `text` annotation lost its type on every sync. Fixed 2026-07-27 with a test that asserts all six survive and that `strikeout` is still rejected.

**Rule for R3:** local annotation types are a subset of this set, never a superset. If a type cannot round-trip through Zotero, it does not exist here either.

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
  -- Zotero's complete type set (§3.6). No 'strikeout' — Zotero has none, and a
  -- type it does not know cannot be written back in R5.
  type           text not null check (type in ('highlight','underline','note','image','ink','text')),
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

### R0 — Fix what is broken ✅ DONE (2026-07-29)

The reader is currently worse than no reader, and this is the cheapest possible fix.

- Replace fixed `scale` with the §3.4 viewport controller; **default fit-width**
- Zoom in/out, fit-width, fit-page, rotate, page number + jump
- Wire `resolvePdfSource` — the ladder in core that is implemented and never called
- Keyboard: arrows, PageUp/Down, Home/End, `+`/`-`

**Exit:** a PDF opens fitting the pane, and the whole page is visible without horizontal scrolling.

**Delivered:** `reader-viewport.ts` + `reader-keyboard.ts` (pure, tested); `OpenAccessPdfResolver` on the ladder; toolbar + `useReaderViewport` in the pdf.js surface.

### R1 — Text layer and reading ✅ DONE (2026-07-29)

- Text layer per page, aligned over the canvas, selectable and copyable
- `selectionToAnchor()` (§3.3) — pure, unit-tested
- In-document full-text search with match highlighting and next/prev
- Outline/bookmarks pane from the PDF's own TOC
- IndexedDB byte cache with a visible LRU cap (ladder step 1)
- Continuous scroll and two-page spread

**Exit:** text can be selected and copied; search finds and scrolls to a term; a selection produces a valid `CombinedPdfAnchor` in tests.

**Delivered:** `selectionToAnchor`, `document-search`, `sort-index`, `reader-annotation` ports, `InMemoryPdfByteCache` + IndexedDB impl, text layer spans in `pdf-reader`, search bar, outline pane, two-page toggle.

### R2 — Render Zotero annotations read-only ✅ DONE (2026-07-29)

Uses `ReaderAnnotation` (§3.1) and the `annotationPosition` rects captured in Phase 0 of the old plan.

- Project cached Zotero annotations into `ReaderAnnotation[]`
- Overlay highlights/underlines/notes at their rects, `contentHash`-gated per `anchor-strategy.ts`; fall back to quote resolution when the hash does not match, and mark the annotation "position approximate"
- Annotation sidebar: filter by colour, tag, page, type
- Click annotation → scroll to it; click in page → focus it in the sidebar
- Show the `0107` quotation type on each card
- "Copy quote + cite" using the existing multi-format citation code
- **Separate Zotero child notes from annotations** on the paper detail (§5.0): two groups, each rendered only when it has content, headings and counts derived per group rather than the current hardcoded "annotations & notes (N)". Notes drop the quotation-type selector and the pin control — a note has no page and is not a quotation from anywhere. Label "Notes from Zotero · read-only"

**Exit:** every Zotero annotation on a paper is visible in the reader at the right place, or explicitly flagged as approximate; and a paper shows an annotations group, a notes group, or neither — never a heading for something it does not have. **This is where the feature stops being, in your words, a BS feature.**

### R3 — Create annotations (local-only) ✅ DONE (2026-07-29)

First write phase. `IReaderAnnotationSink` gets its local implementation; no Zotero traffic.

- Highlight and underline from a text selection, with a colour picker
- Free-standing **text** annotation (Zotero's `text` type — a typed box placed on the page, not tied to a selection)
- Sticky note on a selection or a point
- Image-region capture (store the rect; rasterise only on explicit pin)
- Ink/freehand for stylus and touch
- Edit and delete own annotations; comment and tag them
- Drag a highlight into a report section → `annotation_pins` row with a live anchor
- Annotate a PDF with **no Zotero item at all** (§5.4 of the old plan) — ZotFlow needs a sidecar file for this; we have a database, so it is nearly free

**Exit:** a researcher highlights a passage, comments on it, pins it into a report section, and it survives a reload and a re-render.

**Delivered:** migration `0110_reader_annotations.sql` (authored, D4); in-memory / Supabase / Postgres sinks; facade CRUD; merge of Zotero-projected + local annotations; selection → create bar; ink / image / text tools; sidebar edit/delete/comment/tag/pin for local rows.

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

## 5.0 Annotation parity audit — does this plan cover everything ZotFlow does with annotations?

Checked item by item against ZotFlow's README, 2026-07-27. **Yes, with one deliberate difference and one open decision.**

| ZotFlow annotation capability | Covered | Where |
|---|---|---|
| Highlight | ✅ | R3 |
| Underline | ✅ | R3 |
| Sticky note | ✅ | R3 |
| Ink / freehand | ✅ | R3 (via `paths`, §3.5) |
| Image-region capture | ✅ | R3 |
| Free-standing text annotation | ✅ | R3 — **added after the §3.6 audit; was missing** |
| "Every annotation type Zotero supports" | ✅ | All six, §3.6 |
| Render existing Zotero annotations | ✅ | R2 |
| Cross-page highlights | ✅ | R2 via `nextPageRects` — **added after the §3.5 audit; was missing** |
| Edit / delete / comment / tag | ✅ | R3 |
| Annotation sidebar with filters | ✅ | R2 |
| Bidirectional sync to Zotero | ✅ | R5 |
| Field-level conflict diff | ✅ | R5 |
| Per-library Bidirectional / Read-Only / Ignored | ✅ | R5 |
| Annotate files with no Zotero item | ✅ | R3 — **differs by design:** a row in `reader_annotations`, not a co-located `.zf.json` sidecar. Ours syncs across devices and is queryable; theirs is portable with the file. We are a web app with a database, so the sidecar is the wrong shape for us |
| Bulk annotation-image extraction | ✅ | R4 |
| Copy quote + cite from the reader | ✅ | R2 |
| Annotation ordering matching Zotero | ✅ | R3 must synthesise `sortIndex` in Zotero's format (§3.5) |
| Themed / dark reader | ✅ | R4 |
| **Native Zotero child notes** | ⚠️ Partly | Already imported; presentation is wrong. **Decided — see below** |

**Two gaps this audit caught** are now closed in the plan and in the code: `nextPageRects` (cross-page highlights would have been silently truncated) and the `text` type (was being stripped on sync). Both existed because the plan was written from a feature list rather than from Zotero's source.

### The child-notes decision

This is the one genuine hole, and it is worth being precise about what it is, because it is easy to confuse with annotations.

Zotero has **two different things** attached to an item:

- **Annotations** — children of the *attachment* (the PDF). Anchored to a position in the file. This is everything above.
- **Child notes** — children of the *bibliographic item*. A free Markdown/HTML note about the paper, with no position in any file. Zotero shows them in the item pane; they sync as their own item type.

ZotFlow lets you create, edit, and delete Zotero child notes in place, and pushes them back.

**We already have this concept twice over** — a paper's own note (`summary` / the note editor on the paper detail) and vault notes that can wikilink to a paper. So the question is not "can we store a note about a paper" but "should our paper note *be* a Zotero child note, and sync?"

| Option | Consequence |
|---|---|
| **A. Do nothing** | A researcher's Zotero notes stay invisible here. Our notes stay invisible in Zotero. Two parallel note stores, no data loss, some confusion |
| **B. Read-only import** | Show Zotero child notes on the paper, clearly labelled, not editable. Cheap, removes the "where did my note go" surprise, no write risk |
| **C. Full bidirectional** | Our paper note *is* the Zotero child note. Highest parity, but two rich-text models and two edit surfaces racing — the note is now a merge target, and our notes support wikilinks and templates Zotero has no representation for |

### DECIDED 2026-07-27 — **B, read-only import.**

C is rejected outright, not deferred. Our notes carry wikilinks and template regions that Zotero has no representation for, so a round-trip is **lossy on content people have written over years**. Annotations round-trip cleanly because they are anchored geometry plus text; notes do not. The parity gain is not worth being the tool that quietly ate someone's thesis notes.

**Most of B already exists and was missed in the first audit.** `zotero-annotations.ts` already pulls child notes (`itemType=note`) and stores them in the same `metadata.annotations` array with `kind: "note"`, and `PaperAnnotations` already renders them with a "Zotero note" label. What is wrong is the presentation.

**Work remaining — R2, small and self-contained:**

1. **Split the list in two.** Annotations and notes are different things and currently share one flat list under one header. Render an **Annotations** group and a **Notes from Zotero** group.

2. **Every group renders only if it has content.** The block as a whole already does this correctly — `PaperAnnotations` returns `null` when the array is empty — but the header hardcodes *"Zotero annotations & notes (N)"*, so a paper with only notes advertises annotations it does not have, and vice versa. Each group's heading and count come from that group.

3. **Stop offering annotation-only controls on a note.** A child note has no page, no rects, and is not a quotation from anywhere — yet it currently gets the quotation-type selector (direct / paraphrase / summary) and the pin-to-section control. Both are meaningless on a note and imply a precision that does not exist. Notes keep copy and tags; they lose the quotation type and the pin.

4. **Label the origin honestly.** "Notes from Zotero · read-only" — a user must never wonder why they cannot edit it, or whether editing here would reach Zotero.

**Not in scope:** creating, editing, or deleting Zotero notes from WeaveForge. That is option C and is rejected above.

---

## 5.1 ZotFlow capabilities we have in *no* form — verified 2026-07-27

Checked by grepping the codebase for each, not from memory. "No form" means no type, no port, no dead code — nothing to build on.

| Capability | Us | Covered by |
|---|---|---|
| EPUB reading | **Nothing** | R6 |
| HTML/snapshot reading | **Nothing** | R6 |
| WebDAV attachments | **Nothing** — the only hit is the word "WebDAV" in a doc comment in `pdf-source-ladder.ts` | R6 |
| Linked attachment base directory | **Nothing** | R6 |
| Ink / freehand | **Nothing** — and needs `paths`, not the rect renderer (§3.5) | R3 |
| Image-region capture | **Nothing** | R3 |
| Bulk annotation-image extraction | **Nothing** | R4 |
| Native Zotero child notes | **Nothing** | **Unplanned** |
| Per-library Bidirectional / Read-Only / Ignored | **Nothing** | R5 |
| Field-level conflict diff | **Nothing** | R5 |
| Batch ops (regenerate all notes / re-render all templates) | **Nothing** | R4 |
| Activity Center (sync progress, task log) | **Nothing** | R4 |
| CSL styles via citeproc | **Nothing** — we emit wikilink / LaTeX / Pandoc / footnote / raw, no CSL | **Unplanned** |
| Drag-to-cite from a library tree | **Nothing** — `@` autocomplete exists, drag does not | **Unplanned** |
| Virtualised Zotero library tree view | Partial — `list-zotero-collections.use-case.ts` and `ZoteroCollection` exist; no tree UI | **Unplanned** |
| Sidecar annotation for non-library files | N/A — we use a table, not a `.zf.json` file | R3 |
| Themed reader (dark mode) | **Nothing** | R4 |

**Three are genuinely unplanned and need a decision, not just scheduling:**

- **Native Zotero child notes** — creating and editing Zotero notes in-app. Overlaps our own vault notes; doing both may confuse where a note "lives". Decide before R5.
- **CSL / citeproc** — real work (a CSL engine plus style files) for output formats a thesis writer using LaTeX or Pandoc mostly does not need. Cheap to skip, expensive to half-do.
- **Drag-to-cite from a tree view** — needs the tree view first. Pleasant, not load-bearing.

Everything else is sequenced above.

---

## 6. Where this beats ZotFlow

Parity is the floor, not the goal. Three things fall out of our architecture that a vault plugin cannot easily match:

1. **AI provenance inside the reader.** `/ai-review` evidence already deep-links to a locus. No competitor connects "the AI claimed X" to the highlighted sentence in the source.
2. **Annotations that outlive the file.** The dual anchor re-resolves by quote when the PDF is replaced by a new version. Rect-only annotations break; ours degrade to "position approximate" and keep the text.
3. **Annotation → experiment → report as one graph.** Pins, quotation types, extraction tables, and the report outline are already ours. ZotFlow ends at the source note.

Full parity with *ZotFlow + Obsidian* remains explicitly not the target — see §8.1 of the old plan. We compete on the literature loop only.

---

## 6.1 Defects this plan's own audit found — and the rule that follows

Three defects, found by checking the plan against Zotero's source rather than against a feature list. **All three are fixed** (commits `afd566b`, `991b10c`); they are recorded because the *pattern* matters more than the bugs.

| # | Defect | Effect | Fixed by |
|---|---|---|---|
| 1 | `nextPageRects` dropped by the position parser | Any highlight crossing a page break was silently truncated at the boundary. On write-back it would have *corrupted* the annotation, not just displayed it short | Parse and retain it; test covers a cross-page highlight |
| 2 | `text` type missing from `ANNOTATION_TYPES` | `parseAnnotationType` degrades unknowns to `undefined`, so a Zotero `text` annotation lost its type on **every** sync — kept its content, became unrenderable and unwritable | All six types allow-listed; test asserts each survives |
| 3 | `strikeout` invented in this plan | Not a Zotero type. Would have produced local annotations that could never be written back in R5 — discovered only after users had created them | Removed from the plan, the `ReaderAnnotation` union, and the `0110` CHECK; test asserts it stays rejected |

**All three share one cause: the plan was written from ZotFlow's feature list instead of Zotero's source.** A feature list tells you what exists, never what shape it is. `strikeout` *feels* like it should be there; `text` does not feel like it is; `nextPageRects` is invisible until a highlight happens to cross a page.

### Rule for R3 and R5

**Every Zotero-facing shape is verified against Zotero's own source before it is implemented, and the source location is cited in the code.** Not the API docs — annotation fields are absent from the public schema (`itemTypes.annotation.fields` is `[]`), so the docs cannot answer these questions, and secondary summaries get them wrong.

Canonical sources, all read 2026-07-27:

| Question | Source |
|---|---|
| Which annotation types exist | `zotero/zotero` `chrome/content/zotero/xpcom/annotations.js` — `ANNOTATION_TYPE_*` |
| Position/geometry shape | `zotero/reader` `src/common/types.ts` — `PDFPosition` |
| How `sortIndex` is built | `zotero/reader` `src/pdf/selection.js` — `getSortIndex` |

**This matters far more in R5 than it did here.** These three were caught against a demo database. The same class of error in write-back mutates a real Zotero library — someone's actual research — and Zotero's sync will happily propagate a malformed annotation to every device before anyone notices. R5's spike against a scratch library is not a formality; it is the control for exactly this failure mode.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Text layer alignment drifts at zoom/rotation | Derive everything from `viewport.transform`; never cache screen coordinates. Test at 50/100/200% and each rotation |
| Bundle budget (~1MB gz reader chunk) | Reader is already a dynamic import off first paint. Re-measure at R1 and R3; `next build` output is in `check:all` |
| Write-back corrupts a real Zotero library | R5 spikes against a scratch library first. Never bulk-push without a dry run. §6.1 — every Zotero-facing shape verified against Zotero's source, not its docs |
| A shape we guessed wrong propagates through sync | Already happened three times in this plan (§6.1), caught against a demo. In R5 the blast radius is a real library on every synced device |
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
- [`../completed/roadmap-2026-07-phased.md`](../completed/roadmap-2026-07-phased.md) — decisions D1–D4; D2 is scheduled as R5 and D3 is superseded by §1 here
- [`../../competitive-research-verified-2026-07.md`](../../competitive-research-verified-2026-07.md) §2.1 — the verified ZotFlow teardown
