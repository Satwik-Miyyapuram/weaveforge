//! Reader-facing messages for the local Zotero API, and the status a `Response`
//! can carry (TS `features/papers/infrastructure/zotero-local.ts`).
//!
//! The fetch and the desktop bridge stay in TS; only the pure status rules live here.

/// What a 403 from the local API means, in full. Zotero 7 serves the local API only
/// when a hidden preference is on, and it is read once at startup, so the message
/// names the preference, where it lives, and the restart it needs.
pub const ZOTERO_LOCAL_API_OFF: &str = "Zotero is running but its local API is switched off (it answered 403). In Zotero open Settings → Advanced → Config Editor and set extensions.zotero.httpServer.localAPI.enabled to true, then restart Zotero. The setting is read only at startup, so it does nothing until Zotero restarts.";

/// The reader-facing message for a status the local API answered with, or `None`
/// when the status needs no message.
#[must_use]
#[allow(
    clippy::float_cmp,
    reason = "a status code from the shell is a whole number"
)]
pub fn zotero_local_status_message(status: f64) -> Option<String> {
    if status == 403.0 {
        Some(ZOTERO_LOCAL_API_OFF.to_owned())
    } else {
        None
    }
}

/// A status a `Response` can be built with. Anything outside 200–599, anything that
/// is not a whole number, and 204, 205 and 304 (which `Response` refuses) become
/// 500; the real code travels in a header on the TS side.
#[must_use]
pub fn usable_status(status: f64) -> u16 {
    if !(200.0..=599.0).contains(&status) {
        return 500;
    }
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "the range is checked above"
    )]
    let code = status as u16;
    if f64::from(code) != status || matches!(code, 204 | 205 | 304) {
        return 500;
    }
    code
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_403_has_a_message() {
        assert_eq!(
            zotero_local_status_message(403.0),
            Some(ZOTERO_LOCAL_API_OFF.to_owned())
        );
        assert_eq!(zotero_local_status_message(404.0), None);
        assert_eq!(zotero_local_status_message(500.0), None);
    }

    #[test]
    fn usable_status_maps_unconstructible_codes_to_500() {
        assert_eq!(usable_status(304.0), 500);
        assert_eq!(usable_status(204.0), 500);
        assert_eq!(usable_status(205.0), 500);
        assert_eq!(usable_status(1000.0), 500);
        assert_eq!(usable_status(199.0), 500);
        assert_eq!(usable_status(200.5), 500);
        assert_eq!(usable_status(f64::NAN), 500);
    }

    #[test]
    fn usable_status_keeps_constructible_codes() {
        assert_eq!(usable_status(200.0), 200);
        assert_eq!(usable_status(404.0), 404);
        assert_eq!(usable_status(599.0), 599);
    }
}
