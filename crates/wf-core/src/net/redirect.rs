//! Redirect and body-size decisions for the outbound fetch (TS `apps/web/src/backend/net/safe-fetch.ts`).
//! Pure: the pinned request, the DNS check, the address dial and the body read stay in TS. This
//! decides what a response means for the redirect loop and whether a declared length is over the cap.
//! URL joining is not done here: TS resolves the `location` header with WHATWG `new URL(location, base)`
//! and passes the resolved href in, so the address that gets checked is the one the runtime follows.

const NOWHERE: &str = "That site redirected to nowhere.";
const TOO_MANY: &str = "That address redirected too many times.";
const UNREADABLE_PREFIX: &str = "That site redirected somewhere unreadable: ";

/// What a response means for the redirect loop (TS `safeFetch`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RedirectStep {
    /// Not a redirect: the caller reads the response as the final answer.
    NotRedirect,
    /// Follow the redirect to this absolute URL, which the loop checks and pins again.
    Follow {
        /// The absolute URL to request next.
        url: String,
    },
    /// The redirect cannot be followed; the message is shown to the visitor.
    Failed {
        /// The text shown to the visitor.
        message: String,
    },
}

/// Decides the next step after a response.
///
/// `location` is the raw `location` header, `None` when absent (an empty value counts as absent, as
/// the TS `!location` did). `resolved` is that header resolved against the URL the response answered,
/// as the WHATWG `new URL(location, base).href` the TS side computed; `None` when the TS parse threw.
/// `hop` is the 0-based index in the loop with `max_redirects` as the budget. Once the budget is spent
/// a redirect is a failure, because following it would need one more request.
#[must_use]
pub fn next_redirect(
    status: u16,
    location: Option<&str>,
    resolved: Option<&str>,
    hop: u32,
    max_redirects: u32,
) -> RedirectStep {
    if !(300..400).contains(&status) {
        return RedirectStep::NotRedirect;
    }
    let Some(location) = location.filter(|value| !value.is_empty()) else {
        return failed(NOWHERE);
    };
    let Some(target) = resolved else {
        let shown: String = location.chars().take(200).collect();
        return failed(&format!("{UNREADABLE_PREFIX}{shown}"));
    };
    if hop >= max_redirects {
        return failed(TOO_MANY);
    }
    RedirectStep::Follow {
        url: target.to_owned(),
    }
}

/// True when the declared `content-length` is over the cap, so the body is refused before reading
/// (TS `readCapped`). The declared length is the encoded size and can be smaller than what arrives,
/// so this only ever refuses early; the byte count is still capped while reading.
#[must_use]
pub fn declared_length_over_cap(declared: f64, max_bytes: f64) -> bool {
    declared.is_finite() && declared > max_bytes
}

fn failed(message: &str) -> RedirectStep {
    RedirectStep::Failed {
        message: message.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_non_redirect_status_is_left_to_the_caller() {
        assert_eq!(
            next_redirect(200, Some("https://elsewhere.example/"), Some("https://elsewhere.example/"), 0, 4),
            RedirectStep::NotRedirect
        );
        assert_eq!(next_redirect(404, None, None, 0, 4), RedirectStep::NotRedirect);
    }

    #[test]
    fn a_redirect_without_a_location_fails_as_nowhere() {
        assert_eq!(next_redirect(302, None, None, 0, 4), failed(NOWHERE));
        assert_eq!(next_redirect(302, Some(""), None, 0, 4), failed(NOWHERE));
    }

    #[test]
    fn a_relative_location_is_followed_as_the_href_the_caller_resolved() {
        // The join is WHATWG `new URL(location, base)` in TS; Rust only follows the href it was given.
        assert_eq!(
            next_redirect(301, Some("/final"), Some("https://example.com/final"), 0, 4),
            RedirectStep::Follow {
                url: "https://example.com/final".to_owned()
            }
        );
    }

    #[test]
    fn an_unparseable_location_fails_with_the_text_shown() {
        // No resolved href means TS could not parse the location against the base.
        assert_eq!(
            next_redirect(302, Some("https://[bad"), None, 0, 4),
            failed("That site redirected somewhere unreadable: https://[bad")
        );
    }

    #[test]
    fn the_budget_stops_the_loop_on_the_last_hop() {
        assert_eq!(
            next_redirect(302, Some("/again"), Some("https://example.com/again"), 1, 2),
            RedirectStep::Follow {
                url: "https://example.com/again".to_owned()
            }
        );
        assert_eq!(
            next_redirect(302, Some("/again"), Some("https://example.com/again"), 2, 2),
            failed(TOO_MANY)
        );
    }

    #[test]
    fn a_declared_length_is_over_the_cap_only_above_it() {
        assert!(declared_length_over_cap(11.0, 10.0));
        assert!(!declared_length_over_cap(10.0, 10.0));
        assert!(!declared_length_over_cap(0.0, 10.0));
        assert!(!declared_length_over_cap(f64::NAN, 10.0));
    }
}
