# Model extraction core module

The `model_extraction` module builds the model request for concept extraction and
merges the replies. It does no I/O. The model call, the batch loop and the database
stay in TypeScript.

## What lives in Rust

- `system_prompt()`: the extraction prompt, including the untrusted-context rule.
- `limits()`: `ModelExtractionLimits` (`batchSize`, `maxDocumentChars`,
  `knownConceptLimit`). `knownConceptLimit` is 200.
- `build_batch_request(batch, existing, model, max_chars, nonce)`: builds a
  `ModelRequest` from `ModelDocument`s (`id`, `title`, optional `text`). `model` is
  `Option<&str>`. It applies the 200-concept known cap itself, so TypeScript does not
  slice the existing concepts. `max_chars` saturates, and `NaN` becomes 0.
- `finalize_extraction(results, existing, max_concepts)`: merges the batch results and
  applies the cap with `js_slice_keep`.

Source: `crates/wf-core/src/ai/model_extraction.rs`. The tests cover the TypeScript
cases, plus `the_cap_follows_js_slice_for_odd_values`.

## How the app calls it

The wasm exports are in `crates/wf-wasm/src/ai_model_extraction.rs`. The wrapper
`packages/wf-wasm/src/ai-model-extraction.ts` exports `modelExtractionLimits`,
`modelBuildBatchRequest` and `modelFinalizeExtraction`. It passes `[...existing]`
copies and maps an absent `maxConcepts` to `undefined`.

`packages/core/src/features/ai-assistant/domain/model-concept-extractor.ts` is a thin
shim. Its `ModelConceptExtractor.extract` filters blank documents, reads the limits,
runs the batch loop, and throws the last error only when every batch failed.

## What stays in TypeScript, and why

- **The batch loop and try/catch.** One failed batch costs its own documents. The
  `lastError` rethrow happens only when no batch succeeded.
- **`model.complete`.** This is the host model call through `IModelConversation`.
- **The blank-document filter.** It runs before the loop and stays in TypeScript.
- **`contextNonce()`.** The nonce comes from the host.

## Parity notes

- `max_chars` saturates, and `NaN` becomes 0.
- Undefined keys are stripped before the wasm call, as in the lexical shim.
- `title` is sent only to the request builder, which needs it.
