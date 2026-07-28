# In-app PDF reader — implementation plan

**Date:** 2026-07-25 · **Status reassessed:** 2026-07-27
**Status: PARTIALLY DELIVERED — not complete.** Phase D shipped the parts `/ai-review` needed and stopped there, which was the right call. This plan describes considerably more than exists.

### What actually exists today (verified against the code, 2026-07-27)

| Phase 1 item | State |
|---|---|
| pdf.js render pane, worker-backed, lazily imported | ✅ `features/reader/ui/pdf-reader.tsx` |
| Virtualised pages | ✅ `IntersectionObserver`, 600px root margin |
| **Jump-to-locus** from a stored anchor | ✅ quote-first, position fallback, low-confidence surfaced |
| Source resolution | ⚠️ **step 4 only** (arXiv / open-access URL). `resolvePaperPdfUrl` is what the reader calls |
| Steps 1 (cache) and 2 (Zotero storage) | ❌ `packages/core/src/reader/pdf-source-ladder.ts` implements the ladder and is **never called by the app** |
| IndexedDB byte cache with LRU cap | ❌ absent |
| Page navigation, zoom, fit-width/fit-page, rotate | ❌ absent — `scale` is a fixed prop with no controls |
| Text selection + copy | ❌ **no text layer is rendered.** `getTextContent()` is used for anchor matching only; the page is a bare canvas, so text cannot be selected or copied |
| Zotero annotation overlays at their anchors | ❌ absent |

Phases 2–4 are entirely undelivered. **Phase 2 (annotation) is deferred by decision, not by oversight** — see roadmap D2 and D3: Phase D's scope is a read-only provenance surface, and annotation write-back needs a supervised spike against a live Zotero library.

Nothing above is broken; it is unbuilt. The reader does what the provenance UI needs and no more.

**Do not read this document as a record of shipped work.** The next person picking up the reader should start from [`../current/reader-and-annotation-plan.md`](../current/reader-and-annotation-plan.md) (R0–R6), which supersedes Phases 1–4 here. Use the verified table above only as a snapshot of what Phase D left in place.

**Original status:** Proposed. Requires a product-brief amendment (see §2) before build starts.
**Driver:** ZotFlow ships an embedded reader inside Obsidian and is rated our leading competitive threat — see `docs/competitive-research-verified-2026-07.md` §2.1. Separately, the `/ai-review` provenance UI (P0) needs a way to show the source of an AI claim without a context break.

---

## 1. Licensing — the constraint that shapes everything

Verified 2026-07-25:

**Updated 2026-07-25: WeaveForge relicensed to AGPL-3.0-only. This section previously ruled out vendoring Zotero Reader; that constraint is gone.**

| Component | License | Usable in WeaveForge? |
|-----------|---------|----------------------|
| WeaveForge (`/LICENSE`) | **AGPL-3.0-only** | — |
| `python/` SDK, `plugins/thesis-tracker-research/` | **AGPL-3.0-only** (no carve-outs) | — |
| Zotero reader (`zotero/reader`, `COPYING`) | **AGPL-3.0** incl. §13 network clause | **Yes** |
| ZotFlow (`duanxianpi/obsidian-zotflow`) | **AGPL-3.0-only** | Yes, but see below |
| pdf.js (`mozilla/pdf.js`) | Apache-2.0 | Yes |

AGPL-3.0 code may be combined with AGPL-3.0 code. §13 requires that network users be offered the corresponding source of any modified version — WeaveForge publishes all of its source, so the hosted service is compliant by default. The pricing model (`docs/pricing-strategy.md`) charges for operator cost and withholds no features, which is precisely the model AGPL was written for.

**This changes the plan's cost profile.** ZotFlow's README credits its embedded PDF/EPUB/HTML reader engine to the Zotero Reader project. That engine is now legally available to us on the same terms it was available to them — which turns "which engine" from a licensing question into an engineering one. It was settled as **pdf.js**; see §1.1 for the decision and §1.2 for what we copy from Zotero Reader regardless.

Practical rules that still apply:

- **The repository is AGPL-3.0-only throughout, with no permissive carve-outs.** Incoming code must be AGPL-compatible: permissive licences (Apache-2.0, MIT, BSD) are fine and are recorded in `/NOTICE`; anything incompatible with AGPL-3.0 is not. A CI licence check should enforce compatibility repo-wide.
- ZotFlow's source is legally usable, but **prefer independent implementation**. Their code is built around Obsidian's plugin API and vault model, neither of which we have; lifting it would import assumptions that do not hold here. Match behaviour, write our own integration.
- Record every vendored component in `/NOTICE` with its upstream project and licence.
- Keep interoperating with Zotero's annotation JSON shape (`features/papers/infrastructure/zotero-annotations.ts`) — that was always a data format, never a licensing question.

> Not legal advice. The AGPL combination is straightforward, but the multi-licence boundary between the app and the SDK is worth a lawyer's read before the first public release.

### 1.1 Reader engine — DECIDED 2026-07-25: **pdf.js**

See `docs/plans/completed/roadmap-2026-07-phased.md` §D1 for the full rationale. Summary of the evidence that settled it: `zotero/reader` is actively maintained (pushed 2026-07-24) but is **not published to npm**, and building it requires recursive git submodules plus `NODE_OPTIONS=--openssl-legacy-provider`. Consuming it means vendoring a submodule and building from source in CI, on a legacy webpack toolchain, inside a Next.js 14 PWA with a ~1MB gzipped reader-chunk budget. We are also buying far more than we need: per decision D3 the scope is a **read-only rendering surface**, not an annotator.

The anchor model in `packages/core/src/reader/` is renderer-agnostic, so this decision is cheap to revisit. **Revisit trigger:** `zotero/reader` publishes to npm, or drops the legacy OpenSSL requirement.

The criteria below are retained for that revisit.

### 1.2 Vendoring policy — copying from `zotero/reader`

**We copy selectively rather than submodule.** Both projects are AGPL-3.0, so this is permitted. It is not permission to be careless: copyleft carries obligations, and getting them wrong on a public repo is the kind of mistake that is quoted back at you.

**What to copy.** Only the parts that are genuinely hard and well-solved upstream:

- selection geometry — mapping a DOM selection to page coordinates
- text-layer alignment over the canvas
- zoom and rotation handling without anchors drifting
- annotation overlay positioning

**What not to copy.** Their app shell, build system, state management, Zotero-specific plumbing, or anything that assumes the Zotero client environment. We write our own React/Next integration.

**Rules — all mandatory:**

1. **Vendored code lives in one place**, clearly marked: `apps/web/src/features/reader/vendor/`. Never scattered through our own modules.
2. **Preserve upstream copyright headers verbatim.** Do not strip, reformat, or "tidy" them.
3. **Mark modifications.** AGPL-3.0 §5(a) requires modified files to carry prominent notices stating that you changed them and the date. Add a header noting what was changed and when.
4. **Record provenance per file.** Keep `apps/web/src/features/reader/vendor/PROVENANCE.md` listing, for each vendored file: upstream path, upstream commit SHA, date copied, and what was modified. Without the SHA there is no way to reconcile against upstream later.
5. **Add an entry to `/NOTICE`** naming Zotero Reader, its upstream URL, and its licence.
6. **Copy `zotero/reader`'s `COPYING`** into the vendor directory alongside the code.
7. **No cherry-picking of licence terms.** The whole repository is AGPL-3.0 already, so there is no incompatibility — but the `python/` and `plugins/` directories are also AGPL now, and nothing here changes that.

**Why the commit SHA matters.** Vendored code with no recorded origin becomes unmaintainable within months: nobody can tell what was changed locally versus what upstream has since fixed. The SHA is what makes a future diff possible.

### 1.3 Criteria if the engine decision is ever revisited

Not active work. Retained so a future revisit of D1 starts from evidence rather than from scratch. Triggers: `zotero/reader` publishes to npm, or drops the legacy OpenSSL requirement.

| Question | Why it matters |
|----------|----------------|
| Does the `web` build run standalone outside the Zotero client? | It is built for Zotero's environment; the `dev` variant serving `reader.html` suggests yes, but this is the make-or-break question |
| Bundle size, and can it be lazily imported? | §6 budgets under ~1MB gzipped for the reader chunk; the Zotero engine is likely larger |
| Can its annotation layer be driven from our data model? | We need both Zotero rects and W3C selectors (§5.1) |
| How is it themed? | Must accept the Catppuccin themes (`docs/themes.md`) |
| Update cadence and coupling to Zotero client releases | We would inherit their release cycle |
| EPUB and HTML support included? | Would collapse Phase 4's EPUB work into Phase 1 |

If a revisit ever adopts the engine wholesale, Phases 1–2 shrink substantially. Everything downstream is written against our own anchor model rather than a specific renderer, so the switch stays cheap.

---

## 2. Required brief amendment

Brief §11 currently reads: *"Full in-app PDF annotator (Zotero owns PDFs/annotations)."*

That non-goal assumed two options — delegate entirely to Zotero, or build an annotator. ZotFlow demonstrates a third the rationale never costed. This plan supersedes the non-goal, but narrows it rather than discarding it:

**New position — narrowed by decision D3 (2026-07-25).** WeaveForge renders PDFs in-app **read-only**, to verify AI provenance and support jump-to-locus. It does **not** create or edit annotations in-app. Zotero remains the system of record; existing annotations render read-only, and write-back is deferred to its own decision (D2).

What stays a non-goal: creating or editing annotations in-app, becoming a PDF storage service, an OCR pipeline, or a Zotero replacement.

This is a smaller amendment than earlier drafts of this section proposed, and it follows from D1 and D2 rather than driving them.

Amend §11 and §6.1 ("PDFs are not stored in-product") before build. §6.1's claim becomes "PDFs are not stored in-product *by default*."

---

## 3. Design tensions, stated plainly

Two of the stated goals pull against each other:

- **Self-sufficient** wants the PDF present and openable without another app.
- **Storage-efficient** says PDF blobs are exactly what blows up storage — a 200-paper library at 5MB average is 1GB per user.

**Resolution:** self-sufficiency is achieved by *resolution and caching*, not by *storing*. The app can always open the PDF; the bytes usually live somewhere we don't pay for. Server-side storage is an explicit, quota'd opt-in, not the default path.

Third goal, **fast**, is mostly a bundling and rendering-strategy problem and is largely independent — see §6.

---

## 4. PDF source resolution ladder

On "open PDF" for a paper, resolve in order and stop at the first hit:

| # | Source | Cost to us | Notes |
|---|--------|-----------|-------|
| 1 | **Browser cache** (IndexedDB, keyed by content hash) | Zero | Repeat opens are instant and offline-capable |
| 2 | **Zotero storage** via the existing Zotero Web API | Zero | Uses the user's own Zotero quota. `features/papers/infrastructure/zotero-web-api.ts` already authenticates |
| 3 | **User WebDAV** | Zero | The path ZotFlow offers; common for users who moved attachments off Zotero cloud |
| 4 | **Open-access URL** — S2 `openAccessPdf`, Unpaywall, arXiv | Zero | We already proxy S2 at `/api/s2/[...path]` and arXiv at `/api/arxiv` |
| 5 | **User-supplied URL** on the paper record | Zero | Manual escape hatch |
| 6 | **Server blob** (`IBlobStore` + `blob_objects`) | Paid | **Opt-in per project, quota'd.** Last resort only |

Steps 3–5 need a CORS-safe fetch path; where the origin blocks it, proxy through a Next route that streams without persisting (`/api/pdf/proxy`), reusing the credential-sealing pattern from `/api/settings/credentials` for WebDAV auth.

**Result:** the default install stores zero PDF bytes server-side while still opening every paper it can resolve.

### 4.1 When step 6 is enabled

Reuse what exists rather than building new storage:

- `packages/core/src/storage/blob-ports.ts` — `IBlobStore`
- `packages/core/src/storage/blob-registry-ports.ts` — `BlobTier`, `IBlobRegistry`
- `packages/core/src/storage/blob-tiering.ts` — `computeBlobEvictionScore`, `rankForEviction`, `DEFAULT_BLOB_TIERING_WEIGHTS`
- `apps/web/src/storage/providers/tiered/tiered-blob-store.ts`

Add a `paper-pdfs` private bucket alongside `paper-images` / `vault-assets` / `experiment-artifacts`. PDFs are the ideal eviction candidate — they are re-resolvable from steps 2–5, so cold-tier eviction is lossless. Feed `rankForEviction` a high weight for `paper-pdfs` and re-resolve on miss.

---

## 5. Annotation storage — anchors, not pixels

**Never store rendered regions.** An annotation record is:

```
{ paperId, page, selector: { type: "TextQuote", exact, prefix, suffix },
  fallback: { type: "TextPosition", start, end },
  rect?, color, comment?, tags[], zoteroKey?, updatedAt }
```

Roughly 200–400 bytes. A rasterized highlight region is 10–100KB. At 500 annotations that is the difference between ~150KB and ~25MB per user.

Design per the verified spec work in `docs/competitive-research-verified-2026-07.md` §4.1:

- `TextQuoteSelector` (`exact` / `prefix` / `suffix`) is the **primary** anchor
- `TextPositionSelector` is the **fallback** — the W3C spec itself calls it "very brittle with regards to changes to the resource"
- Bounding-box coordinates are stored only as a *rendering hint*, never as the anchor — they break on crop, reflow, or a different renderer
- **Multiple-match rule:** the spec says a quote selector *SHOULD* match all occurrences. That is wrong for jump-to-locus. Ours resolves to the match nearest the stored `TextPositionSelector` offset, falling back to first-on-page.
- **Re-anchor logic is ours to write** — the spec gives no guidance. Store a `anchorConfidence` and surface a "source may have changed" affordance rather than silently jumping to the wrong place.

**Image-region capture** (ZotFlow has it, we want it): store `{ page, rect }` and re-render on demand from the PDF. Persist a raster **only** when the user explicitly pins the region into a report section, and route it through the existing `paper-image-store.ts` + `paper-images` bucket.

### 5.1 Two anchors, not one

Zotero's own position model and the W3C model solve different problems. Store both.

| Anchor | Authoritative for | Why it is required |
|--------|-------------------|--------------------|
| Zotero `annotationPosition` — `{"pageIndex": 24, "rects": [[x1,y1,x2,y2], …]}` | Write-back and interop | An annotation we create without valid rects will not render in Zotero's own reader. The round-trip breaks without it. `pageIndex` is zero-based; rects are PDF user-space coordinates |
| W3C `TextQuoteSelector` (+ `TextPositionSelector` fallback) | Our locus links, provenance UI, re-anchoring | Rects bind to one specific file. Re-resolve the PDF from a different ladder step (§4) — an open-access copy with different pagination, say — and the rects point at nothing |

Resolution order when opening: try rects if the content hash matches the file the annotation was made against; otherwise resolve by quote selector and mark `anchorConfidence` low rather than jumping silently.

### 5.2 What already exists

`apps/web/src/features/papers/infrastructure/zotero-annotations.ts` (158 lines) already paginates `itemType=annotation`, resolves attachment → parent paper in two passes, and handles 429 with `Retry-After` and `Backoff`. The ingest pipeline is done.

**It discards the fields the viewer needs.** `ZoteroItem.data` currently maps `annotationText`, `annotationComment`, `annotationColor`, `annotationPageLabel`, and `tags`. Add to both that interface and the `ZoteroAnnotation` domain type:

- `annotationPosition` — the page and rects (parse the JSON string)
- `annotationType` — highlight / underline / note / image / ink
- `annotationSortIndex` — pipe-delimited ordering key, e.g. `00008|000412|00574`

This is the smallest useful first change: once these are captured, every annotation already synced becomes renderable the moment Phase 1 lands. No new API surface, no re-sync design.

### 5.3 Write-back is possible — confirmed by existence proof

ZotFlow's documentation states plainly that annotations created in its library reader **sync back to Zotero**, that sync is bidirectional per library, and that native Zotero child notes can be created and edited from inside the plugin. Whatever the Zotero API docs do or do not spell out about annotation items, a shipping third-party client is doing it.

The v3 write path is the generic item path: fetch an item template, POST an array to create, PUT (full) or PATCH (partial) to update, always carrying the current version in the `version` property or an `If-Unmodified-Since-Version` header, with a write-scoped API key. Annotations are items (`itemType=annotation`), so this applies to them.

**Still run the spike — as confirmation, not discovery.** POST one highlight with a valid `annotationPosition` and a real `parentItem` attachment key; confirm it renders in the Zotero desktop client. Test a **group** library too: group permissions are the likeliest place this diverges, and an open Zotero forum request asking to "expose API for programmatic PDF annotation creation" suggests the path is under-documented even where it works.

**Fallback if group libraries or some other case blocks writes:** those annotations stay ours and render alongside Zotero's, distinguished by origin, with the quote selector keeping them portable. Scope the fallback to the cases that fail rather than abandoning write-back wholesale.

**Conflict handling:** follow ZotFlow's *behaviour* — field-level diff with keep-local / accept-remote / batch resolve — implemented from scratch. Never auto-resolve.

### 5.4 Annotating PDFs that are not in Zotero

ZotFlow supports annotating vault PDFs and EPUBs with **no Zotero connection at all**, storing annotations in a sidecar `.zf.json` beside the file; those stay local and never sync.

Worth adopting in spirit, because it serves the self-sufficiency goal directly: a paper added by DOI or URL with no Zotero item behind it should still be annotatable. Our equivalent is simply an annotation row whose `zoteroKey` is null — no sidecar file needed, since we have a database. Sync status becomes a property of the annotation rather than a separate storage mode.

---

## 6. Performance and bundle strategy

The reader must not tax users who never open a PDF.

- **Dynamic import only.** pdf.js core + worker land in a lazily-loaded chunk, never the main bundle. Route-level split on the reader panel.
- **Worker off the main thread.** Standard pdf.js worker setup; parsing never blocks the UI.
- **Virtualized pages.** Render current page ± 1; the rest are sized placeholders. A 400-page thesis reference must not allocate 400 canvases.
- **Text layer on demand.** Build it only when the user selects, searches, or an anchor needs resolving — it is the expensive part.
- **HTTP range requests.** pdf.js supports incremental fetch. Stream the pages needed rather than the whole file, which matters most on sources 3–5.
- **Content-hash cache key.** Same PDF reached via different URLs hits one cache entry.
- **Service worker stays out of it.** Do not precache PDFs in Serwist (§6.17) — the PWA's offline budget is for the app shell. PDF bytes live in a separate IndexedDB store with an explicit LRU cap the user can see and set.
- **Devices.** Respect `prefers-reduced-motion` for page transitions; cap canvas DPI on mobile to avoid memory kills.

Budget target: reader chunk under ~1MB gzipped, zero bytes added to first paint for non-reader routes.

---

## 7. Architecture

Follows the existing pattern — `UI → facades → use-cases (@thesis/core) → ports → adapters` — and the sibling structure under `apps/web/src/features/papers/`.

```
packages/core/src/reader/
  pdf-locus.ts            # PdfLocus, selector types, no framework deps
  anchor-resolution.ts    # quote → position fallback, multi-match disambiguation
  annotation.ts           # entity + invariants
  ports.ts                # IPdfSourceResolver, IAnnotationRepository

apps/web/src/features/reader/
  domain/                 # feature-local types
  application/            # resolve-pdf-source.use-case.ts, sync-annotations.use-case.ts
  infrastructure/         # zotero-pdf-source.ts, webdav-pdf-source.ts,
                          # open-access-pdf-source.ts, blob-pdf-source.ts,
                          # indexeddb-pdf-cache.ts, supabase-annotation-repository.ts
  ui/                     # reader-pane.tsx, annotation-layer.tsx, locus-jump.tsx
  test/
  module.ts / index.ts
```

- Resolution ladder = a chain of `IPdfSourceResolver` implementations composed in `wire-storage.ts`. Adding WebDAV later is a new adapter, not a change to the use-case (Open/Closed).
- Register the feature in `thesis-tracker.config.ts` so it is strippable at deploy time per the brief's modular-deployment model.
- UI never calls `supabase.from()` — repositories via `getContainer()`, per the brief's §2 rule.
- New migration for `paper_annotations` (or extend `metadata` on `papers` — prefer a table; annotations are queried and joined).

---

## 8. Feature set

Grouped by phase. Everything in "nice to have" is included, ordered so each phase ships something usable.

### Phase 0 — Capture the position fields (do this first, independent of everything else)

Extend `ZoteroItem.data` and `ZoteroAnnotation` to keep `annotationPosition`, `annotationType`, and `annotationSortIndex` (§5.2). Days of work, no UI, no new API surface — and it means every annotation already in the database is renderable the moment Phase 1 lands. Ship it ahead of the viewer so the backfill has time to run.

### Phase 1 — Read-only viewer (unblocks the P0 provenance UI)

- pdf.js render pane, virtualized, worker-backed, lazily imported
- Source resolution steps 1, 2, 4 (cache → Zotero → open access)
- IndexedDB byte cache with visible LRU cap
- Page navigation, zoom, fit-width/fit-page, rotate
- Text selection + copy
- **Jump-to-locus** from a stored anchor — the payoff for `/ai-review` and for citation deep links
- Render existing read-only Zotero annotation cards (§6.1) as overlays at their anchors

### Phase 2 — Annotation

- Create highlight / underline / strikeout with colour
- Note-on-selection with comment and tags
- Image-region capture (rect stored; raster only on explicit pin)
- Ink/freehand — mobile and stylus
- Annotation sidebar: filter by colour, tag, page, author
- Write-back to Zotero with field-level conflict diff (keep local / accept remote / batch resolve) — **conditional on the §5.3 spike succeeding**; if it fails, ship local-only annotations rendered alongside Zotero's with origin distinguished
- "Copy quote + cite" from inside the reader, reusing the existing §6.5 formatting

### Phase 3 — Self-sufficiency and reach

- WebDAV source (step 3) with server-sealed credentials
- User-supplied URL source (step 5)
- Opt-in `paper-pdfs` bucket (step 6) with per-project quota and tier-based eviction
- Full-text search within the document
- Outline / bookmarks pane from the PDF's own TOC
- Two-page spread and continuous scroll modes
- Dark-mode rendering that respects the Catppuccin themes (`docs/themes.md`)
- Offline reading for cached documents

### Phase 4 — Integration polish

- Split view: reader beside the vault note or report section
- Drag a highlight into a report section — annotation pin created with a live anchor (§6.8, `annotation_pins`)
- Backlinks from an annotation to every note and section citing it
- Reader as a shareable surface — a shared paper (§6.12) opens with the owner's annotations at `view` access
- EPUB support via `epub.js` (BSD-3, compatible) — same anchor model, `CFI` instead of a quote selector
- Keyboard-first navigation and screen-reader labelling on the annotation layer

---

## 8.1 Parity checklist against ZotFlow

Tracked so gaps do not evaporate. "Target" is the phase or plan that delivers it.

Verified 2026-07-25 against ZotFlow's README, `manifest.json`, documentation site, and the GitHub API — not against secondary summaries.

**Subject:** ZotFlow v1.3.1 · AGPL-3.0-only · repo created 6 Jan 2026, last push 19 Jul 2026 · 158 stars, 22 open issues · ~9,000 downloads · `minAppVersion` 1.11.4, `isDesktopOnly: false`.

| ZotFlow capability | Verified detail | Our status | Target |
|---|---|---|---|
| Embedded reader | PDF, EPUB, **HTML**; engine vendored from Zotero Reader; themed to Obsidian | Planned (PDF only) | Phase 1 + Phase 3 (theming) |
| Highlight / underline | Yes | Planned | Phase 2 |
| Drawing / ink | Yes | Planned | Phase 2 |
| Sticky notes | Yes | Planned | Phase 2 |
| Image-region capture | Yes, plus bulk extraction of all annotation images | Planned (bulk is a gap) | Phase 2 |
| "All annotation types Zotero supports" | Yes | Planned | Phase 2 |
| Bidirectional annotation sync | **Confirmed shipping** — annotations sync back to Zotero | Planned | Phase 2 (§5.3) |
| Per-library modes | Bidirectional / Read-Only / Ignored | **Gap** | Unplanned — small; extends existing sync settings |
| Conflict resolution | Field-level diff viewer | Planned | Phase 2 |
| Offline-first | IndexedDB; network only for Zotero and WebDAV | Planned | Phase 1 + Phase 3 |
| WebDAV | Yes, for self-hosted Zotero storage | Planned | Phase 3 |
| Linked attachment base directory | Yes | **Gap** | Unplanned — our ladder step 5 partly covers it |
| Templated source notes | LiquidJS, with **persistent and editable regions** so re-render does not clobber user edits | Planned **elsewhere** | Vault note templates — P0 in `docs/competitive-research-verified-2026-07.md` §6. *Adopt the editable-region mechanic; it is the hard part* |
| Citation formats | Pandoc `[@key]`, wikilink `[[Source/@key\|Author (year)]]`, footnote, raw citekey, **CSL styles via citeproc** | Planned **elsewhere** (CSL is beyond current scope) | P1 in the same roadmap |
| Citation insertion triggers | Drag-and-drop from tree view, autocomplete on `@@`, copy-from-reader hotkeys, auto-inclusion of page numbers and quoted text | Partial — copy-from-reader is Phase 2; drag-from-tree is a **gap** | Phase 2 + roadmap |
| Batch operations | Generate all source notes; extract all annotation images; re-render all templates | **Gap** | Unplanned |
| Native Zotero child notes | Create and edit in place; sync back | **Gap** | Unplanned |
| Annotate vault files with no Zotero | Sidecar `.zf.json`; stays local | **Gap** | §5.4 — cheap for us, we have a database |
| Activity Center | Sync progress and task log UI | **Gap** | Unplanned — small |
| Credential handling | Platform-native SecretStorage, never in synced files; no telemetry | **Shipped** (server-key sealing) | — |
| In-document full-text search | Not documented either way | Planned | Phase 3 |
| Mobile | `isDesktopOnly: false`, but README states "built to be mobile-safe with **currently limited** mobile support" | Unproven | Phase 3 — blocked on the §10 memory measurement |

**Scope note.** Full parity with *ZotFlow + Obsidian* is not the target and is not achievable — ZotFlow inherits Obsidian's editor, graph, plugin ecosystem, and mobile app. §11 rules out chasing that. The target is parity on the **literature loop** — read → annotate → source note → cite — because that is the only surface where the two products actually compete for the same user. Everything outside it (experiments + SDK, plan, report outline, labs and supervision, MCP) is ours alone.

## 9. Risks

| Risk | Mitigation |
|------|-----------|
| **Incompatible code entering the repo** — a component under a licence AGPL-3.0 cannot absorb | Repo-wide CI licence check; written rule in `CONTRIBUTING.md`. Permissive inbound (Apache/MIT/BSD) is fine and recorded in `NOTICE` |
| **Engine coupling** — vendoring `zotero/reader` ties us to Zotero's release cycle and environment assumptions | §1.1 spike decides before integration code is written; the anchor model (§5.1) is renderer-agnostic, so falling back to pdf.js costs the reader layer only |
| **Storage creep** — "opt-in" server blobs become the default path | Quota enforced at the port, not the UI; eviction weights favour `paper-pdfs`; storage usage visible in Settings |
| **Bundle regression** — pdf.js leaks into the main chunk | Bundle-size assertion in CI on the main entry |
| **Anchor rot** — text extraction differs across pdf.js versions, breaking stored quotes | Store the pdf.js version alongside the anchor; keep the position fallback; surface low-confidence matches rather than jumping silently |
| **Scope drift into a PDF library** | §2 amendment is narrow and explicit: Zotero stays the system of record |
| **Zotero sync conflicts corrupting user annotations** | Never auto-resolve; field-level diff with explicit user choice; write-back is opt-in per library, mirroring the existing sync toggles |

---

## 10. Open questions

1. **Does the Zotero Web API actually accept annotation writes?** Now the highest-priority unknown — see §5.3. Answer it with the spike before Phase 2 scope is fixed, because it determines whether Zotero can remain the single system of record or whether we run a dual store. Test personal *and* group libraries.
2. **`paper_annotations` table vs extending `papers.metadata`.** Table is the right call for querying and RLS granularity, but adds a migration and a repository. Confirm before Phase 2.
3. **Do we render annotations from *other* users on a shared paper?** Attribution and RLS both get more complex. Deferred to Phase 4.
4. **Mobile memory ceiling.** pdf.js canvas allocation on low-end Android inside the TWA wrapper needs measuring before Phase 3 promises offline reading.

---

## 11. Related

- `docs/competitive-research-verified-2026-07.md` — §2.1 ZotFlow teardown, §4.1 anchor design, §6 roadmap
- `docs/DEEP_RESEARCH_PRODUCT_BRIEF.md` — §6.1 papers, §6.17 storage/PWA, §11 non-goals (amend per §2 above)
- `docs/storage/tiering.md` — existing tiering design
- `packages/core/src/storage/` — `IBlobStore`, `BlobTier`, eviction scoring
- `apps/web/src/features/papers/infrastructure/zotero-*.ts` — existing Zotero auth, sync, and annotation ingest
