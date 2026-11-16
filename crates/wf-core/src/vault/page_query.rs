//! Query text for vault-page reads over PostgREST (TS `postgrest-vault-page-repository.ts`).
//! Pure string building and the missing-column check; the HTTP call stays in TS.

/// Makes `%`, `_` and `\` match themselves in a LIKE pattern.
#[must_use]
pub fn escape_like(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if matches!(c, '\\' | '%' | '_') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Escapes a value for PostgREST's double-quoted form: `\` and `"` are read once before LIKE sees them.
fn quote_postgrest_value(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if matches!(c, '\\' | '"') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// The `or=` filter for a case-insensitive substring match on title or body.
///
/// Two escapes, in order: LIKE's (`\ % _` are text), then PostgREST's double-quoted value
/// (`\ "`). `None` for an empty query, which means no filter.
#[must_use]
pub fn title_or_body_filter(query: &str) -> Option<String> {
    if query.is_empty() {
        return None;
    }
    let like = format!("%{}%", escape_like(query));
    let quoted = quote_postgrest_value(&like);
    Some(format!("title.ilike.\"{quoted}\",body.ilike.\"{quoted}\""))
}

/// The ILIKE pattern that narrows candidates for a normalised title key: each space-separated
/// word is escaped and the runs are joined by `%`, since whitespace runs may differ in the stored title.
#[must_use]
pub fn title_like_pattern(key: &str) -> String {
    key.split(' ')
        .map(escape_like)
        .collect::<Vec<_>>()
        .join("%")
}

/// Whether a PostgREST error means the `body_preview` column is not migrated yet.
#[must_use]
pub fn is_missing_body_preview_column(message: Option<&str>, code: Option<&str>) -> bool {
    let msg = message.unwrap_or("").to_lowercase();
    msg.contains("body_preview") && (msg.contains("column") || code == Some("42703"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_like_prefixes_wildcards_and_backslash() {
        assert_eq!(escape_like(r"a\b%c_d"), r"a\\b\%c\_d");
        assert_eq!(escape_like("plain"), "plain");
    }

    #[test]
    fn empty_query_has_no_filter() {
        assert_eq!(title_or_body_filter(""), None);
    }

    #[test]
    fn filter_treats_double_quotes_as_text() {
        assert_eq!(
            title_or_body_filter(r#""hi""#).as_deref(),
            Some(r#"title.ilike."%\"hi\"%",body.ilike."%\"hi\"%""#)
        );
    }

    #[test]
    fn filter_treats_wildcards_and_backslash_as_text() {
        assert_eq!(
            title_or_body_filter("0%").as_deref(),
            Some(r#"title.ilike."%0\\%%",body.ilike."%0\\%%""#)
        );
    }

    #[test]
    fn filter_keeps_comma_and_parenthesis_inside_the_value() {
        assert_eq!(
            title_or_body_filter(", (b)").as_deref(),
            Some(r#"title.ilike."%, (b)%",body.ilike."%, (b)%""#)
        );
    }

    #[test]
    fn title_pattern_joins_words_with_wildcards() {
        assert_eq!(title_like_pattern("deep learning"), "deep%learning");
        assert_eq!(title_like_pattern(r"100% 'done'_x"), r"100\%%'done'\_x");
    }

    #[test]
    fn missing_body_preview_column_by_message_or_code() {
        assert!(is_missing_body_preview_column(
            Some("column vault_pages.body_preview does not exist"),
            None
        ));
        assert!(is_missing_body_preview_column(
            Some("body_preview"),
            Some("42703")
        ));
        assert!(!is_missing_body_preview_column(
            Some("body_preview missing"),
            None
        ));
        assert!(!is_missing_body_preview_column(Some("nope"), Some("42703")));
        assert!(!is_missing_body_preview_column(None, None));
    }
}
