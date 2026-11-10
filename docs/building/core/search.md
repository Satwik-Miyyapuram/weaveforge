# Search core module

The `search` module holds the pure text and ranking rules behind search:
how terms are normalized, how a query is parsed, how results are fused and
tuned, how excerpts are cut, how vectors are stored and searched, and how the
index is refreshed. It does not run the search itself or touch the index store.
The app passes documents, rankings and vectors in as data.

## What lives in Rust

- `tokenizer.rs`: term normalization shared by indexing and querying.
- `query.rs`: the search query syntax.
- `acronyms.rs`: initialisms derived from a title, so "GAN" finds "Generative
  Adversarial Networks".
- `fusion.rs`: reciprocal rank fusion of ranked id lists. Ties break on the code
  point order of the id.
- `search_tuning.rs`: the ranking rules.
- `search_retry.rs`: second-chance fuzzy matching for a query that found nothing.
- `rank_filter.rs`: filters a screen list by search rank. The caller passes the
  hit ids in rank order.
- `refresh_diff.rs`: plans a partial index refresh. A document is re-tokenized
  only when its printed form changed.
- `related.rs`: the arm and result types for related items.
- `vector_index.rs`: brute-force cosine search over unit vectors. There is no
  approximate-nearest-neighbour structure.
- `vector_codec.rs`: the binary framing of a stored vector file.
- `embedding_models.rs`: `planEmbeddingStart`, which decides whether to reuse,
  swap or rebuild the embeddings when the model changes.
- `index_cache_policy.rs`: the rule for when the index cache is kept.
- `pdf_text_prune.rs`: which stored PDF texts still belong to a paper in the
  workspace, and which are orphans.
- `excerpt_segments.rs`: splits an excerpt into plain and highlighted segments,
  so a renderer can mark matches without offset arithmetic.

The rest of the module (`excerpt.rs`, `result_dedupe.rs`, `search_document.rs`,
`search_index_state.rs`, `search_settings.rs`, `text_chunks.rs` and others)
follows the same pattern.

## How the app calls it

The wasm exports live in `crates/wf-wasm/src`. The TypeScript wrappers in
`packages/wf-wasm/src` import the raw names from `../pkg/wf_wasm.js` and
re-export them. The main names are `projectSearchDocuments`,
`projectStoredPdfTexts`, `searchRevision`, `diffRefreshPlan`, `distinctRelated`,
`collapseToEntities`, `planEmbeddingStart`, `packVectors`, `unpackVectors`,
`normalizeSearchSettings`, `findRelated`, `shouldRetrySearch`, `normalizeVector`
and `fuzzinessForTerm`.

Code in `apps/web` reads these through `readyCore()` or `typedCore()` from
`apps/web/src/lib/rust-core.ts`. For example, `workspace-search.ts` calls
`readyCore().projectSearchDocuments` and `readyCore().findRelated`,
`semantic-search.ts` calls `readyCore().searchRevision` and
`readyCore().planEmbeddingStart`, and `vector-store.ts` calls
`readyCore().packVectors`.

## What stays in TypeScript, and why

- **The index cache.** Platform detection (`isInstalledApp`) and the IndexedDB
  writes stay in `apps/web`. The Rust side decides only whether the cache is
  kept.
- **Stored PDF text I/O.** Reconciling, loading and deleting stored PDF texts
  are I/O. `pdf_text_prune.rs` returns the orphans, and TypeScript deletes them.
- **Embedding profile constants.** The model profiles stay in TypeScript, because
  the settings UI reads them. `KNOWN_MODELS` must list the same models on both
  sides.
- **Search orchestration.** The search screens and the workspace and semantic
  search flows stay in `apps/web/src/features/search`.

## Related

- [Workspace core](workspace.md)
- [Storage core](storage.md)
- [Vault core](vault.md)

Source: `crates/wf-core/src/search/`
