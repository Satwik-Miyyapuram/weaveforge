# Reader: linked references, figure links, detected outline

| | |
|---|---|
| **Status** | working |
| **Branch** | `feat/reader-references` — worktree off `main` |
| **Written** | 2026-09-17 |
| **Inspiration** | Google Scholar PDF Reader (closed source; no API) |

What the Scholar extension does — clickable `[12]` citations with a record
preview, figure/table links, a section outline — done inside our reader, plus
two things Scholar can't do: know which references are already in the library,
and add a reference as *read later* or to a reading list in one click.

---

## Contents

1. [Ground rules](#1-ground-rules)
2. [What already exists](#2-what-already-exists)
3. [Resolution strategy](#3-resolution-strategy)
4. [Popover design](#4-popover-design)
5. [Phase 1 — detected outline](#5-phase-1--detected-outline)
6. [Phase 2 — references and citations](#6-phase-2--references-and-citations)
7. [Phase 3 — AI summary](#7-phase-3--ai-summary-optional)
8. [Tests](#8-tests)
9. [Commits](#9-commits)
10. [Lessons from the Scholar extension](#10-lessons-from-the-scholar-extension)

---

## 1. Ground rules

- Read `docs/building/design.md` §3–4 first. Feature-module shape; dependencies
  point inward; no SDK or HTTP inside `packages/core`.
- **Pure parsing** → `packages/core/src/features/reader/`, tests in
  `packages/core/test/features/reader/`. Parsers take plain data, never a
  pdf.js object.
- **Network adapters** → `apps/web/src/features/papers/infrastructure/`,
  implementing the existing `IMetadataSource`.
- **UI** → `apps/web/src/features/reader/ui/`. Reuse
  `apps/web/src/components/popover.tsx` placement (extract `place()` into a hook
  rather than copy it), `.btn-primary` / `.btn-secondary` / `.link-btn`, and
  tokens from `apps/web/src/app/styles/` (`--surface`, `--border`,
  `--border-strong`, `--accent`, `--muted`, `--shadow`, `--z-popover`).
- Match surrounding comment density and naming. One commit per phase,
  conventional-commit subjects. `npm test -w packages/core` and `npm run lint`
  green before each commit.
- Do not touch files under `apps/web/src/features/ink/`. Changes to
  `pdf-reader.tsx` stay minimal and additive.

---

## 2. What already exists

Do not reinvent any of these.

| Need | Have |
|---|---|
| Text layer with geometry | `reader/ui/pdf-reader/pdf-document.ts` — `buildPageText`, `textItemsFromContent` → `PageText`, `TextItemGeometry` in `types.ts` |
| Outline sidebar | `reader/ui/reader-outline.tsx` (`ReaderOutlineItem`), `mapOutline` in `pdf-document.ts` |
| Hitboxes over page text | `reader/ui/annotation-overlay.tsx`, `reader/application/project-annotation-geometry.ts` |
| Quote → page position | `PdfLocus` resolution in `@weaveforge/core` |
| Metadata by DOI / arXiv / URL | `core/features/papers/application/metadata-source.ts` (`IMetadataSource`, `MetadataResolver`, `PaperRef`); impls `apps/web/src/features/papers/infrastructure/*-metadata-source.ts` |
| Add paper with dedupe | `AddPaperUseCase`, `ImportPaperUseCase.fromRef(ref, status)`; `PaperStatus = "to_read" \| "reading" \| "read" \| "skimmed"` |
| Reading lists | `ManageReadingListUseCase.addPaperToList(listId, paperId)` |
| Paper relations | `core/features/relations/` — manage-relations use case, `ICitationSource` |
| Citation formats | `components/citation-format-select.tsx` |
| Semantic Scholar client, 429 backoff, optional key | `relations/infrastructure/semantic-scholar-citation-source.ts` — extract the fetch helper |
| UI dependency injection | `apps/web/src/container/facades/papers.ts` |

---

## 3. Resolution strategy

Google Scholar has no API; scraping trips CAPTCHA within ~20 requests and
breaks the ToS. It appears only as an outbound search link.

```
ParsedReference
   │
   ├─ has DOI ──────────► Crossref            (existing)
   ├─ has arXiv id ─────► arXiv               (existing)
   └─ else ─────────────► Semantic Scholar  paper/search/match   (new, no key needed)
                              │ no match / 429 exhausted
                              └───────────► OpenAlex  works?search=   (new, no key)
   then: papers.findByDoi / findByArxivId ──► inLibrary?
```

- Semantic Scholar works unauthenticated (shared pool, ~1 req/s). The user's
  optional key, already read from settings by the citation source, only raises
  the limit. Same `x-api-key` plumbing, same backoff.
- Accept an S2/OpenAlex match only if title similarity ≥ 0.85 (token-set ratio,
  scorer in core) and year within ±1 when both known.
- Results cached per `(paperId, refIndex)` in memory + IndexedDB, 30-day TTL.
  Lazy on hover/click; background batch for the first 20 refs after load,
  throttled to 1 req/s when unkeyed.

---

## 4. Popover design

Anchored to the clicked mention. 320px wide, `--surface`, `1px solid
var(--border-strong)`, `var(--shadow)`, `z-index: var(--z-popover)`. Closes on
outside click, Esc, or page scroll. One `.btn-primary` per state; the rest
`.btn-secondary` or ghost (`.link-btn`). Sentence case, no trailing punctuation
on labels.

### State A — resolved, not in library

```
…dot-product attention [12] scaled by 1/√d …
                        ╵
┌────────────────────────────────────────────────────┐
│ Attention is all you need                          │  14px · 500
│ Vaswani, Shazeer, Parmar +5 · 2017 · NeurIPS ·     │  12px · --muted
│ cited 120k                                         │
│                                                    │
│ [ Read later ]  [ Add to list ▾ ]   PDF    Cite    │  primary · secondary · ghost · ghost
│                                                    │
│ Semantic Scholar · Scholar ↗ · DOI ↗               │  11px · --muted, links --accent
└────────────────────────────────────────────────────┘
```

- `Read later` → `ImportPaperUseCase.fromRef(ref, "to_read")`. On success the
  button becomes `Added · Open in reader` and the popover flips to state B
  without refetching.
- `Add to list ▾` → reading-list tree picker (existing component); adds with
  status `to_read` then `addPaperToList`.
- `PDF` only when `openAccessPdf` present; opens in our reader via the proxy.
- `Cite` → format select → clipboard.
- `Scholar ↗` = `https://scholar.google.com/scholar?q=<encoded title>`.

### State B — already in library

```
…as shown by Devlin et al. (2019) on masked …
                           ╵
┌────────────────────────────────────────────────────┐
│ BERT: pre-training of deep bidirectional…          │
│ Devlin, Chang, Lee, Toutanova · 2019 · NAACL       │
│ ● In library · reading                             │  pill, success tint
│                                                    │
│ [ Open in reader ]  [ Link papers ]   Cite         │
│                                                    │
│ 3 notes · 2 highlights on this paper               │  from reader-annotation source
└────────────────────────────────────────────────────┘
```

- `Link papers` creates a `cites` relation current → target; hidden when the
  relation already exists.

### State C — unresolved

```
…the original derivation [31] uses …
                          ╵
┌────────────────────────────────────────────────────┐
│ [31] K. Müller, Internal report on lattice         │  --font-mono · 11px · --muted
│ tuning, Tech. Rep. 44, 1998.                       │  max 4 lines
│ ● No match found                                   │  pill, warning tint
│                                                    │
│ [ Scholar ↗ ]  [ Add manually ]   Jump to entry    │
└────────────────────────────────────────────────────┘
```

- `Add manually` opens the existing add-paper dialog prefilled with parsed
  authors / title / year.
- `Jump to entry` scrolls to the reference-list entry.

### Pending

Two-line skeleton where the title goes; buttons rendered but disabled with the
raw entry as tooltip. Never an empty popover.

### Multi-reference mentions

`[3, 7]` or `(Smith 2019; Lee 2020)` → compact list, one row per entry
(title · year · library pill). Clicking a row expands it to the state above.

### Mentions on the page

- Overlay button over the mention's text rects, `pdf-reader-ref-link`.
- Rest: dotted underline `--accent`. Hover/active: `--accent` at 15% bg,
  3px radius.
- Figure/table/equation mentions use the same class with `data-kind`; click
  scrolls to the caption and flashes it (`.pdf-reader-flash`, 600ms outline
  fade, in `motion.css`).
- In tab order; Enter opens; Esc closes and returns focus.
- Overlay layer sits above the dark-mode canvas filter (`use-dark-pdf.ts`) so
  colours stay readable.

### Sidebar and toolbar

- New **References** tab beside Outline: every parsed entry with its
  resolution pill; click scrolls to the entry, chevron opens the popover.
- Toolbar toggle **Link citations** (default on, persisted in reader settings)
  hides the overlay.
- When the outline is heuristic, the tab reads **Sections (detected)**.

---

## 5. Phase 1 — detected outline

Goal: PDFs without bookmarks (most arXiv) still get a section outline.

`packages/core/src/features/reader/outline-from-text.ts`

```ts
export interface OutlineTextItem {
  str: string; fontSize: number; fontName?: string;
  x: number; y: number; page: number;
}
export function outlineFromText(pages: readonly OutlineTextItem[][]): ReaderOutlineItem[];
```

1. Body size = modal `fontSize` across all items, rounded to 0.5.
2. Line = consecutive items sharing `y` (±1pt), joined.
3. Heading when `fontSize ≥ 1.12 × body`, **or** `fontName` matches
   `/bold|black|heavy/i` and the line matches `^\d+(\.\d+)*\.?\s+\S` or
   `^(Abstract|Introduction|Related Work|Method|Results|Discussion|Conclusion|References|Appendix)\b`.
4. Level = depth of the dotted number (`3.2.1` → 3); otherwise rank by font size.
5. Reject: > 120 chars; ends in `.` and unnumbered; repeated on ≥ 3 pages
   (running headers/footers — compare with Levenshtein distance ≤ 20 % of the
   shorter string, not exact equality; page numbers differ).
5b. Ignore items inside the outer 6 % margin of the page (publisher stamps,
   download banners) and lines that are only a dotted leader `(\.\s*){5,}$`.
5c. Line grouping: try `y` tolerance 0.75 × font size first; if a page yields
   no headings, retry at 0.5 × (tight-leading templates).
6. Stop after the first `References` heading (keep it as the last item).
7. Accept the result only if ≥ 3 headings and no gap between consecutive
   headings > 50 % of the page count; otherwise return `[]` (sidebar shows the
   existing empty state, no junk outline).

Wire: when `doc.getOutline()` is empty, pass text items to `outlineFromText`.

---

## 6. Phase 2 — references and citations

### 6a. Parse the reference list — pure

`packages/core/src/features/reader/parse-reference-list.ts`

```ts
export interface ParsedReference {
  index: number;      // 1-based
  label?: string;     // "[12]", "12." — undefined for author-year lists
  raw: string;
  page: number;
  authors: string[];  // surnames, best effort
  year?: number;
  title?: string;
  doi?: string;       // normalizeDoi
  arxivId?: string;
  url?: string;
}
export function parseReferenceList(pages: readonly OutlineTextItem[][]): ParsedReference[];
```

1. Start after the last `^(References|Bibliography|Works Cited)$` line; stop
   at an `Appendix` heading.
2. Split into entries — first strategy yielding ≥ 3 wins:
   - numbered: line starts `\[\d+\]` or `^\d+\.\s`;
   - hanging indent: line at the column's min `x` (±2pt) starts an entry;
   - author-year: line starts `[A-Z][^,]+,\s` and previous entry contains a year.
3. Per entry: DOI `10\.\d{4,9}/[^\s"<>]+`; arXiv `\d{4}\.\d{4,5}(v\d+)?` or
   `arXiv:…`; year `\b(19|20)\d\d[a-z]?\b`; authors = text before the first
   year or opening quote; title = quoted segment, else the segment after
   authors+year up to the first `.` followed by a capital or `In `.
4. Join hyphenated line breaks (`-\n` → ``).

### 6b. Find in-text mentions — pure

`packages/core/src/features/reader/find-citation-mentions.ts`

```ts
export interface CitationMention {
  page: number;
  start: number; end: number;   // char range in PageText.text
  refIndexes: number[];
}
export function findCitationMentions(
  page: { number: number; text: string; items: OutlineTextItem[] },
  refs: readonly ParsedReference[],
  bodyFontSize: number,
): CitationMention[];
```

- Numeric: `\[(\d+(?:\s*[-–]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*)\]`,
  ranges expanded. Superscript digits count when the list is numbered and the
  item's `fontSize ≤ 0.75 × body`.
- Author-year: parenthetical
  `\(([A-Z][\w'’\-]+(?:\s+(?:et al\.|and|&)\s+[A-Z][\w'’\-]+)?,?\s+(19|20)\d\d[a-z]?(?:;\s*[^)]+)*)\)`
  and narrative `Surname et al. (2019)`. Match on first-author surname + year;
  ties → all candidates.
- Skip pages at or after the References heading.
- Reject `[10 mm]`, `[0, 1]` when out of range, bare `(2019)`.

### 6c. Figure, table, equation mentions — pure

`packages/core/src/features/reader/find-figure-mentions.ts`

- Mention: `\b(Fig(?:ure)?s?|Tab(?:le)?s?|Eq(?:uation)?s?|Sec(?:tion)?s?|Alg(?:orithm)?s?)\.?\s*\(?(\d+[a-z]?)\)?`
- Target: first line on any page starting `(Figure|Fig\.|Table|Algorithm)\s+N\b`;
  equations = right-aligned `(N)`; sections = Phase 1 outline.
- Output `{ page, start, end, target: { page, y } }`.

### 6d. Resolve — adapters and service

`PaperRef` gains a kind in `metadata-source.ts`:

```ts
| { kind: "bibliographic"; value: string;
    hints?: { title?: string; year?: number; firstAuthor?: string } }
```

`apps/web/src/features/papers/infrastructure/`

- `semantic-scholar-metadata-source.ts` —
  `GET /graph/v1/paper/search/match?query=<title|raw>&fields=title,authors,year,venue,externalIds,openAccessPdf,citationCount`.
  Fills `doi` / `arxivId` from `externalIds` so dedupe works.
- `openalex-metadata-source.ts` —
  `GET https://api.openalex.org/works?search=<title>&per-page=3&mailto=<config>`.
  Registered after S2.

`apps/web/src/features/reader/application/reference-lookup.ts`

```ts
type ResolvedReference =
  | { status: "resolved"; metadata: PaperMetadata; inLibrary?: Paper; sourceId: string }
  | { status: "unresolved" }
  | { status: "pending" };
class ReferenceLookupService { resolve(ref: ParsedReference): Promise<ResolvedReference> }
```

Order and cache as in §3.

### 6e. Actions — facade

Extend `PapersFacade` or add `ReaderReferencesFacade`:

| Action | Implementation |
|---|---|
| `readLater(r)` | `ImportPaperUseCase.fromRef(doi ∣ arxiv, "to_read")`; bibliographic-only → `AddPaperUseCase.addManual(metadata)` (no refetch) |
| `addToList(r, listId)` | `readLater` then `addPaperToList` |
| `linkPapers(current, target)` | manage-relations, kind `cites` |
| `openInReader(paper)` | existing navigation |
| `cite(metadata, format)` | existing formatter → clipboard |

### 6f. UI files

- `reader/ui/reference-overlay.tsx` — per-page mention buttons (§4).
- `reader/ui/reference-popover.tsx` — single instance, states A/B/C/pending.
- `reader/ui/reference-list-panel.tsx` — sidebar tab.
- `pdf-reader.tsx` — mount overlay + popover; toolbar toggle.

---

## 7. Phase 3 — AI summary (optional)

- Input: Phase 1 headings + first 6k tokens of body text per section.
- Prompt via `packages/ai-assistant`: ≤ 12 bullets, each `{ text, anchor }`,
  `anchor` = exact ≤ 12-word quote from the input.
- Resolve `anchor` with `PdfLocus`; fallback to the section's page.
- **Summary** tab in the sidebar; cached per paper hash. Explicit
  `Generate summary` button — never automatic.

---

## 8. Tests

- **Core**: ≥ 3 real-paper text dumps in `packages/core/test/fixtures/reader/`
  (numbered arXiv, unnumbered ACL, two-column IEEE, author-year). Cover
  outline titles/pages, entry splitting, ranges, superscripts, `et al.`,
  semicolon lists, false positives, similarity-scorer thresholds.
- **Web**: `reference-lookup.test.ts` with fake sources — order, cache,
  `inLibrary`. Adapters with recorded JSON under `test/`.
- **E2E** (`apps/web/e2e/reader.spec.ts`): open fixture PDF → click `[1]` →
  popover title → `Read later` → paper in library with `to_read`.
- **Manual**: desktop app over CDP on a two-column paper and an author-year
  paper; dark mode.

---

## 9. Commits

1. `feat(reader): detect section outline from text layer` — §5 + sidebar wiring.
2. `feat(reader): parse reference list and in-text citations` — §6a–c.
3. `feat(papers): bibliographic metadata via Semantic Scholar and OpenAlex` — §6d adapters + ref kind.
4. `feat(reader): reference lookup service with cache` — §6d service.
5. `feat(reader): citation overlay and reference popover` — §4, §6e–f.
6. `feat(reader): references sidebar tab and figure links`.
7. `docs: reader references` — update `docs/building/architecture-map.md`; move this file to `docs/plans/completed/`.

Open question for the PR, not a blocker: should `Read later` also create the
`cites` relation automatically? Leaning yes, behind the same toggle as
`Link papers`.

---

## 10. Lessons from the Scholar extension

Read from the installed Google Scholar PDF Reader v0.5.2 (MV3; `analyzer_worker_bin.js`
+ `reader-compiled.js`, Closure-compiled). Everything the plan needs — outline,
references, in-text citations, figure/table links — runs **locally in a Web
Worker**. The server is used only for AI key points (`scholar_kp`), Scholar
record lookup (`scholar?q=info:<hash>`), library save (`citations?update_op=library_add`)
and telemetry (`scholar_rdl?ctrs=`). Confirms the pure-parser approach.

| Extension behaviour | Adopt in weaveforge |
|---|---|
| Analysis in a Worker; UI thread only receives protos (`Reference {pageIndex, text, number, boxes}`, `InTextCitation {boxes, text, refIndexes}`) | Same split. Run `outlineFromText` / `parseReferenceList` / `findCitationMentions` in a Worker (`apps/web/src/features/reader/infrastructure/analysis.worker.ts`); post plain JSON matching §6 types. Skip Worker only if analysis stays < 50 ms on a 30-page paper. |
| SHA-256 of concatenated page text → cache key for outline/refs/keypoints | Use the same hash (first 16 bytes hex) as the IndexedDB key for parsed refs + resolved lookups instead of `(paperId, refIndex)`; survives re-import of same PDF. |
| Skips analysis when text < 300 chars or < 200 words (scanned PDFs) | Same guard; show "No text layer" instead of an empty References tab. |
| Two-pass line grouping (y-tolerance 0.75 then 0.5) | §5 step 5c. |
| Running heads removed by Levenshtein match at 20 % of min length across pages | §5 step 5. |
| 6 % page-margin crop; JSTOR/T&F/HeinOnline boilerplate filters; dotted-leader lines dropped | §5 step 5b. Only the margin crop + leader rule for v1. |
| Outline validity: ≥ 3 sections, gap ≤ 50 % of pages; multi-article PDFs (≥ 3 top headings covering ≥ 70 % of pages) treated as separate | §5 step 7. Skip multi-article. |
| Citation style detected by **counting**: for every `[`/`(` token followed by a number or author, tally whether the number sits at offset 0 (`[12]`) or 1 (`(Smith 2020)`); pick the offset with count > max(2, tokens/5). Dominant separator (`,` `;`) chosen by frequency. Bracketed styles get 3× confidence. | §6b: replace the fixed regex-first order with the same tally. Decide once per document, then match with the chosen style; fall back to author-year only when numeric count fails. |
| Reference list found from the `References` heading; **fallback** scans the last third of pages (clamped 2–20 pages) bottom-up for blocks ≥ 200 chars starting with `[n]`/`n.` in descending sequence; abort if > ⅓ of scanned blocks are non-references | §6a: add this fallback; today the plan assumes the heading exists. |
| Reference number parsing: `^[\[\(] *([1-9][0-9]?) *[\)\]]` and `^([1-9]\p{Number}*)[ .-](?:\s|\p{Lu})` (number must be followed by space/dot/dash then a capital) | Use both; the second avoids splitting on years/page numbers. |
| Figure/table/equation/section mentions matched via a multilingual trigger-word trie (`fig`, `figs.`, `table`, `eq.`, `§`, `appendix` …, ~40 languages) then number/letter (`3`, `3a`, `S2`, `IV`); target = caption block whose label matches | §6 `find-figure-mentions.ts`: English + `§`/`Fig`/`Tab`/`Eq` only; caption = block starting with `^(Figure|Fig\.|Table|Algorithm)\s+\d+` at ≥ body size, keyed by label. |
| Reconciles its own links with the PDF's existing link annotations (`Sp`): if the PDF already has a `/Link` at the same box, keep the PDF's destination | Read `page.getAnnotations()` for `Link` subtype with `dest`; skip overlay where one exists (pdf.js already renders it). |
| Superscript citations detected from font-size ratio and baseline offset | Already in §6b (≤ 0.75 × body). |
| Reference popover: fetch is one Scholar call per click, results cached; shows title, authors, year, venue, "cited by N", Save/Cite buttons | Matches §4. Our chain: DOI/arXiv → S2 match → OpenAlex; Scholar only as outbound link. |
| No LLM in the extension itself; AI outline is server key points keyed by URL/hash | §7 stays optional; if built, cache by the same text hash. |

Not adopted: protobuf message layer, 40-language trigger lists, publisher
boilerplate lists, multi-article splitting, telemetry.

