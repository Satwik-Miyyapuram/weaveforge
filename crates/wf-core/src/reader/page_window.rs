//! Which rendered PDF pages to free as the reader scrolls. A port of
//! `apps/web/src/features/reader/ui/pdf-reader/pdf-page-window.ts` (`pagesToEvict`).
//! The idle scheduling helper there stays in TS.

/// Pages farther than this from every visible page are evicted by default in the TS wrapper.
pub const PDF_KEEP_RADIUS: f64 = 3.0;

/// The rendered pages more than `radius` pages from every visible page, sorted ascending.
///
/// Duplicates in `rendered` are reported once. With no visible page nothing is evicted.
#[must_use]
pub fn pages_to_evict(rendered: &[f64], visible: &[f64], radius: f64) -> Vec<f64> {
    if visible.is_empty() {
        return Vec::new();
    }
    let mut pages = rendered.to_vec();
    // `total_cmp` orders -0 before 0, and `dedup` (==) then folds them together.
    pages.sort_by(f64::total_cmp);
    pages.dedup();
    pages
        .into_iter()
        .filter(|&page| {
            let nearest = visible
                .iter()
                .map(|&v| (page - v).abs())
                .fold(f64::INFINITY, f64::min);
            nearest > radius
        })
        .collect()
}
