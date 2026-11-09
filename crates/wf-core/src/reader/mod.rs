//! PDF reader logic: anchors, ink strokes, search, viewport and annotation rules.
//! Ports of packages/core/src/reader/*.ts. The DOM, async and client-bound parts stay in TS.

pub mod anchor;
pub mod annotation;
pub mod annotation_backlinks;
pub mod batch_annotation_ops;
pub mod github_repo_path;
pub mod ink_stroke;
pub mod ink_undo;
pub mod link_citations;
pub mod locate;
pub mod locus;
pub mod merge_annotations;
pub mod pdf_cache_eviction;
pub mod pdf_source_ladder;
pub mod selection;
pub mod split;
pub mod viewport;
pub mod zotero_sync;
