# Lexical concepts core module

The `lexical_concepts` module extracts concepts from documents with no model. It
harvests candidate terms, merges them and ranks them. It does no I/O.

## What lives in Rust

- `extract_lexical(request)`: takes a `LexicalRequest` (`documents`, optional
  `maxConcepts`) and returns an `ExtractionResult`.
- `LexicalDocument` (`id`, optional `text`) and `LexicalRequest` (`documents`,
  optional `maxConcepts`) are `Deserialize`. Absent optional fields are left out of
  the JSON, so they reach Rust as `None`, not `null`.
- `rank_and_limit` applies the concept cap with `js_slice_keep`, which matches JS
  `slice(0, n)`. Absent, `0` and `NaN` mean no cap. A negative value counts from the
  end. `Infinity` keeps all.
- `title` is not part of the input. The TypeScript code never read it.

Source: `crates/wf-core/src/ai/lexical_concepts.rs`. The tests in the same file cover
the TypeScript cases, plus `max_concepts_follows_js_slice_for_odd_values`.

## How the app calls it

The wasm export is `extractLexical` in `crates/wf-wasm/src/ai_lexical_concepts.rs`.
It is served straight from the wasm package,
with types from `./bindings.js` declared in Rust. The TypeScript `LexicalConceptExtractor` in
`packages/core/src/features/ai-assistant/domain/parts.ts` is a
thin shim that calls `rust().extractLexical`.

## What stays in TypeScript, and why

- **The `IConceptExtractor` class.** The app wires extractors through this interface.
  The shim keeps the class and its `id`.
- **Dropping `undefined` keys.** The shim leaves absent optional fields out, so wasm
  does not receive `null`.

## Known deviation

- `NaN` for `maxConcepts`: the brief said `NaN` means `0`, but TypeScript treats `NaN`
  as falsy (no cap). Rust matches TypeScript, so `NaN` means no cap.
