//! Git's own error lines out of a failed command's text. Port of `gitReason` in
//! `apps/shell/sidecar/src/vault-git.ts`; reading the text off the error stays in TypeScript.

/// The `fatal:` and `error:` lines joined by a space; else the first line; else "Could not commit.".
#[must_use]
pub fn git_reason(text: &str) -> String {
    let lines = split_lines(text);
    let errors: Vec<&str> = lines
        .iter()
        .copied()
        .filter(|line| line.starts_with("fatal:") || line.starts_with("error:"))
        .collect();
    if !errors.is_empty() {
        return errors.join(" ");
    }
    match lines.first() {
        Some(first) if !first.is_empty() => (*first).to_owned(),
        _ => "Could not commit.".to_owned(),
    }
}

/// JS `split(/\r?\n/)`: break on `\n` and drop one `\r` before each break. A trailing `\r`
/// with no `\n` after it stays, as it does in JS.
fn split_lines(text: &str) -> Vec<&str> {
    let pieces: Vec<&str> = text.split('\n').collect();
    let last = pieces.len() - 1;
    pieces
        .iter()
        .enumerate()
        .map(|(i, piece)| {
            if i < last {
                piece.strip_suffix('\r').unwrap_or(piece)
            } else {
                piece
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_error_lines_are_joined() {
        assert_eq!(
            git_reason("Running git\nfatal: a bad ref\nerror: push rejected\nnoise"),
            "fatal: a bad ref error: push rejected"
        );
    }

    #[test]
    fn crlf_line_ends_are_split_like_js() {
        assert_eq!(git_reason("warn\r\nfatal: x\r\n"), "fatal: x");
        assert_eq!(git_reason("a\r"), "a\r");
    }

    #[test]
    fn without_git_lines_the_first_line_is_used() {
        assert_eq!(git_reason("index.lock exists"), "index.lock exists");
        assert_eq!(git_reason("first\nsecond"), "first");
    }

    #[test]
    fn empty_or_blank_first_line_gives_the_default() {
        assert_eq!(git_reason(""), "Could not commit.");
        assert_eq!(git_reason("\nhello"), "Could not commit.");
    }
}
