//! WeaveForge native I/O: the workspace folder, blobs, git and models. Never built for WASM.
#![forbid(unsafe_code)]

/// Native sentence embeddings matching transformers.js q8 models.
pub mod embed;
pub mod git;
pub mod root;
pub mod vault;
