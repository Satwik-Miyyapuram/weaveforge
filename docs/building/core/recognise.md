# Recognise core

The recognition helpers are the pure parts of handwriting recognition: the unsure threshold, confidence mapping, the vocabulary hint list, the engine preference rank, the y-band coincidence test and the page summary the text layer shows.

## What lives in Rust

- `wf_core::ink::recognise`: `INK_UNSURE_CONFIDENCE`, `is_unsure_confidence`, `map_ink_confidence`, `ink_page_confidence`, `ink_vocabulary_hints`, `bands_coincide` and `ink_page_summary` (a `RecognisedLine` list reduced to its text, confidence and unsure count).
- `wf_core::ink::ink_engine`: `ink_engine_rank`, the engine's index in `INK_ENGINES`, with unknown ids sorting last.

The wasm exports are in `crates/wf-wasm/src/ink.rs` and `ink_engine_title.rs`: `inkUnsureConfidence`, `isUnsureLine`, `mapInkConfidence`, `inkPageConfidence`, `inkVocabularyHints`, `bandsCoincide`, `inkPageSummary` and `inkEngineRank`.

## What stays in TypeScript

- `selectInkRecogniser` in `packages/core/src/ink/recognise.ts` still awaits each engine's `available()` probe. Only the ranking moved, through `rust().inkEngineRank`.
- `recognisePage`, `recogniseLine` and `acceptedLines` in `apps/web/src/features/ink/application/recognise-page.ts` stay as shims. They drive the engine and the line loop, and they call `readyCore()` for the pure parts.

## Wrappers

Every raw export has a typed wrapper in `packages/wf-wasm/src`, imported as `rawX` from `../pkg/wf_wasm.js`:

- `ink-lines.ts`: `inkUnsureConfidence`, `bandsCoincide`, `inkPageSummary`.
- `core-extra.ts`: `inkEngineRank`.

The eight recognition names are declared on `RustCoreFns` in `packages/core/src/shared/rust.ts`. The former `RecogniseFns` interface is gone, so `rust()` types them directly.

## Behaviour notes

- `bandsCoincide` treats a band with NaN in it as not coinciding, which relies on `js_math` propagating NaN the way JavaScript's `Math.min` and `Math.max` do.
- `inkUnsureConfidence()` is a function, not a constant, so the one threshold is read from Rust at call time.
- `INK_ENGINE_ORDER` is removed. Engine order is `INK_ENGINES` in Rust.
