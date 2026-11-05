//! Blob storage rules (phase 3): content types and cold-tier eviction order,
//! ported from `packages/core/src/storage`, plus the blob access rules the
//! relay's `/api/blobs/*` routes enforce.

pub mod blob;
pub mod blob_access;
