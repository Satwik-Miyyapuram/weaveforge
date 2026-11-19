//! The in-memory index of workspace files, rebuilt from the files. It is never
//! the source of truth: the files are, and the index can always be rebuilt from them.

pub mod scan;
pub mod store;

pub use store::{IndexEntry, IndexStore, Relation};
