//! HTTP status for each error kind (TS `packages/core/src/shared/errors.ts`).
//! The classes that name the kinds stay in TS; only the kind-to-status map is here.

/// The error kinds the TS taxonomy has, one per branch. Anything else is a server error.
#[must_use]
pub fn http_status_for_kind(kind: &str) -> u16 {
    match kind {
        "not-found" => 404,
        "permission" => 403,
        "conflict" => 409,
        "validation" => 400,
        _ => 500,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_kind_maps_to_its_status() {
        // it: httpStatusForError maps each branch
        assert_eq!(http_status_for_kind("not-found"), 404);
        assert_eq!(http_status_for_kind("permission"), 403);
        assert_eq!(http_status_for_kind("conflict"), 409);
        assert_eq!(http_status_for_kind("validation"), 400);
    }

    #[test]
    fn an_unknown_kind_is_a_server_error() {
        // it: nothing else guesses
        assert_eq!(http_status_for_kind("internal"), 500);
        assert_eq!(http_status_for_kind(""), 500);
        assert_eq!(http_status_for_kind("Validation"), 500);
    }
}
