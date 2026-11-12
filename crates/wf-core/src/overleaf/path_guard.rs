//! Checks on a git checkout's files before the Overleaf reader keeps them (port of `safeRelative`,
//! `TEXT_EXTENSIONS` and the size limits in apps/web/src/features/overleaf/infrastructure/overleaf-git-reader.ts).
//! The fs walk and the symlink skip stay in TS; these decide what the walk may keep.

/// Message for a checkout path that escapes the clone or is not a plain relative path.
pub const UNSAFE_CHECKOUT_PATH: &str = "Overleaf checkout contained an unsafe path.";

/// Most text files one checkout may contribute.
pub const MAX_FILES: usize = 250;

/// Largest single text file, in bytes.
pub const MAX_FILE_BYTES: f64 = 2_000_000.0;

/// Largest total of text files, in bytes.
pub const MAX_TOTAL_BYTES: f64 = 20_000_000.0;

/// Message when the checkout holds more text files than `MAX_FILES`.
pub const FILE_LIMIT_MESSAGE: &str = "Overleaf project exceeds the supported file limit.";

/// Message when a text file or the text total is over the byte limits.
pub const SIZE_LIMIT_MESSAGE: &str = "Overleaf project exceeds the supported text size limit.";

/// Extensions (lowercase, with the dot) the reader keeps as LaTeX source.
const TEXT_EXTENSIONS: [&str; 7] = [".tex", ".bib", ".sty", ".cls", ".txt", ".md", ".cfg"];

/// Why `path` is not a plain relative path inside the checkout, or `None` when it is safe.
///
/// Rejects an empty path, a leading `/`, any backslash, a drive letter (`C:`) and any `..`
/// segment. The TS walk passes a path already joined with `/`, so a backslash here is a
/// literal character in a file name and is refused too.
#[must_use]
pub fn unsafe_checkout_path_error(path: &str) -> Option<&'static str> {
    let drive_letter = {
        let bytes = path.as_bytes();
        bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
    };
    if path.is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || drive_letter
        || path.split('/').any(|segment| segment == "..")
    {
        Some(UNSAFE_CHECKOUT_PATH)
    } else {
        None
    }
}

/// Whether a file name is one the reader keeps as text: its extension (case-insensitive) is one of
/// `TEXT_EXTENSIONS`. A name with no dot, or a dot-only name such as `.tex`, has no extension.
#[must_use]
pub fn is_text_source_file(name: &str) -> bool {
    let Some(dot) = name.rfind('.') else {
        return false;
    };
    if dot == 0 {
        return false;
    }
    let extension = name[dot..].to_lowercase();
    TEXT_EXTENSIONS.contains(&extension.as_str())
}

/// The error when the walk has already kept `collected` text files and must stop, or `None`.
#[must_use]
pub fn file_count_error(collected: usize) -> Option<&'static str> {
    (collected >= MAX_FILES).then_some(FILE_LIMIT_MESSAGE)
}

/// The error when a text file of `size` bytes, added to `total_bytes` already kept, breaks a byte
/// limit, or `None`. Sizes are whole byte counts held as `f64` (exact below 2^53).
#[must_use]
pub fn text_size_error(size: f64, total_bytes: f64) -> Option<&'static str> {
    (size > MAX_FILE_BYTES || total_bytes + size > MAX_TOTAL_BYTES).then_some(SIZE_LIMIT_MESSAGE)
}

#[cfg(test)]
mod tests {
    use super::{
        FILE_LIMIT_MESSAGE, SIZE_LIMIT_MESSAGE, UNSAFE_CHECKOUT_PATH, file_count_error,
        is_text_source_file, text_size_error, unsafe_checkout_path_error,
    };

    // it: "the reader refuses a ../ escape"
    #[test]
    fn rejects_parent_segment_escape() {
        for bad in [
            "..",
            "../x.tex",
            "a/../b.tex",
            "a/..",
            "chapters/../../etc/passwd",
        ] {
            assert_eq!(
                unsafe_checkout_path_error(bad),
                Some(UNSAFE_CHECKOUT_PATH),
                "{bad}"
            );
        }
    }

    #[test]
    fn rejects_absolute_paths() {
        assert_eq!(
            unsafe_checkout_path_error("/etc/passwd"),
            Some(UNSAFE_CHECKOUT_PATH)
        );
    }

    #[test]
    fn rejects_backslashes() {
        for bad in ["a\\b.tex", "chapters\\one.tex", "..\\x.tex"] {
            assert_eq!(
                unsafe_checkout_path_error(bad),
                Some(UNSAFE_CHECKOUT_PATH),
                "{bad}"
            );
        }
    }

    #[test]
    fn rejects_drive_letters() {
        for bad in ["C:/x.tex", "c:x.tex", "Z:"] {
            assert_eq!(
                unsafe_checkout_path_error(bad),
                Some(UNSAFE_CHECKOUT_PATH),
                "{bad}"
            );
        }
    }

    #[test]
    fn rejects_empty_path() {
        assert_eq!(unsafe_checkout_path_error(""), Some(UNSAFE_CHECKOUT_PATH));
    }

    #[test]
    fn accepts_plain_relative_paths() {
        for ok in [
            "main.tex",
            "chapters/one.tex",
            "a..b.tex",
            "...x.tex",
            ".hidden/x.tex",
        ] {
            assert_eq!(unsafe_checkout_path_error(ok), None, "{ok}");
        }
    }

    #[test]
    fn keeps_latex_source_extensions_case_insensitively() {
        for ok in [
            "main.tex",
            "refs.BIB",
            "style.sty",
            "doc.cls",
            "a.txt",
            "README.md",
            "x.cfg",
            "A.TeX",
        ] {
            assert!(is_text_source_file(ok), "{ok}");
        }
    }

    #[test]
    fn drops_other_files_and_dot_only_names() {
        for bad in [
            ".tex",
            "figure.png",
            "archive.tar.gz",
            "README",
            "x.",
            "data.json",
        ] {
            assert!(!is_text_source_file(bad), "{bad}");
        }
    }

    #[test]
    fn refuses_the_file_past_the_count_limit() {
        assert_eq!(file_count_error(249), None);
        assert_eq!(file_count_error(250), Some(FILE_LIMIT_MESSAGE));
    }

    #[test]
    fn refuses_a_file_over_the_per_file_limit() {
        assert_eq!(text_size_error(2_000_000.0, 0.0), None);
        assert_eq!(text_size_error(2_000_001.0, 0.0), Some(SIZE_LIMIT_MESSAGE));
    }

    #[test]
    fn refuses_a_file_that_breaks_the_total_limit() {
        assert_eq!(text_size_error(1_000_000.0, 19_000_000.0), None);
        assert_eq!(
            text_size_error(1_000_001.0, 19_000_000.0),
            Some(SIZE_LIMIT_MESSAGE)
        );
    }
}
