# Ink polish log: what OneNote-quality ink took, and where each fix lives

A running record of the rendering and capture fixes made while testing the
desktop build against a real Surface Pen and a mouse, with the reference
engines each decision was checked against. Section numbers refer to
`ink-notes-plan.md`.

## 1. What the reference engines do

| Engine | Live path | On lift | Width |
| --- | --- | --- | --- |
| **OneNote (Windows)** | OS ink trail (DirectInk) drawn by the compositor ahead of the app; app draws the "dry" stroke a frame later | Bézier refit of the whole stroke; per-sample wobble gone | Pressure scales width mildly (≈ ±30 %); no speed thinning on the pen tool |
| **google/ink-stroke-modeler** (Jamboard, Chrome Canvas) | Position modelled as a mass on a spring toward the raw sample; predicts a few ms ahead; resamples the model at fixed Δt | The last modelled samples are flushed with the pen-up | Width from pressure through a "stylus state modeler", separately smoothed |
| **Rnote** (GTK, Rust) | Catmull-Rom through the samples, rendered by piet; pressure per point | Douglas-Peucker simplify, then a spline | Pressure width; width smoothing via a moving average |
| **Xournal++** | Straight segments drawn live, then "stroke recognizer" and a Bézier smoothing pass on lift | Bézier fit | Pressure width, per segment |
| **Saber** (Flutter) | `perfect-freehand`: a polygon outline from the samples, not a centre-line — fixed thinning and streamline settings | Outline recomputed once | Pressure and speed thinning (`thinning`), configurable; ends tapered |

The common shape: a **causal, low-lag filter live** (1-Euro here; a spring
model in Google's), a **non-causal refit on lift** (binomial kernel over an
even resample here; Bézier in OneNote and Xournal++), and **width from pressure
with a modest swing**. Our pipeline matches that shape; the differences below
were tuning, not architecture.

## 2. Fixes, in order, with the symptom each cured

| Commit | Symptom | Cause | Fix |
| --- | --- | --- | --- |
| `7c9bdff` | A circle drawn with the mouse came out as a polygon | Hermite tangents read from a single neighbour; corner fade too eager | Chord-sum tangent direction, own-span magnitude, corner fade 60°→90°, three subdivisions per span |
| `a603f95` / `1ff3f1c` | Holes at bends; square caps | Adjacent capsule quads both discarded the join, and the quad did not extend past the end | Nearest-capsule tie-break; quad extended by the radius at both ends |
| `403db6b` | White pinholes along a stroke; a pale 2-px border | Per-quad `vPage` differed by an ulp, so the tie-break discarded in *both* quads; the AA ramp was a pixel each side | `flat` varyings and a 0.01-unit epsilon; ramp halved (`fw *= 0.5`) |
| `403db6b` | Toolbar swatches did not match the ink; dark mode drew on a white canvas | Palette hard-coded to the light theme; canvas cleared opaque white | Canvas transparent and premultiplied so the CSS paper shows; the host reads `--text`, `--accent`, `--s-*` from the theme and posts them to the worker (`ink-palette.ts`) |
| `403db6b` | Lasso invisible while drawn; selection not shown; eraser had no cursor; no finger pan or pinch | Nothing drew them | SVG overlay in page units (`.ink-overlay`, `.ink-lasso`, `.ink-selection`); ring cursor for the eraser; one finger pans when touch does not draw, two fingers always pinch |
| `4149003` | A light, fast stroke ended in a dot wider than itself; blobs at corners | Windows sends `pointerup` with pressure 0, which the filter read as "no channel" and the renderer as full base width; a 0.55–1.45 pressure swing and 35 % speed thinning made the rest of the stroke thin | The lift tapers from the last pressure (`NibFilter`); swing 0.7–1.3; speed taper 20 %, read from core |
| `2d8b032` | The last few millimetres of a fast stroke vanished on lift | The predicted samples were dropped, not flushed, at pen-up | The prediction is flushed into the stroke before the refit |
| `cc7f1a3` | Two colours where one highlighter overlapped itself; "dual colour" on every fold | Each capsule blended separately, so a self-overlap doubled the alpha | Per-stroke stencil (`GREATER k` / `REPLACE`) draws each highlighter once as a union; only different strokes add. The context probe runs on a scratch canvas so the real one keeps its first context |
| `d505eb9` | Recognised text repeated three times | The .NET helper added the line's text once per stroke it owned | Owners collected from `GetStrokeIds()`, text added once per owner |
| `f8ed108` | The page went blank past a certain zoom | The whole-page backing store (CSS size × dpr) outgrew what the GPU would allocate | `backingRatio()` lowers the effective dpr so the store stays ≤ 20 M px and ≤ 8192 per side; the same ratio goes into the view transform |
| `ef4e38e` | Lasso: selected strokes not shown as selected; strokes stayed put while the box moved | Nothing drew the selection; only pointer-up translated it | Accent halo (capsules grown by 3 device px at 30 %, stencil-deduped) under the selected strokes; `drag-selection` shows the held strokes shifted with the box, `move-selection` on lift commits |
| `863852e` | Recognise gave "(unreadable)" at 0 % for a line holding a "1" or a dash | `InkAnalyzer` classed a two-point stroke (a straight line simplified to its ends) as a drawing, and the line it sat in came back empty | Every stroke is marked `InkAnalysisStrokeKind.Writing` before analysis: the note asked for text |
| `4bbc681` | "Insert PDF page" did nothing on the second try, and sometimes the first | pdf.js detaches the `ArrayBuffer` it is handed, so the cached bytes were empty on the next call | Each `getDocument` gets a copy of the bytes |
| `0ec436e` | Panning at zoom blanked the strokes for a moment, then they came back | The canvas was page-sized in CSS pixels; at 4× the compositor re-tiled it on every scroll and the tiles lagged | The canvas is a sticky window the size of the scroller, the sheet is what scrolls; the camera offset follows the scroll (one message per scroll, no re-raster) |
| `0ec436e` | Inserted pages came in at the PDF's own aspect, so printing would scale | Page size was taken from the source | Every inserted page is placed on a white A4 sheet, fit and centred; images insert the same way |
| `88fc7e3` | A paper in the workspace had no way to show its PDF; the reader route duplicated the shell | The reader was one screen, not a component | `PaperPdfPane` is the reader's paper half; a paper tab has a third mode, PDF, and a "Load PDF…" button writes the user's own file into the workspace byte cache |
| `0876071` | Adding a paper offline failed: `malformed array literal: "[]"` | Every array was JSON-encoded, wrong for `text[]` columns | Array columns are named per table and encoded as `{"a","b"}`; jsonb arrays stay JSON |
| `3a68c43` | A page could not hold a picture: no way to add one, and no way to make a page out of one | The background was drawn by the renderer but nothing wrote it — the text layer and the chunk had no field for it, and the chunk was only ever built by a worker that did not hold the page being changed | The page's background is an attachment on line 1 of its text layer (`![page background](vault:…)`) plus an index in the chunk; the host re-encodes the chunk on the main thread (`pageChunkWithBackground`) because the target page may not be in the worker; the codec moves to `application/ink-chunk-codec.ts` so both sides agree on the bytes. Add, `Ctrl+V`, drop, and "insert page from file" — the last asking replace-or-new-page when the page already has one |
| `3a68c43` | A background index read from the wrong byte, and page 2 of a two-image note written as 1 | The chunk body starts at byte 16, so `bytes[21]` is a header byte; and the index was assumed to be per page | Decode to read it. The index is the page's *place among the note's image refs* — page 1 is 1, page 2 is 2 — which is what the renderer resolves against |
| `3a68c43` | Inserting a PDF or image a second time did nothing | pdf.js detaches the `ArrayBuffer` it is given, so the cached bytes were empty on the next call | Each `getDocument` gets a copy (same fix as `4bbc681`, applied to the page path) |
| `449d83d` | A screenshot button, and one export button that always made a PNG | — | The screenshot button is gone (the OS does this) and the export button is a menu: the print dialog, which is also "save as PDF"; a full-page PNG at 2× (4200×5940, ~508 dpi on A4); and a vector SVG whose strokes stay geometry and whose background is embedded as a data URL |
| `449d83d` | The print/export menu opened off the left edge of the pane, invisible and unclickable | The bar wraps, so the button sits at the left end of a row on a narrow pane, and `right: 0` hung the 200 px list past the edge — where `.ink-wrap { overflow: hidden }` clipped it. Visible to a query engine, so only a real pointer finds it | Measured on open and clamped to the bar's own box (`--ink-menu-shift`), before paint |
| `449d83d` | Print and PNG did nothing at all in a worker with no renderer, for the rest of the session | `state.renderer?.capture()` short-circuits to silence, so the promise behind the button never settled; the failure path also swallowed its reason | `export-page` always answers, and logs why when a capture fails |
| `39bd398` | Both image questions were the OS's: `window.confirm` for replace-or-new-page, `window.prompt` for which page of a PDF | A system dialog ignores the theme and, on a phone, covers the page it is asking about — `check:ui` had been failing on exactly this | The app's `ConfirmDialog` for the replace question (with "Add to a new page" as its second answer, so the destructive side is the one that needs the deliberate press) and a new `PromptDialog` for the page number, validated against the PDF's own count |
| `39bd398` | "Add to a new page" saved the image and never showed it: the new page drew blank and its bar offered to add an image it already had | The upload's awaits outlive the render that started them, so the `pageIndex` the callback closed over was stale and the "is this the page on screen" comparison came out false — the worker was never told and `backgroundPath` was never set | A `pageIndexRef` answers that question live, in both the add and the remove path. The harness proves it from pixels: the picture's blue on the new page's sheet, and the bar saying "Change page image" |

## 3. How it was verified without a hand on the pen

The unpacked build runs with `--remote-debugging-port=9222`; a CDP script
dispatches synthetic `PointerEvent`s (`pointerType: "pen"`, real pressures,
`pointerup` with pressure 0 as Windows sends it) and takes screenshots. A
pixel scan looks for white pixels enclosed by ink within 3 px (pinholes) —
zero at 1× and 2.6× zoom after `403db6b`. Real-mouse circles were drawn with
`SendInput` and read back as round. Touch pan and pinch were checked by
dispatching two-finger `pointermove`s and reading `scrollTop` and the canvas
width.

For the lasso, highlighter and zoom fixes a real synthetic pen was used as
well: `mkpen.mjs` writes a sample list, `pen.ps1` injects it through
`InjectSyntheticPointerInput` with pressure, so Windows Ink itself delivers
the events — the same path a Surface Pen takes — and the screenshots were
cropped and read back for seams, doubled alpha and a blank canvas.

For the page image and the export menu, `apps/web/scripts/ink-image-cdp.mjs`
mounts the real `InkHost` in a throwaway page over HTTP (the worker needs a
real origin for `import.meta.url`), drives Chromium over CDP, and asserts
against the model *and* the pixels: the text layer, the vault bytes, the
decoded chunk's background index, and — reading the PNGs back in the page —
the sheet showing the picture's blue (37,99,235) on paper, and the 2× export
carrying both the image and the stroke (479 near-black pixels, against 0 on
the ink-free page with the same picture, which is what makes the count mean
something). `--probe-menu` dumps the menu's geometry and hit test, which is how
the off-screen bug above was found.

Its last step is the replace-or-new-page question, and it is the one that
found the bug below: the harness asks in the bar (which renames its image
button to "Change page image" once a page has one), takes each answer in turn,
and checks the page the reader ends up on — its stored path, the bar's own
words, and the picture's blue on its sheet (29 checks in all). An answer that
is only *recorded* and never drawn passes a model assertion and fails that one.

## 4. Still open

- The local-db "Aborted()" on some launches (PGlite 0.5.5, empty `pg_wal`):
  not reproduced this session.
- Android build not exercised against a stylus.
- Step 10 UI (Convert to LaTeX) still greyed.
- `check:hygiene` fails on eight files over the 800-line cap. Seven were
  already over it at `3a68c43` — `apps/desktop/src/main.ts` (1038),
  `apps/web/src/features/editor-workspace/ui/explorer-panel.tsx` (895),
  `apps/web/src/features/ink/application/shape-snap/` (then one 1426-line
  `shape-snap.ts`, since split),
  `apps/web/src/features/ink/application/use-pen-capture.ts` (953),
  `apps/web/src/features/ink/render/webgl-renderer.ts` (1137),
  `apps/web/src/features/ink/worker/ink-worker.ts` (950), and
  core's `ink/myscript/` (since removed) — the old 835-line `myscript.ts`, since
  split into `vocabulary.ts` (112), `request.ts` (169), `response.ts` (240),
  `latex.ts` (51) and `engine.ts` (183) behind an `index.ts` that carries the
  module's banner — while `ink-host.tsx` (1571) grew
  past it again with this work, having started at 1188. The export pipeline has
  been lifted out to `apps/web/src/features/ink/ui/use-page-export.ts`; the rest
  of the host is the page/image flows, recognition, save scheduling and the
  render tree, and splitting it is a design job on the component that holds
  every ref in the editor, not a move. It needs deciding per file: split, or an
  `OVERSIZED_ALLOWED` entry with a reason. See `docs/building/dev.md` § Source
  hygiene.
