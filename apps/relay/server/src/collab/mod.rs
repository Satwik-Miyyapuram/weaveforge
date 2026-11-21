//! Co-editing on the relay (files-first L8): one Yjs document per shared item.
//!
//! Clients join `/collab/ws/{item_id}` with the token in the WebSocket protocol
//! header. Every update is checked against the caller's grant, written to an
//! fsynced log on disk, then sent to the other clients. A background task saves
//! changed documents to `shared_docs.state` and empties the log. The save log
//! itself is a `Y.Map` inside the document, so the server keeps no save table.

use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub mod hub;
pub mod lease;
pub mod protocol;
pub mod routes;
pub mod store;
pub mod update_log;
pub mod ws;

use crate::collab::hub::Hub;
use crate::collab::store::SharedDocStore;

/// A boxed future, so the store and sign-in traits stay object safe.
pub type BoxFut<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// What a caller may do with a shared document, weakest first.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Permission {
    /// Read only.
    View,
    /// Read only, for now: comment writes are refused until comments have their own channel.
    Comment,
    /// Read and write.
    Edit,
    /// The sharer: everything, plus unshare, restore and grants.
    Owner,
}

impl Permission {
    /// Whether this caller may send document updates. Comment-only callers may not: their
    /// updates would reach the owner's file through the write-back lease.
    #[must_use]
    pub fn can_write(self) -> bool {
        self >= Self::Edit
    }

    /// Whether this caller may hold the write-back lease: only the owner writes back into
    /// the owner's workspace files.
    #[must_use]
    pub fn can_hold_lease(self) -> bool {
        self == Self::Owner
    }

    /// Parses `view`, `comment`, `edit` or `owner`.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "view" => Some(Self::View),
            "comment" => Some(Self::Comment),
            "edit" => Some(Self::Edit),
            "owner" => Some(Self::Owner),
            _ => None,
        }
    }

    /// The database spelling.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::View => "view",
            Self::Comment => "comment",
            Self::Edit => "edit",
            Self::Owner => "owner",
        }
    }
}

/// The time source, so tests can move the clock.
pub trait Clock: Send + Sync {
    /// Milliseconds since the Unix epoch.
    fn now_ms(&self) -> i64;
}

/// The wall clock.
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
            .unwrap_or(0)
    }
}

/// Turns a session token into a user id (`None`: refused).
pub trait Authenticator: Send + Sync {
    /// The user the token signs in, if any.
    fn user_for<'a>(&'a self, token: &'a str) -> BoxFut<'a, Option<String>>;
}

/// Tunables for co-editing.
#[derive(Clone, Debug)]
pub struct CollabConfig {
    /// Where the per-document update logs live.
    pub log_dir: PathBuf,
    /// How often changed documents are saved (2 s in production).
    pub persist_every: Duration,
    /// How long a write-back lease lasts without renewal (90 s in production).
    pub lease_ms: i64,
    /// How long a grant check is trusted before it is asked again (0: every update).
    pub grant_cache_ms: i64,
    /// How often an open socket re-reads its grant, so a lapsed grant closes it even when idle.
    /// Must be non-zero.
    pub grant_check_every: Duration,
}

impl CollabConfig {
    /// Production values, with the logs under `log_dir`.
    #[must_use]
    pub fn production(log_dir: PathBuf) -> Self {
        Self {
            log_dir,
            persist_every: Duration::from_secs(2),
            lease_ms: 90_000,
            grant_cache_ms: 5_000,
            grant_check_every: Duration::from_secs(30),
        }
    }
}

/// Everything the co-editing routes share.
pub struct CollabState {
    /// Tunables.
    pub config: CollabConfig,
    /// Where documents and grants are kept.
    pub store: Arc<dyn SharedDocStore>,
    /// Who a token belongs to.
    pub auth: Arc<dyn Authenticator>,
    /// The time source.
    pub clock: Arc<dyn Clock>,
    /// The open documents.
    pub hub: Hub,
}
