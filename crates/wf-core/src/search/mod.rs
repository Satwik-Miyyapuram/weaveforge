//! Search text rules shared by indexing and querying. Each function matches the
//! TypeScript it replaces in `packages/core/src/search` (see
//! docs/plans/current/rust-port/phase-1-search.md).

pub mod acronyms;
pub mod embedding;
pub mod excerpt;
pub mod fusion;
pub mod hybrid_fusion;
pub mod js_text;
pub mod personalized_pagerank;
pub mod query;
pub mod related;
pub mod search_document;
pub mod search_history;
pub mod search_retry;
pub mod search_settings;
pub mod search_tuning;
pub mod text_chunks;
pub mod tokenizer;
pub mod url_parts;
pub mod vector_codec;
pub mod vector_index;
pub mod wiki_graph;
