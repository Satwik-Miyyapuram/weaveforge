//! Search text rules shared by indexing and querying. Each function matches the
//! TypeScript it replaces in `packages/core/src/search` (see
//! docs/plans/current/rust-port/phase-1-search.md).

pub mod acronyms;
pub mod ask_library;
pub mod embedding;
pub mod embedding_models;
pub mod excerpt;
pub mod excerpt_segments;
pub mod fusion;
pub mod hybrid_fusion;
pub mod index_cache_policy;
pub mod js_text;
pub mod library_index;
pub mod pdf_text_prune;
pub mod personalized_pagerank;
pub mod projection;
pub mod query;
pub mod rank_filter;
pub mod refresh_diff;
pub mod related;
pub mod result_dedupe;
pub mod search_document;
pub mod search_history;
pub mod search_index_state;
pub mod search_retry;
pub mod search_settings;
pub mod search_tuning;
pub mod semantic_fingerprint;
pub mod text_chunks;
pub mod tokenizer;
pub mod url_parts;
pub mod vector_codec;
pub mod vector_index;
pub mod wiki_graph;
