//! Retired routes: personal-row routes whose tables 1.0.0 drops answer 410.
//!
//! Since 0.9.7 these records live in the workspace files, so the server no longer
//! serves them. The answer comes before any auth or database call, so it says
//! nothing about the caller or their rows. The old handler modules stay compiled
//! (mounted only by [`crate::routes::retired_app`], for their tests) until the
//! 1.0.0 drop deletes them with their tables.

use axum::response::Response;

use crate::sdk::error_response;

/// What a retired route says.
pub const MOVED: &str = "This feature moved to your workspace files.";

/// Any method on a retired route: 410 Gone.
pub async fn gone() -> Response {
    error_response(410, MOVED)
}
