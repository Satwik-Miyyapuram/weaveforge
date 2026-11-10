//! Vault size-cap wording (port of `tooLarge` in `apps/shell/sidecar/src/vault-handlers.ts`).
//! The byte caps themselves stay as TypeScript constants next to the handlers that enforce them.

/// Bytes in one mebibyte, the unit the message names the cap in.
const MEBIBYTE: f64 = 1024.0 * 1024.0;

/// Said when a file is too big to cross the bridge. Names the cap that applied, in MB.
///
/// Matches JavaScript's number formatting for the whole and fractional MB values the caps use
/// (8 and 80 MiB), so the wording is unchanged from the TypeScript original.
#[must_use]
pub fn too_large_message(cap_bytes: f64) -> String {
    format!(
        "That file is too large to open here (over {} MB).",
        cap_bytes / MEBIBYTE
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_cap_in_whole_mb() {
        assert_eq!(
            too_large_message(8.0 * MEBIBYTE),
            "That file is too large to open here (over 8 MB)."
        );
        assert_eq!(
            too_large_message(80.0 * MEBIBYTE),
            "That file is too large to open here (over 80 MB)."
        );
    }

    #[test]
    fn keeps_a_fractional_mb_cap() {
        assert_eq!(
            too_large_message(0.5 * MEBIBYTE),
            "That file is too large to open here (over 0.5 MB)."
        );
    }
}
