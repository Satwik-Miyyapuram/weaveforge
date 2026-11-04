//! PDF reader logic: anchors, ink strokes, search, viewport and annotation rules.
//! Ports of packages/core/src/reader/*.ts. The DOM, async and client-bound parts stay in TS.

pub mod anchor;
pub mod annotation;
pub mod ink_stroke;
pub mod locate;
pub mod locus;
pub mod selection;
pub mod viewport;
pub mod zotero_sync;
