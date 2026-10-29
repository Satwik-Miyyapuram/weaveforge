//! Search text rules shared by indexing and querying. Each function matches the
//! TypeScript it replaces in `packages/core/src/search` (see
//! docs/plans/current/rust-port/phase-1-search.md).

pub mod js_text;
pub mod tokenizer;
pub mod url_parts;
