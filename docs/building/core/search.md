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
- `chunkForEmbedding` (text-chunks): `apps/web/src/features/search/application/parts-2.ts` calls `readyCore().chunkForEmbedding` at lines 137 and 254. The TS types now live in `packages/core/src/shared/core-contract.ts`.
- `personalizedPageRank` / `relatedByPpr` (personalized-pagerank): no app caller yet. Types now live in `packages/core/src/shared/core-contract.ts`.
- `recentFailureIds` and `courtesyPauseDue` (library-index): `apps/web/src/features/search/application/parts-1.ts` calls `readyCore().recentFailureIds` and `index-library-pdfs.ts` calls `readyCore().courtesyPauseDue`. See [library-index.md](library-index.md).
- `acronymsForTitle` (search-acronyms) and `HYBRID_VECTOR_WEIGHT` / `stripStopwords` / `coveredHits` / `gateVectorHits` (hybrid-fusion): no app TS caller; the types moved inline into `packages/core/src/shared/core-contract.ts`, and the two TS files are marked DELETE.

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

## More search modules

| Module | Rust fn | wasm export | TS caller |
| --- | --- | --- | --- |
| `ask_library` | `source_text`, `ask_prompt`, `SYSTEM_PROMPT` | `askPrompt` | — |
| `embedding` | `normalize_vector` | `normalizeVector` | — |
| `embedding_runtime` | `supports_local_embedding`, `IDLE_EVICT_MS` | `supportsLocalEmbedding`, `embedIdleEvictMs` | `apps/web/src/features/search/application/semantic-search.ts` |
| `hybrid_fusion` | `strip_stopwords`, `query_term_count`, `covered_hit_mask`, `gate_vector_mask` | `stripStopwords`, `coveredHits`, `gateVectorHits` | `apps/web/src/features/search/application/workspace-search.ts` |
| `js_text` | `is_js_whitespace`, `is_letter_or_number`, `utf16_len` | native only | — |
| `minisearch_doc` | `DocStore` (`put`, `remove`, `filter_only`, `boost_of`, `finish`) | `DocStore` methods `setSettings`, `put`, `remove`, `has`, `clear`, `idsOfKind`, `hitById`, `entries`, `boostOf`, `filterOnly`, `finish` | `apps/web/src/features/search/infrastructure/minisearch-index.ts` |
| `pdf_text_store` | `store_key`, `project_range`, `budget_page_count` | `pdfTextStoreOp` | `apps/web/src/features/search/infrastructure/parts-2.ts` |
| `personalized_pagerank` | `personalized_page_rank`, `related_by_ppr` | `personalizedPageRank`, `relatedByPpr` | — |
| `projection` | `project_search_documents`, `project_stored_pdf_texts` | `projectSearchDocuments`, `projectStoredPdfTexts` | `apps/web/src/features/search/application/workspace-search.ts` |
| `search_history` | `remember_search_query`, `forget_search_query`, `normalize_search_history` | `rememberSearchQuery`, `forgetSearchQuery`, `normalizeSearchHistory` | `apps/web/src/components/jump-to-palette.tsx` |
| `semantic_fingerprint` | `text_hash`, `document_id_of`, `embeddable_text`, `document_id_of_path` | `textHash`, `documentIdOf`, `embeddableText`, `documentIdOfPath` | `apps/web/src/features/search/application/parts-2.ts` (`documentIdOfPath`: `application/semantic-search.ts`) |
| `semantic_hits` | `passage_id`, `is_blank_query`, `collapse`, `search_docs`, `nearest_docs` | `passageId`, `isBlankQuery` (`searchDocs`, `nearestDocs` are in `vector_index`) | `apps/web/src/features/search/application/parts-2.ts` |
| `url_parts` | `url_parts` | native only | — |
| `vector_store_paths` | `store_key`, `folder_cache_dir`, `folder_path`, `is_vector_cache_file`, `pack_local_row`, `unpack_local_row` | `vectorStoreKey`, `vectorFolderCacheDir`, `vectorFolderPath`, `isVectorCacheFile`, `packLocalVectorRow`, `unpackLocalVectorRow` | `apps/web/src/features/search/infrastructure/vector-store.ts` |
| `wiki_graph` | `build_wiki_graph`, `graph_degrees`, `graph_density` | `buildWikiGraph`, `graphDegrees`, `graphDensity` | `apps/web/src/features/search/application/workspace-search.ts` |

Rules:

- `ask_library`: `source_text` adds `(p. N)` when a page is set; an empty excerpt counts as none. `ask_prompt` fences sources under the nonce, numbered from 1.
- `embedding`: `normalize_vector` unit-normalises; a zero vector comes back unchanged.
- `embedding_runtime`: local embedding needs both a Worker and WebAssembly. Idle eviction is 5 minutes (`IDLE_EVICT_MS`).
- `hybrid_fusion`: `strip_stopwords` keeps `kind:`, quoted and `-` terms, and returns an all-stopword query whole. `covered_hit_mask` keeps every hit when the query has one term or less, or a hit did not report its term count. `gate_vector_mask` drops all vector hits when the best score is under the floor.
- `js_text`: `is_letter_or_number` has an ASCII fast path, then Unicode Letter or Number. `utf16_len` counts UTF-16 code units.
- `minisearch_doc`: `boost_of` gives 1.0 for an unknown id. `filter_only` sorts the whole match set by boost before it cuts to the limit.
- `pdf_text_store`: stored text is capped at `MAX_STORED_CHARS` (2,000,000). The op names are `key`, `range` and `budget`.
- `personalized_pagerank`: defaults are 3000 walks, 50 steps, damping 0.15. A seed missing from the graph gives an empty result; a seed with no edges keeps all its probability. `related_by_ppr` drops the seed and breaks ties by `locale_compare`.
- `projection`: revision order is the snapshot's documents, then PDF pages, then reader annotations. The worker and main thread share this path so their revisions cannot drift.
- `search_history`: the list is capped at `MAX_SEARCH_HISTORY` (12).
- `semantic_fingerprint`: `text_hash` is FNV-1a over UTF-16 code units, written in base 36 with the length, and must stay bit-identical to the old TS. `document_id_of` cuts at the last `#` only. `embeddable_text` repeats the title in the first passage.
- `semantic_hits`: `MIN_SCORE` is 0.2. Neighbour lookups use passages 0 to 3 only. `collapse` keeps each document's best passage; ties sort by `localeCompare` on the id.
- `url_parts`: matches against the 8 entries of `URL_TLDS`. No wasm export.
- `vector_store_paths`: the key is `-` with no project. Cache files are matched on the last path segment only, `vectors-*.bin`.
- `wiki_graph`: nodes are `kind:id`. A tag reaching more than `MAX_TAG_FANOUT` documents is ignored. Sparse graphs make PPR return only the seed.
