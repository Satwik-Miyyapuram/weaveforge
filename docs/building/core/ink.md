# Ink core

The ink core does the geometry of handwriting. It smooths a pen stroke, turns it into curves, sets the nib width, packs points for storage, and decides what a lasso or an eraser touches.

## What lives in Rust

The module is `wf_core::ink`. Its `mod.rs` says it is "ink geometry: smoothing, curves, nib widths, zoom and the live stroke packer", a port of `packages/core/src/ink`.

Each file below owns one part:

- `chunk`: the ink chunk container, one page in columnar binary.
- `chunk_read`: reads a checked chunk body back as the page model.
- `clip_to_area`: the box a stroke may be drawn in, and where the pen leaves it.
- `clipboard`: clipboard text for copied figures and lassoed strokes.
- `contact_area`: a touch's contact area in mm², from its CSS-pixel box, for the palm rule.
- `curve`: the cubic Hermite span drawn between each pair of points.
- `decode`: picks among an engine's readings of each word and says how sure it is.
- `figure`: figures placed on a page, written as image refs in the page text.
- `hit_test`: point and segment tests for lasso selection and erasing.
- `ink_engine`: facts about the ink engines this build knows.
- `ink_page`: the page model and text-layer helpers.
- `ink_paths`: sidecar paths and chunk ids for ink notes.
- `ink_print`: a page as a printable HTML document.
- `ink_svg`: a page as an SVG document.
- `js_math`: JavaScript `Math` semantics where Rust differs, so geometry matches.
- `one_euro`: the 1-Euro pen filter, a port of the TypeScript wrapper.
- `page_background`: where a page background sits on the A4 sheet.
- `page_history`: one undo order for a page's strokes and figures.
- `page_math`: the fit, the selection's text and the figure hit test.
- `page_text`: the page text once handwriting is recognised.
- `palette`: the colour maths of the ink palette: a palette entry as CSS or hex, the name a hex came from, the parse of a computed colour, and whether two palettes match.
- `pdf_pages`: which pages of a PDF the user meant, such as `all` or a list.
- `pen_pointer`: the pen's eraser end and barrel button, read from a pointer event.
- `recognise`: confidence mapping and the other pure parts of recognition.
- `recognition_request`: reads the request the desktop recogniser sends.
- `render_strokes`: the strokes in the shape the one renderer takes, with colour names resolved.
- `segment`: groups a page's strokes into the lines a recogniser reads.
- `shape_snap`: fits a line, rect, ellipse or arrow to a freehand mark.
- `smooth`: resampling and a binomial filter for stroke smoothing.
- `stroke_packer`: packs a stroke for storage while it is written.
- `trail`: the diameter of the delegated ink trail.
- `vocab_match`: near-miss vocabulary matching for recognised text.
- `width`: nib widths from pressure, speed and the clamp.
- `zoom`: the ink zoom table.

## How the app calls it

The app reaches the core through `readyCore()` from `@/lib/rust-core`. The wasm exports live in `crates/wf-wasm/src/` and are wrapped in `packages/wf-wasm/src/`.

Examples of exports:

- Geometry: `inkCurveAt`, `resampleInkStroke`, `smoothInkStroke`, `nibWidth`, `clampInkZoom`, `inkZoomIn`, `inkZoomOut`.
- Stroke packing: `packInkStroke`, `createInkStrokePacker`.
- Render: `toRenderStrokes`, from `ink_render_strokes.rs`.
- Filter: `oneEuroAlpha`, from `one_euro.rs`.
- Pen: `isPenEraserPointer`, `isPenBarrelPointer`.
- Hit tests: `inkPointInPolygon`, `pointInArea`, `clipSegmentToArea`.
- Clipboard: `figureClipText`, `parseFigureClip`, `pastedFigurePlace`, `strokeClipText`, `parseStrokeClip`, `pastedStrokesPlace`.
- Print and SVG: `inkPrintDocument`, `inkPageSvg`.
- Palette: `paletteCss`, `paletteHex`, `paletteName`, `parseCssColour`, `samePalette`, from `ink_palette.rs`. The TypeScript wrappers are `packages/wf-wasm/src/ink-palette.ts`.
- Palm rule: `contactAreaMm2`, from `ink_palette.rs`. Its wrapper takes a `{ width, height }` pointer event.

The palette functions take the palette as an object of colour name to `[r, g, b]`. The wrapper turns it into ordered pairs for the wasm side, so a name that appears twice resolves as the JavaScript object does. `ink-palette.ts` and `pen-gate.ts` call these through `readyCore()`, so they need the core loaded first.

Two real call sites:

- `apps/web/src/features/ink/ui/use-ink-selection.ts` calls `readyCore().pastedStrokesPlace(...)`.
- `apps/web/src/features/ink/ui/use-ink-page-media.ts` calls `readyCore().pastedFigurePlace(...)`.

The pen filter is loaded lazily. `apps/web/src/features/ink/application/one-euro-filter.ts` reads `readyCore().NibFilter` and `readyCore().OneEuroFilter` on first use.

## What stays in TypeScript, and why

The pen capture, haptics and React state stay in TypeScript. They depend on browser pointer events and component lifecycles, which Rust cannot see.

The filter wrapper stays too. `apps/web/src/features/ink/application/one-euro-filter.ts` exports `INK_POSITION_FILTER`, `INK_PRESSURE_FILTER`, `OneEuroFilter` and `NibFilter`. `NibFilter` is a TypeScript class over the wasm handle, so callers keep the same shape. Pen capture, `pen-capture-session.ts`, `pen-haptics.ts` and `pdf-ink-sampler.ts` import it from there.

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
