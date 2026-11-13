//! Paths a page may name inside a TeX build directory (wf-core `tex_path`). Pure: the desktop
//! shell does the writing. Parity with the former TypeScript `safeRelative` in
//! `apps/desktop/src/tex.ts`.

/// Normalise `candidate` to a relative path inside the build directory, or refuse it.
///
/// Backslashes become `/`, one leading `./` is dropped, and the result is refused if it is
/// empty, absolute, starts with a drive letter, or has a `..` or empty segment. A final segment
/// named `latexmkrc` or `.latexmkrc` (any case) is refused too: latexmk would run it as Perl.
///
/// # Errors
///
/// Returns the reader-facing refusal message, naming `candidate` as given.
pub fn safe_relative(candidate: &str) -> Result<String, String> {
    let slashed = candidate.replace('\\', "/");
    let normalized = slashed.strip_prefix("./").unwrap_or(&slashed);
    if normalized.is_empty()
        || normalized.starts_with('/')
        || has_drive_letter(normalized)
        || normalized
            .split('/')
            .any(|part| part == ".." || part.is_empty())
    {
        return Err(format!(
            "Refusing to write '{candidate}': it leaves the build directory."
        ));
    }
    if is_latexmkrc(normalized) {
        return Err(format!(
            "Refusing to write '{candidate}': latexmk would run it as a script."
        ));
    }
    Ok(normalized.to_owned())
}

/// `C:` at the start, as the JavaScript `/^[A-Za-z]:/` matches it.
fn has_drive_letter(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

/// The last segment is `latexmkrc` or `.latexmkrc`, ignoring ASCII case.
fn is_latexmkrc(path: &str) -> bool {
    let last = path.rsplit('/').next().unwrap_or(path);
    last.eq_ignore_ascii_case("latexmkrc") || last.eq_ignore_ascii_case(".latexmkrc")
}

#[cfg(test)]
mod tests {
    use super::safe_relative;

    fn refused(candidate: &str) -> String {
        match safe_relative(candidate) {
            Err(message) => message,
            Ok(path) => panic!("expected refusal for {candidate:?}, got {path:?}"),
        }
    }

    #[test]
    fn keeps_ordinary_relative_paths() {
        assert_eq!(safe_relative("main.tex"), Ok("main.tex".to_owned()));
        assert_eq!(safe_relative("figs/a.pdf"), Ok("figs/a.pdf".to_owned()));
        assert_eq!(safe_relative("1:x.tex"), Ok("1:x.tex".to_owned()));
    }

    #[test]
    fn strips_one_leading_dot_slash() {
        assert_eq!(safe_relative("./main.tex"), Ok("main.tex".to_owned()));
        assert_eq!(safe_relative("././x.tex"), Ok("./x.tex".to_owned()));
    }

    #[test]
    fn backslashes_are_separators() {
        assert_eq!(
            safe_relative("sub\\chap.tex"),
            Ok("sub/chap.tex".to_owned())
        );
        assert!(refused("..\\..\\x.tex").contains("leaves the build directory"));
        assert!(refused("sub\\..\\..\\x.tex").contains("leaves the build directory"));
    }

    #[test]
    fn drive_letters_are_refused() {
        assert!(refused("C:\\x.tex").contains("leaves the build directory"));
        assert!(refused("c:x.tex").contains("leaves the build directory"));
        assert!(refused("C:").contains("leaves the build directory"));
    }

    #[test]
    fn traversal_is_refused() {
        assert!(refused("..").contains("leaves the build directory"));
        assert!(refused("../x.tex").contains("leaves the build directory"));
        assert!(refused("./../x.tex").contains("leaves the build directory"));
        assert!(refused("a/../b.tex").contains("leaves the build directory"));
    }

    #[test]
    fn empty_segments_are_refused() {
        assert!(refused("").contains("leaves the build directory"));
        assert!(refused("./").contains("leaves the build directory"));
        assert!(refused("a//b.tex").contains("leaves the build directory"));
        assert!(refused("a/").contains("leaves the build directory"));
    }

    #[test]
    fn absolute_paths_are_refused() {
        assert!(refused("/etc/passwd").contains("leaves the build directory"));
        assert!(refused("\\\\server\\share\\x.tex").contains("leaves the build directory"));
    }

    #[test]
    fn latexmkrc_is_refused_in_any_case_and_directory() {
        for name in [
            "latexmkrc",
            ".latexmkrc",
            "LaTeXmkRc",
            "sub/.latexmkrc",
            "sub\\LATEXMKRC",
        ] {
            assert!(
                refused(name).contains("latexmk would run it as a script"),
                "{name}"
            );
        }
    }

    #[test]
    fn similar_names_are_not_latexmkrc() {
        assert_eq!(safe_relative("mylatexmkrc"), Ok("mylatexmkrc".to_owned()));
        assert_eq!(
            safe_relative("latexmkrc.tex"),
            Ok("latexmkrc.tex".to_owned())
        );
        assert_eq!(
            safe_relative("notes/latexmkrc.txt"),
            Ok("notes/latexmkrc.txt".to_owned())
        );
    }

    #[test]
    fn refusal_names_the_candidate_as_given() {
        assert_eq!(
            refused("./a\\..\\b"),
            "Refusing to write './a\\..\\b': it leaves the build directory."
        );
        assert_eq!(
            refused("sub/latexmkrc"),
            "Refusing to write 'sub/latexmkrc': latexmk would run it as a script."
        );
    }
}
