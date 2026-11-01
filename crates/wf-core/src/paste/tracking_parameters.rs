//! Query parameters that identify the reader rather than the page, and the rules
//! for the sites whose own parameters are clutter.

/// Query parameters that identify the reader rather than the page.
///
/// The global list only holds names that mean "who sent you" in every context:
/// campaign tags and click identifiers minted by ad networks. A name that could
/// ever address content (`id`, `page`, `v`, `q`) belongs in a site rule, never
/// here, because this list runs against every URL in a paste including the DOI,
/// arXiv and publisher links a research note is mostly made of.
///
/// `*` is the only wildcard and matches any run of characters.
pub const TRACKING_PARAMETERS: &[&str] = &[
    // Google Analytics and the UTM convention everything else copied
    "utm_*",
    "ga_source",
    "ga_medium",
    "ga_term",
    "ga_content",
    "ga_campaign",
    "ga_place",
    // Click identifiers: one per ad network, all of them per-click
    "gclid",
    "gclsrc",
    "dclid",
    "gbraid",
    "wbraid",
    "fbclid",
    "msclkid",
    "twclid",
    "ttclid",
    "yclid",
    "ysclid",
    "epik",
    "rb_clickid",
    "irclickid",
    "cjevent",
    "awc",
    "sscid",
    "zanpid",
    "ranMID",
    "ranEAID",
    "ranSiteID",
    // Email and marketing platforms
    "mc_cid",
    "mc_eid",
    "mkt_tok",
    "_hsenc",
    "_hsmi",
    "hsa_*",
    "hsCtaTracking",
    "vero_conv",
    "vero_id",
    "ck_subscriber_id",
    "ml_subscriber",
    "ml_subscriber_hash",
    "oly_anon_id",
    "oly_enc_id",
    "_bhlid",
    // Self-hosted analytics that copied the convention
    "mtm_*",
    "pk_campaign",
    "pk_cid",
    "pk_content",
    "pk_keyword",
    "pk_kwd",
    "pk_medium",
    "pk_source",
    "pk_vid",
    "piwik_*",
    "matomo_*",
    "_openstat",
    "wickedid",
    "s_kwcid",
    "WT.mc_id",
];

/// A per-site rule: parameter names that only mean tracking on that host.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SiteParameterRemoval {
    /// Host the rule covers, including any subdomain of it.
    pub domain: String,
    /// True when the rule was written `google.*` and covers every TLD.
    pub any_tld: bool,
    /// Parameter names or `*` globs removed on this host.
    pub parameters: Vec<String>,
}

/// Builds one per-site rule from the fields of a TS literal.
fn rule(domain: &str, any_tld: bool, parameters: &[&str]) -> SiteParameterRemoval {
    SiteParameterRemoval {
        domain: domain.to_string(),
        any_tld,
        parameters: parameters.iter().map(|name| (*name).to_string()).collect(),
    }
}

/// Rules for the sites whose own parameters are clutter.
///
/// Deliberately conservative around anything scholarly: publisher hosts appear
/// only for parameters that are unambiguously campaign or referral tags, and no
/// rule here can touch a DOI, an arXiv identifier, a page number or a query.
#[must_use]
#[allow(clippy::too_many_lines, reason = "one flat data table")]
pub fn site_parameter_removals() -> Vec<SiteParameterRemoval> {
    vec![
        rule("youtube.com", false, &["si", "pp", "feature", "ab_channel"]),
        rule("youtu.be", false, &["si", "pp", "feature"]),
        rule(
            "google",
            true,
            &[
                "sca_esv", "sourceid", "client", "ei", "ved", "uact", "oq", "gs_l*", "sclient",
                "aqs", "biw", "bih", "sa", "usg",
            ],
        ),
        rule(
            "amazon",
            true,
            &[
                "pd_rd_*",
                "pf_rd_*",
                "qid",
                "sr",
                "sprefix",
                "crid",
                "dib",
                "dib_tag",
                "content-id",
                "sbo",
                "_encoding",
                "psc",
                "th",
                "linkCode",
                "creative",
                "creativeASIN",
                "ascsubtag",
            ],
        ),
        rule("twitter.com", false, &["s", "t", "ref_src", "ref_url"]),
        rule("x.com", false, &["s", "t", "ref_src", "ref_url"]),
        rule(
            "reddit.com",
            false,
            &[
                "share_id",
                "correlation_id",
                "ref",
                "ref_source",
                "rdt",
                "chainedPosts",
            ],
        ),
        rule(
            "facebook.com",
            false,
            &[
                "comment_tracking",
                "notif_t",
                "notif_id",
                "ref",
                "__tn__",
                "__cft__*",
            ],
        ),
        rule("instagram.com", false, &["igshid", "igsh", "img_index"]),
        rule(
            "linkedin.com",
            false,
            &[
                "trk",
                "trackingId",
                "originalSubdomain",
                "li_fat_id",
                "midToken",
                "midSig",
                "eid",
                "lipi",
                "licu",
            ],
        ),
        rule(
            "spotify.com",
            false,
            &["si", "nd", "context", "_branch_match_id"],
        ),
        rule("medium.com", false, &["source", "sk", "gi"]),
        rule(
            "substack.com",
            false,
            &[
                "r",
                "showWelcome",
                "triedRedirect",
                "publication_id",
                "post_id",
                "isFreemail",
            ],
        ),
        // Publishers: campaign and referral tags only. Article ids, DOIs and page
        // parameters are untouched.
        rule("sciencedirect.com", false, &["via", "dgcid", "rss"]),
        rule(
            "nature.com",
            false,
            &["WT.ec_id", "WT.mc_id", "sap-outbound-id", "error", "code"],
        ),
        rule("springer.com", false, &["error", "code", "sap-outbound-id"]),
        rule("wiley.com", false, &["af", "campaign", "PubDate"]),
        rule("tandfonline.com", false, &["scroll", "needAccess"]),
        rule("ieee.org", false, &["source", "sortType"]),
        rule("acm.org", false, &["cid"]),
    ]
}

/// Parameter sets that together make a cryptographic signature.
///
/// A URL carrying one of these is left byte for byte: removing any parameter
/// invalidates the signature, and the failure only shows up as a 403 when
/// somebody clicks the link months later.
pub const SIGNED_URL_PARAMETER_SETS: &[&[&str]] = &[
    &["X-Amz-Signature"],
    &["X-Goog-Signature"],
    &["sv", "sig"],
    &["Signature", "Expires", "AWSAccessKeyId"],
    &["Signature", "Expires", "GoogleAccessId"],
    &["Signature", "Expires", "KeyName"],
    &["Signature", "Expires", "Key-Pair-Id"],
    &["Signature", "Policy", "Key-Pair-Id"],
    &["token", "expires", "signature"],
];

/// True for the line terminators JS `.` refuses to cross.
fn is_line_terminator(ch: char) -> bool {
    matches!(ch, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// True when `gap` holds no line terminator, the only text a `*` may cover.
fn gap_is_plain(gap: &str) -> bool {
    !gap.chars().any(is_line_terminator)
}

/// Matches a lowercased `*` glob against a lowercased name.
///
/// Each `*` covers any run without a line terminator, as `^...$` with `.*` did.
fn glob_matches(pattern: &str, name: &str) -> bool {
    let mut parts = pattern.split('*');
    let Some(first) = parts.next() else {
        return false;
    };
    let remaining: Vec<&str> = parts.collect();
    let Some((last, middle)) = remaining.split_last() else {
        return false;
    };
    let Some(mut rest) = name.strip_prefix(first) else {
        return false;
    };
    // Leftmost occurrences leave the least text for the `*` before them.
    for part in middle {
        let Some(index) = rest.find(*part) else {
            return false;
        };
        if !gap_is_plain(rest.get(..index).unwrap_or_default()) {
            return false;
        }
        rest = rest.get(index + part.len()..).unwrap_or_default();
    }
    rest.strip_suffix(*last).is_some_and(gap_is_plain)
}

/// True when `name` matches a literal or `*` glob from `patterns`, case-insensitively.
#[must_use]
pub fn matches_parameter_pattern<S: AsRef<str>>(name: &str, patterns: &[S]) -> bool {
    let lower = name.to_lowercase();
    patterns.iter().any(|pattern| {
        let target = pattern.as_ref().to_lowercase();
        if !target.contains('*') {
            return lower == target;
        }
        glob_matches(&target, &lower)
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn literal_match_ignores_case() {
        assert!(matches_parameter_pattern("FBCLID", &["fbclid"]));
        assert!(!matches_parameter_pattern("fbclids", &["fbclid"]));
    }

    #[test]
    fn star_glob_covers_a_run() {
        assert!(matches_parameter_pattern("utm_source", &["utm_*"]));
        assert!(matches_parameter_pattern("UTM_", &["utm_*"]));
        assert!(matches_parameter_pattern("pd_rd_wg", &["pd_rd_*"]));
        assert!(!matches_parameter_pattern("ut_source", &["utm_*"]));
    }

    #[test]
    fn empty_name_and_empty_patterns() {
        assert!(matches_parameter_pattern("", &["*"]));
        assert!(!matches_parameter_pattern("", &["utm_*"]));
        let none: &[&str] = &[];
        assert!(!matches_parameter_pattern("utm_source", none));
    }

    #[test]
    fn non_ascii_names_match_by_character() {
        assert!(matches_parameter_pattern("ünïcode", &["*"]));
        assert!(matches_parameter_pattern("utm_é", &["utm_*"]));
        assert!(!matches_parameter_pattern("é", &["e"]));
    }

    #[test]
    fn star_does_not_cross_a_line_terminator() {
        // A percent-escaped newline decodes to a real one; JS `.*` stops there.
        assert!(!matches_parameter_pattern("utm_\nx", &["utm_*"]));
        assert!(!matches_parameter_pattern("utm_\u{2028}x", &["utm_*"]));
    }

    #[test]
    fn pattern_metacharacters_are_literal() {
        assert!(matches_parameter_pattern("a.b", &["a.*"]));
        assert!(!matches_parameter_pattern("axb", &["a.*"]));
        assert!(!matches_parameter_pattern("a+b", &["a+*c"]));
    }

    #[test]
    fn tables_hold_the_documented_entries() {
        assert!(TRACKING_PARAMETERS.contains(&"utm_*"));
        assert!(TRACKING_PARAMETERS.contains(&"WT.mc_id"));
        let google = site_parameter_removals()
            .into_iter()
            .find(|rule| rule.domain == "google")
            .expect("google rule");
        assert!(google.any_tld);
        assert_eq!(SIGNED_URL_PARAMETER_SETS.len(), 9);
    }
}
