//! OpenAlex metadata lookups: the query each lookup sends, and the pick among its answers.
//! The HTTP call stays in TypeScript (`apps/web/src/container/parts.ts`).

use serde::Deserialize;
use url::form_urlencoded::Serializer;

use crate::reader_analysis::text::{
    AnalysisBibliographicCandidate, AnalysisBibliographicHints, is_bibliographic_match,
};

/// One work in an OpenAlex answer, as far as the pick reads it.
#[derive(Debug, Clone, Deserialize)]
pub struct OpenAlexCandidate {
    /// The work's title, when OpenAlex has one.
    pub title: Option<String>,
    /// The work's publication year, when known.
    pub publication_year: Option<f64>,
}

/// The query string for a works search: `search`, `per-page=3`, then the optional
/// `mailto` and `api_key`. An empty optional is left out.
#[must_use]
pub fn search_query(search: &str, mailto: Option<&str>, api_key: Option<&str>) -> String {
    let mut query = Serializer::new(String::new());
    query.append_pair("search", search).append_pair("per-page", "3");
    if let Some(mailto) = mailto.filter(|value| !value.is_empty()) {
        query.append_pair("mailto", mailto);
    }
    if let Some(api_key) = api_key.filter(|value| !value.is_empty()) {
        query.append_pair("api_key", api_key);
    }
    query.finish()
}

/// The index of the first work whose title and year match the hints. Works with no title are skipped.
#[must_use]
pub fn first_match(hints: &AnalysisBibliographicHints, works: &[OpenAlexCandidate]) -> Option<usize> {
    works.iter().position(|work| {
        let Some(title) = work.title.as_deref().filter(|title| !title.is_empty()) else {
            return false;
        };
        is_bibliographic_match(
            hints,
            &AnalysisBibliographicCandidate {
                title: title.to_owned(),
                year: work.publication_year,
            },
        )
    })
}

#[cfg(test)]
mod tests {
    use url::form_urlencoded;

    use super::*;

    fn params(query: &str) -> Vec<(String, String)> {
        form_urlencoded::parse(query.as_bytes())
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect()
    }

    // it: "OpenAlex metadata lookups send the user's key as api_key"
    #[test]
    fn openalex_metadata_lookups_send_the_user_s_key_as_api_key() {
        let query = search_query("Some title", None, Some("oa-key"));
        assert!(params(&query).contains(&("api_key".to_owned(), "oa-key".to_owned())));
    }

    // it: "OpenAlex metadata lookups without a key send no api_key"
    #[test]
    fn openalex_metadata_lookups_without_a_key_send_no_api_key() {
        let query = search_query("Some title", None, None);
        assert!(!params(&query).iter().any(|(key, _)| key == "api_key"));
    }
}
