//! The local database on a native Postgres child process (step 5.3d), replacing PGlite in the Node
//! sidecar.
//!
//! - `server`: finds the Postgres binaries, creates the data dir, starts and stops the server.
//! - `wire`: a small client that asks for text results, so values match what PGlite returned.
//! - `value`: turns Postgres text values into the JSON the app already reads, and JSON params into text.
//! - `db`: the app's database rules: migrations, queries run as a user under RLS, the device user.
//! - `host`: the database as the app sees it: lazy open, queries as the device user, state, reset.
//! - `import`: a one-time copy of an old PGlite database into the new one.
//! - `backup`: `pg_dump` copies of the database and which of them to keep.
//! - `comspec`: runs `initdb`'s shell commands without the user's cmd AutoRun.

pub mod backup;
pub mod comspec;
pub mod db;
pub mod host;
pub mod import;
pub mod server;
pub mod value;
pub mod wire;

/// A Postgres error, with its SQLSTATE code when the server sent one.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct PgError {
    /// The SQLSTATE code, such as `42P01`; empty for errors not from the server (I/O, protocol).
    pub code: String,
    /// The server's message, or a description of the local failure.
    pub message: String,
}

impl PgError {
    /// An error that did not come from the server.
    #[must_use]
    pub fn local(message: impl Into<String>) -> Self {
        Self {
            code: String::new(),
            message: message.into(),
        }
    }

    /// The connection broke (socket error, server gone, stream out of sync). SQLSTATE `08006`,
    /// connection failure, so callers can tell it from a statement error.
    #[must_use]
    pub fn connection(message: impl Into<String>) -> Self {
        Self {
            code: "08006".to_owned(),
            message: message.into(),
        }
    }

    /// Whether the connection is unusable after this error (SQLSTATE class `08`).
    #[must_use]
    pub fn is_connection(&self) -> bool {
        self.code.starts_with("08")
    }
}

/// One result column: its name and Postgres type OID.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Column {
    /// The column name as the server sent it.
    pub name: String,
    /// The type OID, such as 25 for text.
    pub type_oid: u32,
}

/// Rows in text format: each cell is the server's text output, or `None` for SQL null.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TextRows {
    /// The result columns, in order.
    pub columns: Vec<Column>,
    /// The rows; each has one cell per column.
    pub rows: Vec<Vec<Option<String>>>,
}

/// A connection the database rules run on. `wire::PgConn` is the real one; tests use a fake.
pub trait Conn: Send {
    /// Runs one or more statements with no params (simple query protocol); results are dropped.
    fn exec(&mut self, sql: &str) -> impl std::future::Future<Output = Result<(), PgError>> + Send;

    /// Runs one statement with JSON params, sent as text the way PGlite sent them for each
    /// param's type (`value::param_to_text`); returns rows in text format.
    fn query(
        &mut self,
        sql: &str,
        params: &[serde_json::Value],
    ) -> impl std::future::Future<Output = Result<TextRows, PgError>> + Send;
}
