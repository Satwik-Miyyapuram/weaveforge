//! Cleaning and checking a paper's edited fields (TS `UpdatePaperUseCase`).
//!
//! The use case keeps the I/O (load, save, queue) and the error wording; these
//! rules decide what a stored value becomes.

/// The title with its whitespace collapsed and trimmed; `None` when nothing is left.
#[must_use]
pub fn clean_title(title: &str) -> Option<String> {
    non_blank(title.split_whitespace().collect::<Vec<_>>().join(" "))
}

/// The summary trimmed (markdown kept verbatim); `None` when blank, which clears it.
#[must_use]
pub fn clean_summary(summary: &str) -> Option<String> {
    non_blank(summary.trim().to_owned())
}

/// The image's storage path trimmed; `None` when blank.
#[must_use]
pub fn clean_image_path(path: &str) -> Option<String> {
    non_blank(path.trim().to_owned())
}

/// The PDF address trimmed; `None` when absent or blank, which clears it.
#[must_use]
pub fn clean_pdf_address(url: Option<&str>) -> Option<String> {
    non_blank(url?.trim().to_owned())
}

/// Whether a rating is within 1 to 5. Mirrors the TS check `rating < 1 || rating > 5`, so NaN passes.
#[must_use]
pub fn rating_in_range(rating: f64) -> bool {
    !(rating < 1.0 || rating > 5.0)
}

/// Whether a PDF address starts with `https://`, in any letter case.
#[must_use]
pub fn is_https_address(url: &str) -> bool {
    url.get(..8)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("https://"))
}

fn non_blank(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // it: "setTitle collapses whitespace and refuses a blank title"
    fn set_title_collapses_whitespace_and_refuses_blank() {
        assert_eq!(
            clean_title("  Attention   Is All\nYou Need ").as_deref(),
            Some("Attention Is All You Need")
        );
        assert_eq!(clean_title("   "), None);
    }

    #[test]
    // it: "setRating validates range"
    fn set_rating_validates_range() {
        assert!(!rating_in_range(9.0));
        assert!(rating_in_range(4.0));
    }

    #[test]
    // it: "setSummary accepts long text (no word cap)"
    fn set_summary_accepts_long_text() {
        let long = vec!["disentanglement"; 251].join(" ");
        assert_eq!(clean_summary(&long).as_deref(), Some(long.as_str()));
    }

    #[test]
    // it: "setSummary clears with empty string and keeps markdown verbatim"
    fn set_summary_clears_blank_and_keeps_markdown() {
        let md = "**Key idea:** factorized posterior\n- MIG 0.41\n- `beta=4`";
        assert_eq!(clean_summary(md).as_deref(), Some(md));
        assert_eq!(clean_summary("   "), None);
    }

    #[test]
    // it: "setPdfSource keeps a typed PDF address as the paper's open-access copy"
    fn set_pdf_source_keeps_a_typed_address_and_clears_blank() {
        assert_eq!(
            clean_pdf_address(Some("  https://repo.example/paper.pdf ")).as_deref(),
            Some("https://repo.example/paper.pdf")
        );
        assert_eq!(clean_pdf_address(Some("")), None);
        assert_eq!(clean_pdf_address(None), None);
    }

    #[test]
    // it: "setPdfSource refuses anything but https"
    fn set_pdf_source_refuses_anything_but_https() {
        assert!(!is_https_address("http://repo.example/paper.pdf"));
        assert!(!is_https_address("file:///C:/paper.pdf"));
        assert!(is_https_address("https://repo.example/paper.pdf"));
        assert!(is_https_address("HTTPS://repo.example/paper.pdf"));
    }

    #[test]
    // it: "addImage rejects empty path"
    fn add_image_rejects_empty_path() {
        assert_eq!(clean_image_path("  "), None);
        assert_eq!(clean_image_path(" u1/p1/fig1.webp ").as_deref(), Some("u1/p1/fig1.webp"));
    }
}
