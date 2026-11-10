//! One application log entry as one line of text (wf-core `app_log_line`). The panel and the
//! log file show the same text. Parity with the former TypeScript `formatLogLine` in
//! `apps/desktop/src/main-app-log.ts`.

/// Format one entry as `<stamp> <LEVEL> [<source>] <message>`, with the detail, when present,
/// on following lines indented four spaces.
///
/// The timestamp loses the first `T` and the first `Z`. The level is upper-cased and padded to
/// five UTF-16 units. An empty detail is the same as no detail.
#[must_use]
pub fn format_log_line(
    at: &str,
    level: &str,
    source: &str,
    message: &str,
    detail: Option<&str>,
) -> String {
    let stamp = at.replacen('T', " ", 1).replacen('Z', "", 1);
    let level = pad_end(&level.to_uppercase(), 5);
    let head = format!("{stamp} {level} [{source}] {message}");
    match detail.filter(|detail| !detail.is_empty()) {
        Some(detail) => format!("{head}\n    {}", detail.replace('\n', "\n    ")),
        None => head,
    }
}

/// `String.prototype.padEnd` with spaces: the width counts UTF-16 code units.
fn pad_end(text: &str, width: usize) -> String {
    let mut out = text.to_owned();
    for _ in text.encode_utf16().count()..width {
        out.push(' ');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::format_log_line;

    #[test]
    fn formats_stamp_level_source_and_message() {
        assert_eq!(
            format_log_line(
                "2026-01-02T03:04:05.000Z",
                "info",
                "renderer",
                "hello",
                None
            ),
            "2026-01-02 03:04:05.000 INFO  [renderer] hello"
        );
    }

    #[test]
    fn pads_each_level_to_five() {
        assert_eq!(
            format_log_line("T", "error", "s", "m", None),
            "  ERROR [s] m"
        );
        assert_eq!(
            format_log_line("T", "warn", "s", "m", None),
            "  WARN  [s] m"
        );
    }

    #[test]
    fn replaces_only_the_first_t_and_z() {
        assert_eq!(
            format_log_line("2026T1ZT2Z", "info", "s", "m", None),
            "2026 1T2Z INFO  [s] m"
        );
    }

    #[test]
    fn empty_detail_is_no_detail() {
        assert_eq!(
            format_log_line("T", "info", "s", "m", Some("")),
            format_log_line("T", "info", "s", "m", None)
        );
    }

    #[test]
    fn detail_is_indented_on_every_line() {
        assert_eq!(
            format_log_line("T", "error", "net", "failed", Some("GET /x\n404\nbody")),
            "  ERROR [net] failed\n    GET /x\n    404\n    body"
        );
    }

    #[test]
    fn message_is_not_altered() {
        assert_eq!(
            format_log_line("T", "info", "s", "a\nb", None),
            "  INFO  [s] a\nb"
        );
    }
}
