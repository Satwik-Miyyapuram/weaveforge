//! PDF source-ladder order: which resolvers to try, and in what order. A port of the ordering in
//! `packages/core/src/reader/parts.ts` (`resolvePdfSource`).
//!
//! Stays in TS: calling each resolver's async `resolve`, trimming the hit, and treating a throw or
//! a miss as "try the next one". The order never changes: callers register cost-bearing sources
//! last, and the plan keeps that registration order.

use serde::Serialize;

/// Indexes of the resolvers that support the paper, in registration order.
///
/// `supports[i]` is whether resolver `i` supports the paper. Unsupported resolvers are skipped,
/// so the result is the order in which the TS runner tries them.
#[must_use]
pub fn ladder_order(supports: &[bool]) -> Vec<usize> {
    supports
        .iter()
        .enumerate()
        .filter_map(|(index, &supported)| supported.then_some(index))
        .collect()
}

/// One rung of the PDF source ladder (TS resolver classes in `@weaveforge/core`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum PdfSourceKind {
    /// Bytes already in the app's PDF cache.
    Cache,
    /// Open-access URL resolved from the paper's links and arXiv id.
    OpenAccess,
    /// A file in the workspace's GitHub repo (desktop shell only).
    GithubRepo,
    /// WebDAV copy. Always last; it refuses until a proxy route exists.
    WebDav,
}

/// The default ladder, highest priority first: cache (when present), open access, GitHub repo
/// (when the desktop shell has one), WebDAV. PDFs are never stored on our server, so there is no
/// our-storage rung.
#[must_use]
pub fn default_resolver_order(has_cache: bool, has_github: bool) -> Vec<PdfSourceKind> {
    let mut order = Vec::with_capacity(4);
    if has_cache {
        order.push(PdfSourceKind::Cache);
    }
    order.push(PdfSourceKind::OpenAccess);
    if has_github {
        order.push(PdfSourceKind::GithubRepo);
    }
    order.push(PdfSourceKind::WebDav);
    order
}

#[cfg(test)]
mod tests {
    use super::{PdfSourceKind, default_resolver_order, ladder_order};

    #[test]
    fn keeps_registration_order_and_skips_unsupported() {
        assert_eq!(ladder_order(&[true, false, true, true]), vec![0, 2, 3]);
    }

    #[test]
    fn default_order_puts_cache_first_and_webdav_last() {
        use PdfSourceKind::{Cache, GithubRepo, OpenAccess, WebDav};
        assert_eq!(
            default_resolver_order(true, true),
            vec![Cache, OpenAccess, GithubRepo, WebDav]
        );
        assert_eq!(
            default_resolver_order(false, false),
            vec![OpenAccess, WebDav]
        );
    }

    #[test]
    fn no_supporting_resolver_gives_an_empty_plan() {
        assert_eq!(ladder_order(&[false, false]), Vec::<usize>::new());
        assert_eq!(ladder_order(&[]), Vec::<usize>::new());
    }
}
