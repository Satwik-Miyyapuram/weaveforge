# Reader: linked references, figure links, heuristic outline

**Status:** working · **Branch:** `feat/reader-references` (worktree off `main`) · **Written:** 2026-09-17

What Google Scholar PDF Reader does, done inside our reader, with two things
Scholar can't do: know which references are already in the library, and add a
reference to the library ("read later") or a reading list in one click.

No Google Scholar API exists. Resolution goes DOI/arXiv → Crossref/arXiv (have
them), else Semantic Scholar `paper/search/match` (no key needed; the optional
user key only raises the rate limit — see
`apps/web/src/features/relations/infrastructure/semantic-scholar-citation-source.ts`),
else OpenAlex `works?search=` (no key). Scholar appears only as an outbound
search link.

---

## 0. Ground rules for the agent

- Read `docs/building/design.md` §3–4 first. Feature-module shape, dependencies
  inward only, no SDK/HTTP in `packages/core`.
- Pure parsing lives in `packages/core/src/features/reader/` with unit tests
  under `packages/core/test/features/reader/`. Every parser takes plain data
  (`PageText`-shaped input), never a pdf.js object.
- Network adapters live in `apps/web/src/features/papers/infrastructure/` and
  implement existing interfaces (`IMetadataSource`).
- UI lives in `apps/web/src/features/reader/ui/`. Reuse
  `apps/web/src/components/popover.tsx` positioning logic (extract the
  `place()` routine into a hook if needed rather than copy it), reuse
  `.btn-primary` / `.btn-secondary` / `.link-btn`, tokens from
  `apps/web/src/app/styles/` (`--surface`, `--border`, `--accent`, `--muted`,
  `--z-popover`, `--shadow`).
- Match surrounding comment density and naming. Commit per phase with
  conventional-commit subjects; run `npm test -w packages/core` and
  `npm run lint` before each commit.
- Do not touch `feat/ink-notes` files. If something in `pdf-reader.tsx` must
  change, keep the diff minimal and additive.

---

## 1. Existing pieces to build on (do not reinvent)

| Need | Already have |
|---|---|
| pdf.js text layer with geometry | `apps/web/src/features/reader/ui/pdf-reader/pdf-document.ts` — `buildPageText`, `textItemsFromContent` → `PageText`, `TextItemGeometry` (`types.ts`) |
| Outline sidebar | `apps/web/src/features/reader/ui/reader-outline.tsx` (`ReaderOutlineItem`), `mapOutline` in `pdf-document.ts` |
| Overlay hitboxes on pages | `apps/web/src/features/reader/ui/annotation-overlay.tsx`, `project-annotation-geometry.ts` |
| Quote → position | `PdfLocus` resolution (`@weaveforge/core`), used by annotations |
| Metadata by DOI / arXiv / URL | `packages/core/.../papers/application/metadata-source.ts` (`IMetadataSource`, `MetadataResolver`, `PaperRef`), impls in `apps/web/src/features/papers/infrastructure/*-metadata-source.ts` |
| Add paper + dedupe | `AddPaperUseCase`, `ImportPaperUseCase.fromRef(ref, status)` — `PaperStatus = "to_read" \| "reading" \| "read" \| "skimmed"` |
| Reading lists | `ManageReadingListUseCase.addPaperToList(listId, paperId, …)` in `packages/core/src/features/reading-lists/application/manage-reading-list.use-case.ts` |
| Paper relations graph | `packages/core/src/features/relations/` (`ICitationSource`, manage-relations use case) |
| Citation formatting | `apps/web/src/components/citation-format-select.tsx` |
| S2 client with 429 backoff | `semantic-scholar-citation-source.ts` — extract the fetch+backoff helper for reuse |
| Facade pattern for UI deps | `apps/web/src/container/facades/papers.ts` |

---

## 2. Phase 1 — heuristic outline (pure, no network)

**Goal:** arXiv-style PDFs with no bookmarks get a section outline.

`packages/core/src/features/reader/outline-from-text.ts`

```ts
export interface OutlineTextItem { str: string; fontSize: number; fontName?: string; x: number; y: number; page: number }
export function outlineFromText(pages: readonly OutlineTextItem[][]): ReaderOutlineItem[]
```

Algorithm:
1. Body size = modal `fontSize` over all items (round to 0.5).
2. Candidate line = consecutive items on same `y` (±1pt) joined.
3. Heading if: `fontSize ≥ 1.12 × body` **or** (`fontName` matches `/bold|black|heavy/i` **and** line matches `^\d+(\.\d+)*\.?\s+\S` or `^(Abstract|Introduction|Related Work|Method|Results|Discussion|Conclusion|References|Appendix)\b`).
4. Level = depth of dotted number (`3.2.1` → 3), else by font size rank (largest = 1).
5. Reject lines > 120 chars, lines ending in `.` unless numbered, and page headers/footers (same text on ≥3 pages).
6. Stop at first "References" heading (include it as final item).

Wire: in the reader, if `doc.getOutline()` is empty, feed page text items into
`outlineFromText`. Label the sidebar heading "Sections (detected)" in that case
so users know it's heuristic.

Tests: fixtures for a numbered arXiv paper, an unnumbered ACL paper, a
two-column IEEE paper (headings in narrow column). Assert titles + pages.

---

## 3. Phase 2 — reference list + in-text citations + resolution

### 3a. Parse the reference list (pure)

`packages/core/src/features/reader/parse-reference-list.ts`

```ts
export interface ParsedReference {
  index: number;             // 1-based position in list
  label?: string;            // "[12]", "12.", or undefined for author-year
  raw: string;               // joined text of the entry
  page: number;              // page where entry starts
  authors: string[];         // best-effort surnames
  year?: number;
  title?: string;            // best-effort
  doi?: string;              // normalised via normalizeDoi
  arxivId?: string;
  url?: string;
}
export function parseReferenceList(pages: readonly OutlineTextItem[][]): ParsedReference[]
```

Algorithm:
1. Find the last line matching `^(References|Bibliography|Works Cited)$`
   (case-insensitive, from Phase 1 heading detection). Take all text after it,
   stopping at an `Appendix` heading if present.
2. Split into entries. Strategies, tried in order, keep the one yielding ≥ 3
   entries:
   - numbered: line starts with `\[\d+\]` or `^\d+\.\s`;
   - hanging indent: line `x` equals the column's min `x` (±2pt) starts an
     entry, indented lines continue it;
   - author-year: line starts with `[A-Z][^,]+,\s` and previous entry contains
     a `(19|20)\d\d`.
3. Per entry: DOI `10\.\d{4,9}/[^\s"<>]+`, arXiv `\d{4}\.\d{4,5}(v\d+)?` or
   `arXiv:…`, year `\b(19|20)\d\d[a-z]?\b`, authors = text before first year or
   before first `"`/`“`, title = quoted segment or the segment after
   authors+year up to first `.` followed by capital/`In `.
4. Strip hyphenation across line breaks (`-\n` → ``).

### 3b. Find in-text mentions (pure)

`packages/core/src/features/reader/find-citation-mentions.ts`

```ts
export interface CitationMention {
  page: number;
  start: number; end: number;      // char range in PageText.text
  refIndexes: number[];            // resolved against ParsedReference.index
}
export function findCitationMentions(pageText: string, page: number, refs: readonly ParsedReference[]): CitationMention[]
```

Patterns:
- numeric: `\[(\d+(?:\s*[-–]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*)\]` → expand ranges; also superscript-style digits when the list is numbered and the text item is ≤ 0.75 × body size (needs `fontSize`, so signature also accepts items).
- author-year: `\(([A-Z][A-Za-z'’\-]+(?:\s+(?:et al\.|and|&)\s+[A-Z][A-Za-z'’\-]+)?,?\s+(19|20)\d\d[a-z]?(?:;\s*…)*)\)` and narrative `Surname et al. (2019)`. Match to refs by first-author surname + year; ties → all candidates.
- Skip pages at or after the References heading.

### 3c. Figure / table / equation mentions (pure)

`packages/core/src/features/reader/find-figure-mentions.ts`

- Mention: `\b(Fig(?:ure)?s?|Tab(?:le)?s?|Eq(?:uation)?s?|Sec(?:tion)?s?|Alg(?:orithm)?s?)\.?\s*\(?(\d+[a-z]?)\)?`
- Target: first line on any page starting with `(Figure|Fig\.|Table|Algorithm)\s+N\b` (captions) or a line whose right-aligned text is `(N)` (equations). Sections → Phase 1 outline.
- Output `{ page, start, end, target: { page, y } }`.

### 3d. Resolve to a record

New `PaperRef` kind in `metadata-source.ts`:

```ts
| { kind: "bibliographic"; value: string; hints?: { title?: string; year?: number; firstAuthor?: string } }
```

Adapters (`apps/web/src/features/papers/infrastructure/`):

- `semantic-scholar-metadata-source.ts` — `supports` = `bibliographic`.
  `GET https://api.semanticscholar.org/graph/v1/paper/search/match?query=<title or raw>&fields=title,authors,year,venue,externalIds,openAccessPdf,citationCount`.
  Optional `x-api-key` from user settings like the citation source. Reuse the
  429 backoff. Accept a match only if title similarity (normalised
  Jaro-Winkler or token-set ratio, put the scorer in core) ≥ 0.85 and year
  within ±1 when both known. Return `PaperMetadata` with `doi`/`arxivId` filled
  from `externalIds` so `AddPaperUseCase` dedupe works.
- `openalex-metadata-source.ts` — same contract, `GET https://api.openalex.org/works?search=<title>&per-page=3&mailto=<from config>`. Registered after S2 in the resolver.

`ReferenceLookupService` (`apps/web/src/features/reader/application/reference-lookup.ts`):

```ts
resolve(ref: ParsedReference): Promise<ResolvedReference>
// ResolvedReference = { status: "resolved", metadata, inLibrary?: Paper, sourceId }
//                   | { status: "unresolved" } | { status: "pending" }
```

- Order: `doi` → Crossref; `arxivId` → arXiv; else `bibliographic` chain.
- Then `papers.findByDoi` / `findByArxivId` → `inLibrary`.
- Cache per (paperId, refIndex) in memory + IndexedDB (same store family as
  `indexeddb-pdf-byte-cache.ts`), TTL 30 days. Resolve lazily on hover/click,
  plus a background batch for the first 20 refs after the PDF loads (throttle
  1 req/s unkeyed).

### 3e. Actions

Facade methods (extend `PapersFacade` or add `ReaderReferencesFacade`):

- `readLater(resolved)` → `ImportPaperUseCase.fromRef(ref, "to_read")` where
  ref prefers doi → arxiv → `bibliographic` (last one calls `addManual` with the
  metadata already in hand — don't refetch).
- `addToList(resolved, listId)` → `readLater` then
  `ManageReadingListUseCase.addPaperToList`.
- `linkPapers(current, target)` → existing manage-relations use case, relation
  kind "cites".
- `openInReader(paper)` → existing navigation.
- `cite(metadata, format)` → existing citation formatter → clipboard.

### 3f. UI

`apps/web/src/features/reader/ui/reference-overlay.tsx` — per page, absolutely
positioned `<button class="pdf-reader-ref-link">` over each mention's text-item
rects (same projection as annotation overlay). Hover: dotted underline in
`--accent`; active: `--accent` at 15% background. Figure links use the same
class with `data-kind="figure"`; click scrolls to target and flashes it
(`.pdf-reader-flash`, 600ms outline fade — see `motion.css`).

`apps/web/src/features/reader/ui/reference-popover.tsx` — one instance, anchored
to the clicked mention, placed with the popover `place()` logic, closes on
outside click / Esc / scroll of the page container. Width 320px, `--surface`,
`1px solid var(--border-strong)`, `var(--shadow)`, `z-index: var(--z-popover)`.

States (see mockup in the plan discussion; encode as `status`):

**A — resolved, not in library**
- Title (500 weight, 14px), meta line 12px `--muted`: first 3 surnames +
  "+N" · year · venue · "cited N".
- Buttons: `Read later` (`.btn-primary`, the only primary), `Add to list ▾`
  (`.btn-secondary`, opens list picker using existing reading-list tree),
  `PDF` (ghost, only if `openAccessPdf`), `Cite` (ghost, format select).
- Footer 11px: source name · `Scholar ↗` (`https://scholar.google.com/scholar?q=<encoded title>`) · `DOI ↗`.
- After `Read later` succeeds: button becomes `Added · Open in reader` and the
  state flips to B without refetch.

**B — already in library**
- Same title/meta plus pill `In library · <status>` (`--bg-success`-style tint;
  reuse tag-chip styling).
- Buttons: `Open in reader` (primary), `Link papers` (secondary, hidden if
  relation already exists), `Cite` (ghost).
- Footer: "N notes · M highlights on this paper" from reader-annotation source.

**C — unresolved**
- Raw entry text in `--font-mono` 11px `--muted`, max 4 lines.
- Pill `No match found` (warning tint).
- Buttons: `Scholar ↗`, `Add manually` (opens existing add-paper dialog
  prefilled with parsed authors/title/year), `Jump to entry` (ghost, scrolls
  to the reference list entry).

**Pending** — title area shows a 2-line skeleton; buttons rendered but
disabled with the raw text as tooltip. Never leave the popover empty.

Multi-ref mentions (`[3, 7]`): popover shows a compact vertical list of
entries (title + year), each expanding to the states above on click.

Sidebar: add a "References" tab next to Outline listing all `ParsedReference`
with their resolution pill; clicking scrolls to the entry, chevron opens the
same popover. Toolbar toggle "Link citations" (default on, persisted in reader
settings) turns the overlay off for users who find it noisy.

Keyboard: mention buttons are in tab order; Enter opens popover; Esc closes and
returns focus.

Dark PDF mode (`use-dark-pdf.ts`): overlay colours must stay readable when the
canvas is inverted — use `--accent` on the overlay layer, which sits above the
filter.

---

## 4. Phase 3 — AI outline (optional, after 1–2 ship)

- Input: Phase 1 headings + first 6k tokens of body text per section.
- Prompt via `packages/ai-assistant`: return ≤ 12 bullets, each
  `{ text, anchor }` where `anchor` is an exact ≤ 12-word quote from the input.
- Resolve `anchor` with `PdfLocus` quote matching → page + y; unresolvable
  anchors fall back to the section's page.
- Render as "Summary" tab in the sidebar; cache per paper hash in the same
  IndexedDB store. Explicit "Generate summary" button — never automatic, it
  costs tokens.

---

## 5. Test plan

- Core: parser fixtures (≥ 3 real-paper text dumps checked into
  `packages/core/test/fixtures/reader/`), mention matcher edge cases (ranges,
  superscripts, `et al.`, semicolon lists, false positives like `[10 mm]`,
  `(2019)` alone), title-similarity scorer thresholds.
- Web: `reference-lookup.test.ts` with fake `IMetadataSource`s asserting order,
  caching, and `inLibrary` detection; S2/OpenAlex adapters with recorded JSON
  responses under `test/`.
- E2E (`apps/web/e2e/reader.spec.ts`): open fixture PDF, click `[1]`, assert
  popover title, click `Read later`, assert paper appears in library with
  status `to_read`.
- Manual: desktop app via CDP loop (see memory note) on a two-column paper and
  an author-year paper; dark mode.

---

## 6. Order of work and commits

1. `feat(reader): detect section outline from text layer` — Phase 1 + tests + sidebar wiring.
2. `feat(reader): parse reference list and in-text citations` — 3a, 3b, 3c pure + tests.
3. `feat(papers): bibliographic metadata via Semantic Scholar and OpenAlex` — 3d adapters + `bibliographic` ref kind + resolver registration.
4. `feat(reader): reference lookup service with cache` — 3d service + tests.
5. `feat(reader): citation overlay and reference popover` — 3f overlay, popover states A/B/C, actions wired.
6. `feat(reader): references sidebar tab and figure links`.
7. `docs: reader references` — update `docs/building/architecture-map.md`, move this plan to `docs/plans/completed/`.

Open questions to raise in the PR rather than block on: whether `Read later`
should also auto-create a "cites" relation to the current paper (leaning yes,
behind the same toggle as Link papers).
