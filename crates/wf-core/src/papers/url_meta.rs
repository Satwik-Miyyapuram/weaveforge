//! URL metadata rules for the paper link import. Port of `readInShell` in
//! apps/web/src/features/papers/infrastructure/url-metadata-source.ts: the address the desktop
//! relay is asked for, and the message shown when the relay refuses it. Pure: the caller fetches
//! the page and reads the relay's `error` text.

/// The address the desktop relay fetches for a typed value.
///
/// A value that already starts with a URL scheme (`^[a-z][a-z0-9+.-]*:`, any ASCII case) is kept
/// as it is. Anything else, such as `example.org/paper`, gets `https://` in front.
#[must_use]
pub fn shell_target(value: &str) -> String {
    if has_scheme(value) {
        value.to_owned()
    } else {
        format!("https://{value}")
    }
}

/// Whether `value` starts with an ASCII letter, then letters, digits, `+`, `.` or `-`, then `:`.
fn has_scheme(value: &str) -> bool {
    let mut chars = value.chars();
    if !chars.next().is_some_and(|c| c.is_ascii_alphabetic()) {
        return false;
    }
    for c in chars {
        if c == ':' {
            return true;
        }
        if !(c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-')) {
            return false;
        }
    }
    false
}

/// The message shown when the relay refuses a page.
///
/// `status` is the relay's HTTP status and `detail` is its `error` text, already trimmed and capped
/// by the caller; an empty `detail` means the relay gave none. 415 says the link is not a web page,
/// 400 shows the relay's own words or a fixed hint, 403 says the site refused, and any other status
/// says the page could not be read.
#[must_use]
pub fn read_failure_message(status: u16, detail: &str) -> String {
    match status {
        415 => format!(
            "That link is not a web page. If it is a PDF, add the paper by DOI or arXiv id and use Load PDF….{}",
            parenthesised(detail)
        ),
        400 if detail.is_empty() => "That address cannot be fetched. Use an https link.".to_owned(),
        400 => detail.to_owned(),
        403 => format!(
            "That site refused the request. Try the DOI or arXiv id instead.{}",
            parenthesised(detail)
        ),
        _ if detail.is_empty() => format!("Could not read that page ({status})."),
        _ => format!("Could not read that page: {detail}."),
    }
}

/// `" (detail)"` when there is a detail, otherwise nothing.
fn parenthesised(detail: &str) -> String {
    if detail.is_empty() {
        String::new()
    } else {
        format!(" ({detail})")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_typed_value_with_a_scheme_is_kept() {
        assert_eq!(
            shell_target("https://example.org/a"),
            "https://example.org/a"
        );
        assert_eq!(shell_target("HTTP://example.org/a"), "HTTP://example.org/a");
        assert_eq!(shell_target("doi:10.1000/x"), "doi:10.1000/x");
        assert_eq!(shell_target("a+b.c-d:x"), "a+b.c-d:x");
    }

    #[test]
    fn a_bare_host_gets_https() {
        assert_eq!(
            shell_target("example.org/paper"),
            "https://example.org/paper"
        );
        assert_eq!(shell_target("1abc:x"), "https://1abc:x");
        assert_eq!(shell_target("-x:y"), "https://-x:y");
        assert_eq!(shell_target(""), "https://");
    }

    #[test]
    fn a_non_ascii_letter_does_not_count_as_a_scheme() {
        assert_eq!(shell_target("é:x"), "https://é:x");
    }

    #[test]
    fn a_pdf_link_says_it_is_not_a_web_page_with_the_relay_detail() {
        assert_eq!(
            read_failure_message(415, ""),
            "That link is not a web page. If it is a PDF, add the paper by DOI or arXiv id and use Load PDF…."
        );
        assert_eq!(
            read_failure_message(415, "text/pdf"),
            "That link is not a web page. If it is a PDF, add the paper by DOI or arXiv id and use Load PDF…. (text/pdf)"
        );
    }

    #[test]
    fn a_bad_address_shows_the_relay_words_or_a_hint() {
        assert_eq!(
            read_failure_message(400, ""),
            "That address cannot be fetched. Use an https link."
        );
        assert_eq!(read_failure_message(400, "Host blocked"), "Host blocked");
    }

    #[test]
    fn a_refused_site_points_to_doi_or_arxiv() {
        assert_eq!(
            read_failure_message(403, ""),
            "That site refused the request. Try the DOI or arXiv id instead."
        );
        assert_eq!(
            read_failure_message(403, "Forbidden"),
            "That site refused the request. Try the DOI or arXiv id instead. (Forbidden)"
        );
    }

    #[test]
    fn any_other_status_says_the_page_could_not_be_read() {
        assert_eq!(
            read_failure_message(502, ""),
            "Could not read that page (502)."
        );
        assert_eq!(
            read_failure_message(500, "boom"),
            "Could not read that page: boom."
        );
    }
}
