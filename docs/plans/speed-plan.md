# Speed plan

Handoff plan for making WeaveForge fast and lean on RAM. Written 2026-10-18 on
`fix/page-fade`, after the step 0 baseline. Read all of it before changing code.

## Rules for the agent doing this

- Follow `.agents/README.md`. Read `.agents/testing.md` before building or running
  WeaveForge Dev.
- Test only in **WeaveForge Dev** over CDP port 9223. Never touch the installed
  WeaveForge app or its workspace.
- Stop Dev only by its path:
  `Get-Process | ? { $_.Path -like "$env:LOCALAPPDATA\Programs\WeaveForge Dev\*" } | Stop-Process`.
- **No numbers, no claim.** Every step ends with a baseline run (below). Add the
  before/after rows to the results log at the end of this file.
- Do one step per branch and PR, cut from `main`, in the order below.
  - Commit with `git commit -s` as S.Miyyapuram <pandu.satwik@gmail.com>. Add no
    co-author trailer and no PR footer.
  - Ask the user before you push, open a PR or release.
- Never guess a cause. Profile first: CDP `Profiler` or the LoAF script
  attribution in `baseline.json`.
- Keep source files under 800 lines. `pdf-reader.tsx` is already 2172 lines, so
  put new logic in new files beside it and do not grow it.
- Comments are one line and say why. Say "Notes", never "vault".
- Run before every commit:
  - `npm run typecheck --workspace @weaveforge/web`
  - `npm run test:web` (2173 tests pass today)

## Stack

| Thing | Version | Note |
| --- | --- | --- |
| Next | 14.2, `output: "export"` | No route keep-alive |
| React | 18.3 | No `<Activity>` (needs 19.2), no React Compiler |
| Electron | 33.4.11 (Chromium 130) | Out of support |
| pdfjs-dist | 4.10 | 5.x is current |
| fflate | 0.8, already a dependency | Sync inflate is available |

## Measuring harness (step 0, done)

### Perf marks

The marks are in the working tree on `fix/page-fade` and are **not committed
yet**. Commit them first if the user agrees.

All marks are off unless `localStorage["wf:perf"] === "1"`. The flag is read when
the module loads, so reload after setting it.

| Measure | Where |
| --- | --- |
| `nav:<from>-><to>` | `apps/web/src/app/page-transition.tsx`: anchor click to the paint after the route renders |
| `pdf:page-render`, `pdf:text-layer` (detail = page) | `apps/web/src/features/reader/ui/pdf-reader/use-pdf-rendering.ts` |
| `ink:decode` (detail = bytes) | `apps/web/src/features/ink/ui/use-decoded-strokes.ts` |
| `ink:note-paint` (detail = pages) | Same file: note open to the paint after every page is decoded |

The helpers are in `apps/web/src/lib/perf-marks.ts`.

### Scripts (`scripts/perf/`)

- `cdp.mjs`: a small CDP client. Set `CDP_PORT` to change the port (default 9223).
- `baseline.mjs [out-dir]`: runs three phases and writes `baseline.json` plus two
  screenshots.
  - **Nav:** two rounds of trusted clicks over the 8 visible sidebar links.
  - **PDF:** opens `PERF_PAPER` (a 40-page paper by default), clicks "PDF", then
    scrolls `.pdf-reader-scroll` to the end.
  - **Ink:** opens the note titled `PERF_NOTE` (default "Perf dense ink") in Read
    mode and scrolls it to the end.
  - Every phase records the User Timing measures, Long Animation Frames (with
    script attribution), Event Timing (interactions over 16 ms), JS heap
    (`Performance.getMetrics` after a GC), DOM nodes, and the summed working set
    and private bytes of all Dev processes.
- `gen-dense-ink.mts <workspace> <project-folder>`: writes a 50-page note with
  25,000 strokes (2.1 MB of chunks).

### Setting up Dev data (once per workspace)

1. Run the generator against the **Dev** workspace:
   ```
   node --import tsx scripts/perf/gen-dense-ink.mts <dev-workspace> <project-folder>
   ```
   It prints the note id.
2. The app does not pick up files written from outside. Import the note in Dev:
   **Settings → Editor and writing → Workspace → Check for changes → Import**.
3. The import gives the note a **new id**. Read `weaveforge-id` from the imported
   `notes/perf-dense-ink.ink.md`, then copy `.ink/<generated id>/` to
   `.ink/<new id>/`. The page order is kept.
4. Check that it worked: open the note. It should show 25,022 `svg path` and 50
   `ink:decode` measures.
5. For the PDF phase, use a paper with a PDF in Dev, and set `PERF_PAPER` if the
   default id is missing. There is no 50-page paper in Dev today; the largest has
   40 pages.

### Run

```
node scripts/perf/baseline.mjs <out-dir>
```

It takes about 3 minutes. Put `<out-dir>` outside the repo, in a scratch folder.

## Baseline (2026-10-18, Dev build of `fix/page-fade`, 2160×1350)

### Memory

| Point | JS heap | DOM nodes | Working set (5 procs) | Private |
| --- | --- | --- | --- | --- |
| Idle on dashboard | 7.0 MB | 344 | 627 MB | 723 MB |
| After 2 nav rounds | 14.6 MB | 2,829 | 774 MB | 887 MB |
| PDF open | 34.6 MB | 1,286 | 967 MB | 1,091 MB |
| PDF scrolled to end (40 pages) | 43.9 MB | 19,676 | 1,266 MB | 1,281 MB |
| Ink note open (50 dense pages) | 124.4 MB | 25,675 | 1,202 MB | 1,240 MB |
| Ink note scrolled to end | 124.4 MB | 25,675 | 1,188 MB | 1,313 MB |

### Timing (ms)

| Metric | n | p50 | p95 | max |
| --- | --- | --- | --- | --- |
| `nav:*` | 16 | 79.5 | 151.2 | 151.2 |
| Nav: LoAF duration | 19 | 76 | 167 | 167 |
| Nav: interaction duration | 48 | 48 | 72 | 72 |
| `pdf:page-render` | 40 | 24.9 | 544.3 | 1910.3 |
| `pdf:text-layer` | 40 | 21.7 | 680.5 | 1755.1 |
| PDF: LoAF duration | 24 | 141 | 468 | 1665 |
| `ink:note-paint` | 1 | 1960.5 | n/a | 1960.5 |
| `ink:decode` (see the caveat below) | 50 | 70 | 100 | 103.2 |
| Ink: LoAF duration | 5 | 162 | 1837 | 1837 |

LoAF frames over 50 ms: 18 in nav, 23 in PDF, 5 in ink.

### What the numbers say

1. **Ink Read mode is the worst offender.**
   - Opening the note blocks the main thread for 1.8 s and then 1.2 s.
   - The LoAF attribution is the React scheduler (`MessagePort.onmessage`)
     rendering 25,022 SVG `<path>` nodes from `ink-strokes.tsx`.
   - The JS heap grows by 80 MB, and all 50 pages render at once.
2. **The PDF keeps everything.** After the scroll:
   - All 40 canvases are still alive, holding 124 MB of backing store.
   - The DOM has 19.7k nodes from text layers.
   - The working set grew 299 MB during one scroll.
3. **The PDF has a 1.6 s main-thread block.** It is inside the pdf.js chunk's
   `Worker.onmessage`. The cause is **unknown**: profile it before you fix it.
   `pdf:page-render` and `pdf:text-layer` have p95 above 500 ms.
4. **Nav is acceptable but not fast.**
   - p50 is 80 ms, and frames are long on every switch.
   - The cost is React render work (`MessagePort.onmessage`). Which components
     are expensive is **unknown**; profile first.
5. **Idle cost is 627 MB working set across 5 processes.** That is Electron's base
   cost plus the app.

### Caveat: `ink:decode` is misleading

`useDecodedStrokes` starts all 50 decodes at once (`Promise.all`), so each
measure includes time spent waiting in the queue. Fix the measure in step 1
before you trust it.

## Plan

Do the steps in order. Each step lists its files, its change, and its target.
Targets are checked with `baseline.mjs` in Dev.

### Step 1: Honest ink measures (small)

- `use-decoded-strokes.ts`: split the work into two measures.
  - `ink:inflate` covers only the codec decompress.
  - `ink:parse` covers `pageFromChunk`.
- To get clean numbers, decode one page at a time in a test run (or measure the
  synchronous parts only).
- Extend `baseline.mjs`:
  - Open the Plan/Report sidebar groups so their routes join the nav phase.
  - Add an Ink-mode phase: click "Ink", then flip pages.
- **Done when:** the new measures appear in `baseline.json` with realistic
  per-page costs.

### Step 2: Ink Read mode, render only what is near the viewport

This is likely the biggest win; the baseline points here first.

- **Files:**
  - `apps/web/src/features/ink/ui/ink-page-ink.tsx`
  - `ink-strokes.tsx`
  - `ink-reader.tsx` / `ink-page-static.tsx`
  - `use-decoded-strokes.ts`
- **Virtualise.** Mount stroke content only for pages within about ±2 of the
  viewport. Use an IntersectionObserver with a `rootMargin`, the same pattern as
  `pdf-reader.tsx:1121`. Pages outside the band keep a sized placeholder so the
  scroll height does not change.
- **Draw static pages to one canvas each, not one `<path>` per stroke.** Use a
  `Path2D` per stroke and draw at device pixel ratio. Keep the stroke styling
  identical to `InkStrokes`: round caps, and the order pen first, then
  highlighter.
  - Keep SVG `InkStrokes` for export and for `annotation-overlay.tsx` /
    `pdf-reader/overlays.tsx`, which are small.
  - The WebGL renderer (`features/ink/render/webgl-renderer.ts`) is an option. Compare the two
    before you choose.
- **Decode lazily.** Decode the pages in the band first, then the rest at idle
  time or on approach, not all 50 at once.
  - Measure `fflate.inflateSync` against `DecompressionStream` on the real
    chunks.
  - Consider decoding in the ink worker (`ink-page-logic.ts:103` already
    decodes there).
- Add ink:page-paint, first visible page decoded to painted, once band-first decode exists.
- **Targets:**
  - No LoAF over 50 ms when the note opens.
  - First visible page painted in under 100 ms.
  - Heap growth for the note under 30 MB.
  - DOM nodes for the note under 2k.
- **Visual check:** compare screenshots of a page before and after at 100% and
  200% zoom. The strokes must match.

### Step 3: PDF memory and the 1.6 s block

- **Files:**
  - `apps/web/src/features/reader/ui/pdf-reader/use-pdf-rendering.ts`
  - The IntersectionObserver in `pdf-reader.tsx:1121-1142`, which has a 600 px
    pre-render band
  - New helper files beside them
- **Profile first.** Record a CDP `Profiler` trace during the PDF scroll. Name
  what runs inside the 1.6 s `Worker.onmessage` frame, then fix that. Do not
  assume it is the text layer.
- **Evict far pages.** For pages more than about ±3 from the viewport:
  - Release the canvas (`width = height = 0`).
  - Remove the text-layer DOM.
  - Cancel in-flight render and text tasks. Re-render on approach; the observer
    already triggers this.
- **Reuse one scratch canvas** per reader instead of creating one on every
  render (`use-pdf-rendering.ts:514`).
- **Defer the text layer.** Build it with `scheduler.postTask({ priority:
  "background" })` (Chromium 130 has it), or with `requestIdleCallback`. A fast
  scroll should not build layers for pages it skips past.
- Keep search, selection and annotation anchoring working on pages that were
  evicted and then rebuilt. Check this by hand in Dev and with the reader tests.
- **Targets:**
  - Canvas backing at the end of the scroll ≤ 30 MB (it is 124 MB today).
  - Working-set growth over the scroll < 100 MB (it is 299 MB today).
  - DOM at the end < 5k (it is 19.7k today).
  - No LoAF over 100 ms during the scroll.
  - `pdf:page-render` p95 < 150 ms.

### Step 4: Faster tab switches

- **`apps/web/src/lib/view-transition.ts:52` (`routeSettled`):**
  - Resolve inside the MutationObserver callback once `location.href !== before`.
  - Drop the 16 ms polling tick and keep the timeout fallback.
  - Add a unit test.
- **Profile each slow route.** The baseline shows `/workspace/` → `/papers/` at
  120–151 ms and `/notes/` → `/graph/` at 112–128 ms. Use the CDP Profiler,
  find the expensive components, and fix them with memo, lazy loading or
  deferred work.
- **Targets:**
  - `nav:*` p95 < 100 ms.
  - Nav LoAF max < 100 ms.
  - Interaction duration p95 < 50 ms.

### Step 5: Platform upgrades (own branch, biggest effort)

1. **Electron 33 → the current supported major.** Read the breaking changes for
   each major in between. Run `npm run test:desktop` and the Dev build. A release
   needs the user's go-ahead.
2. **React 18 → 19.2 and Next 14 → 15/16.** Turn on the React Compiler. Run the
   full test suite and the Dev build.
3. **Only then, keep recent screens alive.** Use `<Activity mode="hidden">` for at
   most 3 recent routes (LRU):
   - It keeps state and DOM.
   - It unmounts effects, which stops timers and subscriptions.
   - `key={pathname}` in `page-transition.tsx` must go.

   First check whether Next's own Activity-based route keep-alive works under
   `output: "export"`.
4. **pdf.js 4.10 → 5.x.** Re-run the baseline afterwards.
5. **Targets:**
   - Idle working set below 627 MB.
   - A warm tab switch paints on the next frame, with no LoAF over 16 ms.

## Do not do

These come from the Gemini plan and are dropped:

- **VRAM texture ring for the PDF:** the compositor already does this.
- **A multi-page VBO for ink:** it is not the bottleneck; SVG is.
- **In-memory SQLite/DuckDB:** it costs RAM.
- **`content-visibility: hidden` keep-alive:** it keeps effects running.
- **`ctx.transferFromImageBitmap` on a 2D context:** it does not exist there.
- **"Sub-ms" targets:** the real bar is the next frame, with no LoAF over 50 ms.

## Acceptance (all from `baseline.mjs`)

| Check | Baseline | Target |
| --- | --- | --- |
| Ink note open: worst LoAF | 1837 ms | < 50 ms |
| Ink note open: heap growth | +80 MB | < +30 MB |
| PDF 40 pages scrolled: working-set growth | +299 MB | < 100 MB |
| PDF scrolled: canvas backing | 124 MB | ≤ 30 MB |
| PDF: worst LoAF | 1665 ms | < 100 ms |
| Nav p95 | 151 ms | < 100 ms |
| Warm nav (after step 5) | n/a | Next frame |
| Idle working set | 627 MB | Below baseline |

## Results log

Add one row per step: step, commit, and the key metrics before and after.

| Step | Commit | Change in numbers |
| --- | --- | --- |
| 0 | 11e37355 | Baseline above |
| 1 | c7d9d74e | Decode is cheap. On the 50-page note, `ink:inflate` totals 15.6 ms and `ink:parse` 82.9 ms (p95 2.6 ms per page), but `ink:note-paint` is 2039 ms and the open has a 1827 ms blocking LoAF, so rendering 25k SVG paths is the cost. Ink mode is worst: page-flip INP has p50 1528 ms and max 3128 ms, LoAF p50 2645 ms, and all 50 pages re-inflate on entering it (n=52). Plan and Report nav are 68–88 ms. |
| 2 | 2b05b755 | Ink drawn to one canvas per page, only near the viewport; decode cache shared across modes. Read mode: `ink:note-paint` 2039 → 142 ms, `ink:page-paint` p50 23 ms (max 32), worst LoAF 1927 → 150 ms, DOM 25.7k → 624 nodes, SVG paths 25k → 22, JS heap 88 → 57 MB. Ink mode: flip INP p50 1528 → 72 ms, max 3128 → 128 ms; LoAF p50 2645 → 83 ms; DOM 26.3k → 1.25k; heap 120 → 61 MB; private 1578 → 1102 MB. Screenshots match step 1. Flips still exceed 50 ms LoAF (60 of 60): next steps. |
| 3 | a08c9e80 | PDF pages render only within one viewport and are freed beyond 3 pages; first paint goes straight to the page canvas; text layer, link measuring, outline and search index wait for idle. 40-page scroll: canvas memory 123.9 → 15.5 MB, DOM 19.7k → 4.0k nodes, `pdf:page-render` p95 580 → 211 ms (max 1919 → 349), `pdf:text-layer` p95 800 → 135 ms, worst LoAF 1809 → 288 ms, working set growth +360 → +229 MB, scroll 10.2 → 7.4 s. Missed: 5 LoAFs over 100 ms (render and layout, no script), page-render p95 over 150 ms, working set over +100 MB. Next suspects: `measureLinkTextRanges` getBoundingClientRect (384 ms), MiniSearch tokenize in `indexPdf` (223 ms). |
| 3b | pending | URL tokenizer splits on whitespace before its regex (same tokens), PDF index added in 4-page slices between idle yields (same index), `contain: strict` on the text layer and link-measure shell, page proxies cleaned up on evict, link queue freed as measured. 40-page scroll vs step 3: worst LoAF 288 → 190 ms, LoAFs over 50 ms 25 → 19 and over 100 ms 5 → 4, `pdf:text-layer` p95 135 → 112 ms, `pdf:index` 111 ms in slices (was one 360 ms task), `pdf:measure-links` 28 pages, max 68 ms. JS heap at end 43.9 → 38.5 MB, working set growth +229 → +212 MB. Quality: 493 links on 40 pages and every text span identical to the rect at 0.01 px with containment off, last-page screenshot identical, search finds PDF text by page. Missed: page-render p95 still 209 ms, 4 LoAFs over 100 ms (scroll: layout and accessibility updates, not script), working set over +100 MB. |
