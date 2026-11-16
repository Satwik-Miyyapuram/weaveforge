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

/// The SQL operator a PostgREST filter name maps to, or `None` for a name the local
/// database has no filter for. Only these operators reach the SQL text.
#[must_use]
pub fn filter_operator(name: &str) -> Option<&'static str> {
    match name {
        "eq" => Some("="),
        "neq" => Some("<>"),
        "gt" => Some(">"),
        "gte" => Some(">="),
        "lt" => Some("<"),
        "lte" => Some("<="),
        "like" => Some("like"),
        "ilike" => Some("ilike"),
        _ => None,
    }
}

/// The pieces of an `in` list written as text, e.g. `(a,b)` or `a,b`: one leading
/// `(` and one trailing `)` are dropped, the rest split on commas, trimmed, and
/// empty pieces removed.
#[must_use]
pub fn in_items(text: &str) -> Vec<String> {
    let without_open = text.strip_prefix('(').unwrap_or(text);
    let inner = without_open.strip_suffix(')').unwrap_or(without_open);
    inner
        .split(',')
        .map(str::trim)
        .filter(|piece| !piece.is_empty())
        .map(str::to_owned)
        .collect()
}

/// The value of one `or()` clause. A double-quoted value is unquoted, and each
/// backslash inside it is dropped so the character after it stands for itself.
#[must_use]
pub fn or_value(joined: &str) -> String {
    if joined.len() < 2 || !joined.starts_with('"') || !joined.ends_with('"') {
        return joined.to_owned();
    }
    let inner = &joined[1..joined.len() - 1];
    let mut out = String::new();
    let mut chars = inner.chars();
    while let Some(ch) = chars.next() {
        if ch == BACKSLASH
            && let Some(next) = chars.next()
        {
            out.push(next);
            continue;
        }
        out.push(ch);
    }
    out
}

/// One `order()` term: the quoted column, its direction (ascending unless `false`),
/// and where nulls sort when the caller said.
///
/// # Errors
///
/// Returns the [`ident`] error for a column name the local database will not accept.
pub fn order_clause(
    column: &str,
    ascending: Option<bool>,
    nulls_first: Option<bool>,
) -> Result<String, String> {
    let direction = if ascending.unwrap_or(true) {
        "asc"
    } else {
        "desc"
    };
    let nulls = match nulls_first {
        None => "",
        Some(true) => " nulls first",
        Some(false) => " nulls last",
    };
    Ok(format!("{} {direction}{nulls}", ident(column)?))
}

/// `range(from, to)` as a row limit and an offset. The range is inclusive at both
/// ends, and neither result goes below zero (`Math.max(0, …)`; NaN stays NaN).
#[must_use]
pub fn range_window(from: f64, to: f64) -> (f64, f64) {
    (non_negative(to - from + 1.0), non_negative(from))
}

fn non_negative(value: f64) -> f64 {
    if value.is_nan() {
        value
    } else {
        value.max(0.0)
    }
}

/// The tail of a `select`, `update` or `delete`: ` order by …`, then ` limit n`,
/// then ` offset n` when the offset is non-zero. Each part is present only when given.
#[must_use]
pub fn tail_clause(order_by: Option<&str>, limit: Option<f64>, offset: f64) -> String {
    let order = order_by.map_or_else(String::new, |terms| format!(" order by {terms}"));
    let limit = limit.map_or_else(String::new, |count| format!(" limit {count}"));
    // A zero or NaN offset is falsy in JS and is left out, as `offset` without `limit` is legal.
    let offset = if offset != 0.0 && !offset.is_nan() {
        format!(" offset {offset}")
    } else {
        String::new()
    };
    format!("{order}{limit}{offset}")
}

#[cfg(test)]
mod tests {
    use super::{
        BACKSLASH, filter_operator, ident, in_items, is_literal, or_value, order_clause, pg_array,
        projection, range_window, split_top_level, tail_clause,
    };

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

    #[test]
    fn filter_operator_maps_only_the_known_names() {
        assert_eq!(filter_operator("eq"), Some("="));
        assert_eq!(filter_operator("neq"), Some("<>"));
        assert_eq!(filter_operator("gte"), Some(">="));
        assert_eq!(filter_operator("ilike"), Some("ilike"));
        assert_eq!(filter_operator("constructor"), None);
        assert_eq!(filter_operator("contains"), None);
    }

    #[test]
    fn in_items_drops_one_pair_of_parens_and_blanks() {
        assert_eq!(in_items("(a, b,,c )"), strings(&["a", "b", "c"]));
        assert_eq!(in_items("a,b"), strings(&["a", "b"]));
        assert!(in_items("()").is_empty());
    }

    #[test]
    fn or_value_unquotes_and_unescapes() {
        assert_eq!(or_value("\"a,b\""), "a,b");
        assert_eq!(or_value(&format!("\"x{BACKSLASH}\"y\"")), "x\"y");
        assert_eq!(or_value("plain"), "plain");
        assert_eq!(or_value("\""), "\"");
    }

    #[test]
    fn order_clause_defaults_to_ascending_without_nulls_rule() {
        assert_eq!(order_clause("name", None, None).unwrap(), "\"name\" asc");
        assert_eq!(
            order_clause("name", Some(false), None).unwrap(),
            "\"name\" desc"
        );
        assert_eq!(
            order_clause("name", Some(true), Some(true)).unwrap(),
            "\"name\" asc nulls first"
        );
        assert_eq!(
            order_clause("name", None, Some(false)).unwrap(),
            "\"name\" asc nulls last"
        );
        assert!(order_clause("a-b", None, None).is_err());
    }

    #[test]
    fn range_is_inclusive_and_never_negative() {
        assert_eq!(range_window(0.0, 9.0), (10.0, 0.0));
        assert_eq!(range_window(5.0, 7.0), (3.0, 5.0));
        assert_eq!(range_window(9.0, 2.0), (0.0, 9.0));
        assert_eq!(range_window(-3.0, 1.0), (5.0, 0.0));
    }

    #[test]
    fn tail_assembles_order_limit_and_offset() {
        assert_eq!(tail_clause(None, None, 0.0), "");
        assert_eq!(
            tail_clause(Some("\"a\" asc, \"b\" desc"), Some(10.0), 20.0),
            " order by \"a\" asc, \"b\" desc limit 10 offset 20"
        );
        assert_eq!(tail_clause(None, None, 5.0), " offset 5");
        assert_eq!(tail_clause(None, None, f64::NAN), "");
    }
}
