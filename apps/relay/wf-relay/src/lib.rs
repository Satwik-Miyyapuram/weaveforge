//! Relays and pasted-link fetches: the requests a browser page cannot make itself.
//!
//! Shared by the desktop shell (`apps/shell`, served on the `app` scheme) and the
//! relay server (`apps/relay/server`, served over HTTP to the web app), so both run
//! one copy of the URL safety checks and upstream rules.

pub mod fetch;
pub mod relay;
pub mod tls;
