//! Pure text transforms behind the markdown editor and renderers. CodeMirror, the DOM and the
//! renderers themselves stay in TypeScript; only the string rules move here.

pub mod cite_links;
pub mod math_input;
pub mod mermaid_source;
