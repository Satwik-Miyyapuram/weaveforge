//! Ports the pure SQL-text helpers of `apps/web/src/backend/providers/local/pglite-client.ts`:
//! the `text[]` literal, the column-name check, the `select` projection, the `is`
//! operand and the top-level comma split of a PostgREST `or()` expression. The
//! JS value encoding and the PGlite runtime stay in TypeScript.

/// The backslash, written as an escape so no literal backslash appears in the source.
const BACKSLASH: char = '\x5c';

/// A Postgres array literal, each element double-quoted with `"` and `\` escaped.
#[must_use]
pub fn pg_array(values: &[String]) -> String {
    let items: Vec<String> = values
        .iter()
        .map(|value| {
            let mut escaped = String::new();
            for c in value.chars() {
                if c == '"' || c == BACKSLASH {
                    escaped.push(BACKSLASH);
                }
                escaped.push(c);
            }
            format!("\"{escaped}\"")
        })
        .collect();
    format!("{{{}}}", items.join(","))
}

/// A column name, trimmed and double-quoted. Only `[A-Za-z_][A-Za-z0-9_]*` passes,
/// because the name is spliced into SQL.
///
/// # Errors
///
/// Returns the message the local database reports for a name it will not accept.
pub fn ident(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if !is_plain_identifier(trimmed) {
        return Err(format!(
            "Not a column name the local database will accept: {name}"
        ));
    }
    Ok(format!("\"{trimmed}\""))
}

fn is_plain_identifier(text: &str) -> bool {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) if first.is_ascii_alphabetic() || first == '_' => {
            chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
        }
        _ => false,
    }
}

/// The right side of `is`, which is spliced into SQL, so only these three pass.
///
/// # Errors
///
/// Returns the message for any other operand.
pub fn is_literal(text: &str) -> Result<&'static str, String> {
    match text {
        "null" => Ok("null"),
        "true" => Ok("true"),
        "false" => Ok("false"),
        _ => Err(format!("`is` takes null, true or false, not: {text}")),
    }
}

/// A `select` column list. An empty string or `*` is every column; otherwise each
/// name is checked with [`ident`], and a `*` among them is kept as is.
///
/// # Errors
///
/// Returns the first column name [`ident`] refuses.
pub fn projection(columns: &str) -> Result<String, String> {
    let trimmed = columns.trim();
    if trimmed.is_empty() || trimmed == "*" {
        return Ok("*".to_owned());
    }
    let parts: Result<Vec<String>, String> = trimmed
        .split(',')
        .map(|column| {
            if column.trim() == "*" {
                Ok("*".to_owned())
            } else {
                ident(column)
            }
        })
        .collect();
    parts.map(|parts| parts.join(", "))
}

/// Splits top-level comma-separated expressions, ignoring commas inside parentheses
/// (`col.in.(a,b)`) and inside double-quoted values, where a backslash escapes the
/// next character. Empty pieces are dropped and the rest are trimmed.
#[must_use]
pub fn split_top_level(expression: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut depth: i64 = 0;
    let mut quoted = false;
    let mut escaped = false;
    for ch in expression.chars() {
        if quoted {
            current.push(ch);
            if escaped {
                escaped = false;
            } else if ch == BACKSLASH {
                escaped = true;
            } else if ch == '"' {
                quoted = false;
            }
            continue;
        }
        match ch {
            '"' => quoted = true,
            '(' => depth += 1,
            ')' => depth -= 1,
            _ => {}
        }
        if ch == ',' && depth == 0 {
            let piece = current.trim();
            if !piece.is_empty() {
                parts.push(piece.to_owned());
            }
            current.clear();
        } else {
            current.push(ch);
        }
    }
    let piece = current.trim();
    if !piece.is_empty() {
        parts.push(piece.to_owned());
    }
    parts
}

#[cfg(test)]
mod tests {
    use super::{BACKSLASH, ident, is_literal, pg_array, projection, split_top_level};

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn pg_array_quotes_and_escapes_elements() {
        let one_backslash = format!("a{BACKSLASH}b");
        let escaped = format!("{{\"a{BACKSLASH}{BACKSLASH}b\"}}");
        assert_eq!(pg_array(&strings(&[one_backslash.as_str()])), escaped);
        assert_eq!(
            pg_array(&strings(&["x\"y", "z"])),
            format!("{{\"x{BACKSLASH}\"y\",\"z\"}}")
        );
        assert_eq!(pg_array(&[]), "{}");
    }

    #[test]
    fn ident_accepts_plain_names_and_trims() {
        assert_eq!(ident(" title ").unwrap(), "\"title\"");
        assert_eq!(ident("_x9").unwrap(), "\"_x9\"");
    }

    #[test]
    fn ident_refuses_spliced_or_empty_names() {
        assert!(ident("").is_err());
        assert!(ident("9lives").is_err());
        assert!(ident("a-b").is_err());
        assert!(ident("x; drop").is_err());
        assert_eq!(
            ident("a b").unwrap_err(),
            "Not a column name the local database will accept: a b"
        );
    }

    #[test]
    fn is_literal_takes_only_three_words() {
        assert_eq!(is_literal("null").unwrap(), "null");
        assert_eq!(is_literal("true").unwrap(), "true");
        assert_eq!(is_literal("false").unwrap(), "false");
        assert_eq!(
            is_literal("1").unwrap_err(),
            "`is` takes null, true or false, not: 1"
        );
    }

    #[test]
    fn projection_defaults_to_star_and_quotes_names() {
        assert_eq!(projection("").unwrap(), "*");
        assert_eq!(projection(" * ").unwrap(), "*");
        assert_eq!(projection("id, title").unwrap(), "\"id\", \"title\"");
        assert_eq!(projection("id, *").unwrap(), "\"id\", *");
        assert!(projection("id, a-b").is_err());
    }

    #[test]
    fn split_keeps_commas_inside_parens_and_quotes() {
        assert_eq!(
            split_top_level("a.eq.1,b.in.(x,y),c.eq.\"p,q\""),
            strings(&["a.eq.1", "b.in.(x,y)", "c.eq.\"p,q\""])
        );
    }

    #[test]
    fn split_honours_backslash_escape_in_quotes() {
        let input = format!("t.eq.\"a{BACKSLASH}\"b,c\",u.eq.1");
        let first = format!("t.eq.\"a{BACKSLASH}\"b,c\"");
        assert_eq!(
            split_top_level(&input),
            strings(&[first.as_str(), "u.eq.1"])
        );
    }

    #[test]
    fn split_drops_empty_pieces() {
        assert_eq!(split_top_level(" , a ,, "), strings(&["a"]));
        assert!(split_top_level("").is_empty());
    }
}
