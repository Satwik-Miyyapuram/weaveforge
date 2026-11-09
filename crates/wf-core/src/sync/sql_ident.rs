//! Ports `apps/web/src/features/offline-sync/domain/sql-ident.ts`: a Postgres
//! identifier in double quotes, with any embedded quote doubled.

/// The name in double quotes, each embedded `"` doubled.
#[must_use]
pub fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

#[cfg(test)]
mod tests {
    use super::quote_ident;

    #[test]
    fn quotes_plain_and_empty_names() {
        assert_eq!(quote_ident("papers"), "\"papers\"");
        assert_eq!(quote_ident(""), "\"\"");
    }

    #[test]
    fn doubles_embedded_quotes() {
        assert_eq!(quote_ident("a\"b"), "\"a\"\"b\"");
        assert_eq!(
            quote_ident("x\"; drop table y; --"),
            "\"x\"\"; drop table y; --\""
        );
    }
}
