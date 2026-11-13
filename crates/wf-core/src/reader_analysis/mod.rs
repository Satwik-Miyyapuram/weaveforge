//! PDF text analysis: line reconstruction, columns, citation text, fingerprints.
//! Ports of packages/core/src/features/reader{,/analysis}/*.ts.

pub mod bibliography;
pub mod citation_assembly;
pub mod citation_matcher;
pub mod citation_style;
pub mod citations;
pub mod document_analysis;
pub mod figure_mentions;
pub mod headings;
pub mod lines;
pub mod outline;
pub mod pdf_links;
pub mod reference_section;
pub mod running_heads;
pub mod text;
pub mod types;
