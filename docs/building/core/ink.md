# Ink core

The ink core does the geometry of handwriting. It smooths a pen stroke, turns it into curves, sets the nib width, packs points for storage, and decides what a lasso or an eraser touches.

## What lives in Rust

The module is `wf_core::ink`. Its `mod.rs` says it is "ink geometry: smoothing, curves, nib widths, zoom and the live stroke packer", a port of `packages/core/src/ink`.

Each file below owns one part:

- `chunk`: the ink chunk container, one page in columnar binary.
- `chunk_read`: reads a checked chunk body back as the page model, and the stroke and absolute point walks that `ink-chunk-read.ts` views call. `ink-chunk-read.ts` still decodes line text in TS.
- `clip_to_area`: the box a stroke may be drawn in, and where the pen leaves it.
- `clipboard`: clipboard text for copied figures and lassoed strokes.
- `contact_area`: a touch's contact area in mm², from its CSS-pixel box, for the palm rule.
- `curve`: the cubic Hermite span drawn between each pair of points.
- `decode`: picks among an engine's readings of each word and says how sure it is. `capped_engine_confidence` (`inkCappedEngineConfidence` is wasm `cappedEngineConfidence`) caps an engine's line confidence below certainty.
- `eraser_sweep`: the state of one erase sweep (who sweeps, whether the back tip made it, the sticky hover). It returns the cursor action (`none`, `show`, `keep`, `restore`); the DOM target and its saved cursor stay in TypeScript (`application/eraser-tip.ts`), so this is a THIN port.
- `figure`: figures placed on a page, written as image refs in the page text.
- `hit_test`: point and segment tests for lasso selection and erasing. `polygon_bounds` (wasm `inkPolygonBounds`) gives the box round a lasso loop.
- `ink_constants`: the tuning numbers of width, zoom, smooth, segment, decode and figure, read from Rust through `inkConstants()` (`packages/wf-wasm/src/wrappers-3.ts`). The core TS modules still hold these as their own constants, so this is a DATA row only; the export-shape change is deferred.
- `ink_engine`: facts about the ink engines this build knows.
- `ink_page`: the page model and text-layer helpers.
- `ink_paths`: sidecar paths and chunk ids for ink notes. `chunk_id_of_file_name` (wasm `inkChunkIdOfFileName`, called through `readyCore()`) gives the id a file name carries, only for a valid `<ulid>.inkb`.
- `ink_print`: a page as a printable HTML document.
- `ink_svg`: a page as an SVG document.
- `js_math`: JavaScript `Math` semantics where Rust differs, so geometry matches.
- `one_euro`: the 1-Euro pen filter, a port of the TypeScript wrapper.
- `page_background`: where a page background sits on the A4 sheet. `is_pdf` and `is_page_source` (wasm `inkIsPdf`, `inkIsPageSource`) say whether a file is a PDF, or any page source (a PDF or an image), by MIME or a `.pdf` name in any case.
- `page_scissor`: the WebGL page scissor box, `[x, y, w, h]` in device pixels with GL's bottom-up rows (wasm `inkPageScissor`). The GL `scissor` call stays in TypeScript (`render/webgl-support.ts`).
- `page_history`: one undo order for a page's strokes and figures.
- `page_math`: the fit, the selection's text and the figure hit test.
- `page_text`: the page text once handwriting is recognised.
- `palette`: the colour maths of the ink palette: a palette entry as CSS or hex, the name a hex came from, the parse of a computed colour, and whether two palettes match.
- `pdf_pages`: which pages of a PDF the user meant, such as `all` or a list.
- `pen_pointer`: the pen's eraser end and barrel button, read from a pointer event.
- `recognise`: confidence mapping and the other pure parts of recognition. `band_union` (wasm `inkBandUnion`) spans the y-bands of a line's strokes, or is none when there are none.
- `recognition_request`: builds the request the page sends to the desktop recogniser (`buildInkRequest`, flattening strokes to x, y, pressure) and checks the request the desktop reads (`readInkRequest`).
- `render_instances`: the WebGL stroke renderer's maths: instance count, the packer that writes each span's capsule instances (`pack_stroke_instances`), the backing-store ratio and the highlighter-pass test. The GL calls, buffers and canvas stay in TypeScript (`render/ink-renderer.ts`, `render/webgl-renderer.ts`), so this is a THIN port.
- `render_strokes`: the strokes in the shape the one renderer takes, with colour names resolved.
- `segment`: groups a page's strokes into the lines a recogniser reads.
- `shape_snap`: fits a line, rect, ellipse or arrow to a freehand mark.
- `smooth`: resampling and a binomial filter for stroke smoothing.
- `stroke_index`: the candidate pick of the stroke index (`pickCandidates`, `inkPickCandidates`): keeps the R-tree hits that are alive and meet the query box. The Flatbush R-tree search and `containing()` stay in TypeScript (`application/stroke-index.ts`), so this is a THIN port.
- `gesture`: the pointer route picker (a question-driven state machine: sweep tip, admit, hit-selection, sweep tool, intercept, then the route) and `StrokeEdgeSplit` (cuts a stroke where it leaves the paper). The DOM, pointer events and the eraser cursor stay in TypeScript (`application/ink-gesture.ts`), so this is a THIN port.
- `stroke_packer`: packs a stroke for storage while it is written.
- `trail`: the diameter of the delegated ink trail, and `trail_alpha` (wasm `inkTrailAlpha`): a highlighter's trail is translucent (0.35), a pen's is opaque.
- `vocab_match`: near-miss vocabulary matching for recognised text.
- `width`: nib widths from pressure, speed and the clamp.
- `zoom`: the ink zoom table.

## How the app calls it

The app reaches the core through `readyCore()` from `@/lib/rust-core`. The wasm exports live in `crates/wf-wasm/src/` and are wrapped in `packages/wf-wasm/src/`.

Examples of exports:

- Geometry: `inkCurveAt`, `resampleInkStroke`, `smoothInkStroke`, `nibWidth`, `clampInkZoom`, `inkZoomIn`, `inkZoomOut`.
- Stroke packing: `packInkStroke`, `createInkStrokePacker`.
- Render: `toRenderStrokes`, from `ink_render_strokes.rs`.
- Filter: `oneEuroAlpha`, `inkPositionOptions`, `inkPressureOptions`, from `one_euro.rs`. The tuned options are read at call time, not copied into TypeScript.
- Pen: `isPenEraserPointer`, `isPenBarrelPointer`.
- Hit tests: `inkPointInPolygon`, `pointInArea`, `clipSegmentToArea`.
- Clipboard: `figureClipText`, `parseFigureClip`, `pastedFigurePlace`, `strokeClipText`, `parseStrokeClip`, `pastedStrokesPlace`.
- Print and SVG: `inkPrintDocument`, `inkPageSvg`.
- Palette: `paletteCss`, `paletteHex`, `paletteName`, `parseCssColour`, `samePalette`, from `ink_palette.rs`. The TypeScript wrappers are `packages/wf-wasm/src/wrappers-3.ts`.
- Palm rule: `contactAreaMm2`, from `ink_palette.rs`. Its wrapper takes a `{ width, height }` pointer event.
- Render instances: `inkStrokeInstanceCount`, `packInkStrokeInstances`, `inkBackingRatio`, `usesInkHighlighterPass`, from `ink_render_instances.rs`. The TypeScript wrappers are `packages/wf-wasm/src/wrappers-3.ts`. `packInkStrokeInstances` returns a `Float64Array`; `ink-renderer.ts` narrows it into the `Float32Array` the GL buffer takes. `strokeInstanceCount`, `backingRatio`, `usesHighlighterPass` and `packStrokeInstances` in `ink-renderer.ts` call these through `readyCore()`, so the core must be loaded before the WebGL renderer or the layout hook runs. Tests preload it with `before(loadTestCore)`.

The palette functions take the palette as an object of colour name to `[r, g, b]`. The wrapper turns it into ordered pairs for the wasm side, so a name that appears twice resolves as the JavaScript object does. `ink-palette.ts` and `pen-gate.ts` call these through `readyCore()`, so they need the core loaded first.

Two real call sites:

- `apps/web/src/features/ink/ui/use-ink-selection.ts` calls `readyCore().pastedStrokesPlace(...)`.
- `apps/web/src/features/ink/ui/use-ink-page-media.ts` calls `readyCore().pastedFigurePlace(...)`.

The pen filter is loaded lazily. `apps/web/src/features/ink/application/one-euro-filter.ts` reads `readyCore().NibFilter` and `readyCore().OneEuroFilter` on first use.

## What stays in TypeScript, and why

The pen capture, haptics and React state stay in TypeScript. They depend on browser pointer events and component lifecycles, which Rust cannot see.

The filter wrapper stays too. `apps/web/src/features/ink/application/one-euro-filter.ts` exports `inkPositionOptions()`, `inkPressureOptions()`, `OneEuroFilter` and `NibFilter`. `NibFilter` is a TypeScript class over the wasm handle, so callers keep the same shape. Pen capture, `pen-capture-session.ts`, `pen-haptics.ts` and `pdf-ink-sampler.ts` import it from there.

The Rust `one_euro` module ports the maths only. The wrapper owns the lazy load and the two shared instances.

The palette keeps its data and its DOM read in TypeScript. `apps/web/src/features/ink/render/ink-palette.ts` keeps `INK_RENDER_COLOURS`, `INK_COLOUR_TOKENS`, the `InkPalette` types and `readThemePalette`, which reads the live theme off a probe element. The colour maths moved to Rust. The `InkPenGate` state machine and its constants (`PALM_CONTACT_AREA_MM2`, the timing windows) stay in `pen-gate.ts`, which only delegates `contactAreaMm2`.

The app's ink worker, renderers and storage are in TypeScript too. These files touch a browser or device API, or keep state that lives in JavaScript:

- `application/pen-haptics.ts`: calls the device vibration API.
- `application/pen-capture-session.ts`: holds the pointer-event session state.
- `application/ink-chunk-codec.ts`: uses `CompressionStream` and `DecompressionStream`.
- `application/ink-pending-writes.ts`: tracks in-flight save promises by note.
- `application/load-in-order.ts`: runs async JavaScript loaders and collects their results.
- `application/stroke-index.ts`: wraps a `flatbush` R-tree over the JavaScript page buffer.
- `render/canvas-renderer.ts`, `render/webgl-batches.ts`, `render/webgl-offscreen.ts`, `render/webgl-renderer.ts`, `render/webgl-shaders.ts`, `render/webgl-support.ts`: draw to canvas or WebGL.
- `infrastructure/routed-ink-chunk-store.ts`: reads and writes chunks through storage I/O.
- `worker/ink-background.ts`, `worker/ink-export.ts`, `worker/ink-paste.ts`: handle worker messages over fetch and storage.

Source: `crates/wf-core/src/ink/`
