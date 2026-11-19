//! Per-device base store: the last synced text of each item, in `.weaveforge/local/bases.sqlite`.
//!
//! Local only and never synced, so each device keeps its own bases.

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::OptionalExtension;
use wf_core::sync::frontmatter::{canonical_digest, canonical_text};

/// Table and index setup, run on every open. Idempotent.
const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS bases(\
    item_id TEXT PRIMARY KEY, \
    text TEXT NOT NULL, \
    digest TEXT NOT NULL, \
    yjs_state BLOB, \
    updated_at INTEGER NOT NULL)";

/// Why a base store operation failed.
#[derive(Debug, thiserror::Error)]
pub enum BaseError {
    /// SQLite refused the operation.
    #[error("Base store database error: {0}")]
    Sql(#[from] rusqlite::Error),
    /// The `.weaveforge/local/` folder could not be created.
    #[error("Base store folder error: {0}")]
    Io(#[from] std::io::Error),
}

/// One stored base.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Base {
    /// Canonical text (LF line endings).
    pub text: String,
    /// Hex SHA-256 of the canonical text.
    pub digest: String,
    /// Encoded Yjs state, when the item had one.
    pub yjs_state: Option<Vec<u8>>,
    /// When the base was last written, in Unix milliseconds.
    pub updated_at: i64,
}

/// The per-device table of bases.
pub struct BaseStore {
    conn: rusqlite::Connection,
}

impl BaseStore {
    /// Open (creating if needed) the base store of the workspace at `workspace_root`.
    pub fn open(workspace_root: &Path) -> Result<Self, BaseError> {
        let dir = workspace_root.join(".weaveforge").join("local");
        fs::create_dir_all(&dir)?;
        Self::from_connection(rusqlite::Connection::open(dir.join("bases.sqlite"))?)
    }

    /// A throwaway store in memory, for tests.
    pub fn open_in_memory() -> Result<Self, BaseError> {
        Self::from_connection(rusqlite::Connection::open_in_memory()?)
    }

    fn from_connection(conn: rusqlite::Connection) -> Result<Self, BaseError> {
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    /// The stored base of `item_id`, if any.
    pub fn get(&self, item_id: &str) -> Result<Option<Base>, BaseError> {
        let base = self
            .conn
            .query_row(
                "SELECT text, digest, yjs_state, updated_at FROM bases WHERE item_id = ?1",
                [item_id],
                |row| {
                    Ok(Base {
                        text: row.get(0)?,
                        digest: row.get(1)?,
                        yjs_state: row.get(2)?,
                        updated_at: row.get(3)?,
                    })
                },
            )
            .optional()?;
        Ok(base)
    }

    /// Store `text` (canonicalised) as the base of `item_id`; returns its digest. A `None`
    /// `yjs_state` keeps the stored state only while the text digest is unchanged; once the
    /// text changes, the state given (or none) replaces it, so a stale state is never kept.
    pub fn set(
        &self,
        item_id: &str,
        text: &str,
        yjs_state: Option<&[u8]>,
    ) -> Result<String, BaseError> {
        let digest = canonical_digest(text);
        self.conn.execute(
            "INSERT INTO bases (item_id, text, digest, yjs_state, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5) \
             ON CONFLICT(item_id) DO UPDATE SET \
             text = excluded.text, digest = excluded.digest, \
             yjs_state = CASE WHEN excluded.digest = bases.digest \
                 THEN COALESCE(excluded.yjs_state, bases.yjs_state) \
                 ELSE excluded.yjs_state END, \
             updated_at = excluded.updated_at",
            rusqlite::params![item_id, canonical_text(text), digest, yjs_state, now_ms()],
        )?;
        Ok(digest)
    }

    /// Drop the base of `item_id`; true when one was there.
    pub fn remove(&self, item_id: &str) -> Result<bool, BaseError> {
        let removed = self
            .conn
            .execute("DELETE FROM bases WHERE item_id = ?1", [item_id])?;
        Ok(removed > 0)
    }
}

/// Current time in Unix milliseconds; 0 if the clock is before 1970.
fn now_ms() -> i64 {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis());
    i64::try_from(ms).unwrap_or(i64::MAX)
}
