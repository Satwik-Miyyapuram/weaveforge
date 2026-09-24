# End-to-end pass — plan and log

Started 2026-09-24. This file is the plan, and it is updated as each phase
lands.

## Phases

| # | Phase | Output |
|---|---|---|
| 1 | Inconsistencies: naming, copy, and duplicated or contradictory behaviour across surfaces | Fixes plus a list below |
| 2 | Design, usability, workflow and intuitiveness review at desktop (1426×838) and phone (375×812) widths, run in the installed app | `docs/internal/reports/design-usability-2026-09.md` with screenshots, findings and what to change; the top fixes applied |
| 3 | Code review and fix pass: reliability, robustness, speed, consistency, non-breaking changes, faithful error messages | Fixes and tests, logged below |
| 4 | "Report this" wherever an error is shown, not only on crash screens, and working in the desktop build | A shared report action |
| 5 | Docs cleanup: data lives on OCI (Postgres + PostgREST + Realtime + MinIO behind Caddy at `api.weaveforge.org`); Supabase is sign-in only | Docs rewritten |
| 6 | Open-access fetching from every major OA source, plus HTML papers (a paper whose free copy is a web page) | Resolver chain, HTML store and reader, and tests |

## Design decisions made up front

- **Reports from the desktop build.** The packaged app has no Next server, so
  `/api/report-issue` answers 404. The shared action tries the server route
  first. When there is no server, or it is not configured, it opens a
  prefilled `github.com/<repo>/issues/new` in the browser. That needs no token,
  and the reader still sees and edits the report before sending it.
- **Open-access sources.** The order is:
  1. What the paper already has: `openAccessPdf`, `pdfPath`, and the arXiv id.
  2. arXiv.
  3. OpenAlex (`best_oa_location` and `locations[]`).
  4. Unpaywall (`best_oa_location`).
  5. Semantic Scholar (`openAccessPdf`).
  6. Europe PMC (PMCID → PMC PDF / full-text HTML).
  7. The bioRxiv/medRxiv API.
  8. DOAJ.
  9. Zenodo.
  10. HAL.

  All are keyless, and all answer CORS, so they work from both builds. CORE
  needs a key, so it is left out. Each candidate is `{url, format: "pdf" | "html",
  source, license?, version?}`, deduplicated by URL. PDFs are tried first.
- **Fetching a discovered PDF.**
  - **Desktop:** the shell proxy fetches any https host that an OA index named
    (the same path as a typed address, still PDF-only by magic bytes).
  - **Web:** the server proxy stays allowlisted (SSRF). Hosts outside the list
    are tried directly, which works when they send CORS headers.
- **HTML papers.**
  - **Storage:** the page is fetched, stripped to a safe subset by an allowlist
    sanitizer (no scripts, handlers, forms or frames; `javascript:` URLs
    dropped), and stored:
    - desktop: in the workspace folder at `papers/html/<id>.html`;
    - web: in IndexedDB.
  - **Rendering:** a `sandbox` iframe with no script permission, under a
    `default-src 'none'` CSP. That is two independent walls.
  - **Search:** its text is indexed like PDF text.

## Log

### Phases 1, 2 and 4 — inconsistencies, design review, "Report this"

Done together, because most inconsistencies were found while walking the
screens. Every fix, and what is still recommended, is in
[`design-usability-2026-09.md`](../../internal/reports/design-usability-2026-09.md).

- **Report this:** `components/report-error-button.tsx` is the shared action,
  used by every error surface, not only the crash screens.
  `lib/error-report/issue-url.ts` builds a prefilled GitHub new-issue link for
  when there is no report endpoint (the desktop build, or a web deployment
  without a GitHub token). `lib/error-report/app-log.ts` feeds the report's
  recent-log section. Nothing is posted until the reader presses Submit on
  GitHub, or Send in the web app.

### Phase 5 — docs: data on OCI, Supabase for sign-in only

- **Rewritten:**
  - the root README, CONTRIBUTING, SECURITY and PR template;
  - `docs/README.md` and `docs/SECURITY.md`;
  - `building/*`, `running/*` (backend, storage, Postgres provider, R2 setup,
    tiering) and `using/*`;
  - the three `supabase/**/README.md` files and `python/README.md`.

  They say that data lives in Postgres, PostgREST, Realtime and MinIO on the
  OCI VM behind Caddy, and that Supabase issues sign-in tokens only.
- **Later sweep:** the internal strategy and future-work docs (backlog, billing
  plan, deep-research brief, self-host roadmap, metrics plan) no longer say
  Supabase stores data. `supabase db push` became `npm run migrate:schema`
  (`scripts/apply-migrations-oci.mjs`).
- **Kept as history:** `plans/completed/*`, the CHANGELOG and
  `running/oracle-shift.md`, which describes the move itself.

### Phase 3 — code review and fixes

- **Faithful errors:**
  - Three error messages told the reader to run `supabase db push`, which no
    longer applies anything: `format-error.ts` (twice) and `org-api.ts`. They
    now name `npm run migrate:schema`, and the tests follow.
  - The paper pane said "HTML landing pages are skipped", which is no longer
    true. It now offers "Find a free copy".
- **Robustness:** the desktop HTML relay read the whole body before checking
  its size, and a missing or wrong `content-length` let an oversized page
  through to memory. Both relays now share `readCapped` from
  `paper-html-rules.ts`, which enforces the cap while reading.
- **Consistency:** removing a kept web page also removes its search text, so
  search does not keep finding a paper that has no text any more.

### Phase 6 — open access and HTML papers

- **Core:** `features/papers/application/open-access.ts` asks OpenAlex,
  Unpaywall (when `NEXT_PUBLIC_UNPAYWALL_EMAIL` is set), Semantic Scholar,
  Europe PMC, bioRxiv/medRxiv, DOAJ, Zenodo, HAL and arXiv. It merges and ranks
  the answers, reports which indexes it `asked` and which `failed`, and has 11
  tests. `workspace/folder-layout.ts` gains `papers/html/<id>.html`.
- **Relays:** desktop `html-proxy.ts` (any https host, final URL rechecked) and
  web `/api/html-proxy`. The web relay is signed-in only, allowlisted, checks
  every redirect hop, has one 45 s deadline and a 15 MiB cap. The allowlist
  gains HAL and Zenodo.
- **Reader:**
  - `find-free-copy.ts` is a pure orchestrator. It tries PDFs first (at most
    6), then pages (at most 4). A page with fewer than 5,000 characters of text
    is an abstract and is passed over.
  - Every failure has its own message. "No index lists a copy", "the indexes
    could not be reached" and "found, but the host refused" are different
    messages, and each names the hosts and indexes involved.
  - `sanitize-paper-html.ts` uses DOMPurify with no scripts, forms, frames or
    styles, makes URLs absolute and opens links in a new tab.
  - `paper-html-store.ts` keeps pages in the workspace folder or IndexedDB, and
    sanitizes them again when read back.
  - `PaperHtmlView` shows a page in an iframe with no script permission, under
    a `default-src 'none'` CSP.
  - The paper pane shows a kept page when there is no PDF. "Find a free copy"
    sits next to "Load PDF…".
- **Search:** a kept page's text is indexed as one page of the paper, both when
  the page is found and when the library is indexed.
- **Tests:**
  - `paper-html.test.ts` (5) and `find-free-copy.test.ts` (8);
  - `html-proxy.test.ts` (desktop, 5) and `api/html-proxy/test/route.test.ts`
    (web, now 7 with the any-host relay and the sign-in gate).
  - The sanitizer needs a DOM, and the test runner has none, so it was checked
    in the installed desktop build over CDP instead. A hostile page (inline and
    SVG scripts, `onclick`/`onerror`, a `javascript:` link, an iframe, a form,
    a `<style>`, nav and footer) came out with none of them. Relative links and
    images were made absolute, and the title came from `citation_title`.
  - Checked in the installed build: the desktop relay (`200` for arXiv HTML,
    `400` for `http:`, `415` for a PDF), and the no-identifier message on
    papers without a DOI. No library paper has a DOI but no PDF, so the full
    "find, keep, show" path was not run against live data.

### Phase 7 — papers that are web pages

- **Metadata:** `url-meta` reads schema.org JSON-LD (`Article`, `BlogPosting`,
  `ScholarlyArticle`) as well as citation tags and OpenGraph, so a research
  blog post or an essay imports with its title, author and date.
  `pageImportRefusal` refuses a page with neither citation tags nor an article
  marker, with no title, or behind a bot wall, instead of storing a
  placeholder title.
- **Relay:** `/api/html-proxy` keeps the allowlisted path for the open-access
  hosts and adds `proxyAnyHtml` for any other http(s) page. That path goes
  through `safeFetch` (private and link-local addresses refused at every hop)
  with a per-user budget (`pageFetchLimiter`), the same 15 MiB cap and the
  same deadline.
- **Reader:** a paper that is a web article opens its own page when there is
  no PDF, instead of waiting for "Find a free copy".

### Follow-up — the recommended changes from the design report

- **Dashboard holes (M1):** a saved layout is compacted upward on load
  (`closeLayoutGaps`), keeping its order.
- **Placeholder titles and duplicates already stored (M2, M3):** a notice on
  Papers ("Older imports left N titles to fix and M possible duplicates")
  opens "Tidy the library".
  - Core `library-tidy.ts` proposes titles (a reference-manager file name is
    read back into a title; a placeholder with a DOI or arXiv id is looked up;
    Zotero's " 1" copy number is dropped only when the unnumbered title is
    another paper's) and groups duplicates by DOI, arXiv id and normalised
    title. A title match never joins two papers with different DOIs.
  - Nothing is written until the reader applies a title or merges a group.
    `MergePapersUseCase` moves annotations (with their pins and quotation
    types), list memberships, missing field values and relations to the kept
    copy, unions tags and metadata, then deletes the duplicate's row. A copy
    linked to Zotero is refused as the one that goes. Notes link by title and
    need nothing.
  - Checked read-only in the installed build: 7 titles and 2 groups found on
    the live library; nothing was applied or merged.
- **Rail (M4):** labelled above 1280px.
- **Needs attention on a phone (M5):** the first three items and "Show all (n)".
- **Lists (L6):** delete moved into the list's ⋯ menu; the view toggles are
  icon buttons with tooltips.
- **Phone tabs (L7):** below 480px the tab strip becomes one switcher (the
  shared `Select`) naming the document on screen.

### Follow-up — better handwriting recognition in the editor

The engine stays Windows `InkAnalyzer`, on the machine: handwriting is not sent
anywhere, which rules out cloud recognisers, and the image OCR model tried
earlier was rejected. What changed is what is done with the engine's output.

- **What was wrong.** The helper reported every line at confidence `1`. In
  `recognisePage` a `1` means "a person corrected this", so engine lines were
  never re-read and never underlined as doubtful. The alternatives it offered
  were the first word's alternates, shown as if they were whole lines.
- **The helper sends evidence** (`Program.cs`, new `SpellCheck.cs`). For each
  word it sends the engine's readings (`RecognizedText`, then
  `TextAlternates`, up to 6). With each reading it sends the verdict of the
  Windows spell checker (`ISpellCheckerFactory`, offline, reached through
  source-generated COM so it survives trimming).
  - It adds two-word splits for a word none of whose readings is a word, where
    both halves are words of 3+ letters ("seedsmatters" → "seeds matters").
  - It adds `join` where a word and the next read as one dictionary word
    ("dr aft" → "draft").
  - `confidence` is still `1`/`0`, and it still means only "produced text".
- **The client decides** (`packages/core/src/ink/decode.ts`, wired in
  `recognisers.ts`).
  - Per word, it keeps a reading that is a workspace term, then a dictionary
    word over a non-word.
  - It takes a split when the word is a non-word. It does not split when the
    word is close to a workspace term, so the title post-match can mend it.
  - It takes a join when either half is in doubt, and otherwise offers it as
    an alternative.
  - Any word left unverified puts the line under the underline threshold.
  - Engine lines are capped at 0.95 in the adapter and in `recognisePage`, so
    `1` is left for corrections.
  - The alternatives are whole lines with one doubtful word swapped, and the
    engine's own text comes first.
- **Measured** with a scripted benchmark (not in the repo): 40 phrases, 3
  levels of messiness and 2 seeds each, so 240 lines, written in a synthetic
  single-stroke hand and run through the real helper with a 20-term vocabulary.

  | | engine + title post-match | decoded + post-match |
  |---|---|---|
  | word error rate | 9.1% | 5.6% |
  | lines exactly right | 185/240 | 201/240 |
  | wrong lines underlined | 0/55 | 18/39 |
  | right lines underlined | 0 | 2 |

  The word error rate went from 6.4% to 4.3% at the lowest messiness and from
  11.3% to 6.4% at the highest. None of the 240 lines got worse.
  - Still wrong: real-word misreads the dictionary accepts ("lor own",
    "(or", "jogger"), and non-words with no good alternative ("garlded").
  - A synthetic hand is not a person's hand. The §5.5 gate on real
    handwriting still stands.

### Test totals at the end of the pass

- core: 1330 pass;
- web: 1735 pass, typecheck and lint clean;
- desktop: 283 pass, 1 skipped.
- `check:boundaries`: the hygiene gate still fails on work outside this pass —
  `apps/desktop/src/main.ts`, `use-page-pointer.ts` and `explorer-panel.tsx`
  over 800 lines, and `ink-polish-log.md` naming the removed
  `packages/core/src/ink/myscript`.
