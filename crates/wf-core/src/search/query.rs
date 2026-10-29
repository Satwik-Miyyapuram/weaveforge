//! Search query syntax. Port of `parseSearchQuery` in
//! `packages/core/src/search/search-query.ts`, plus `type:` (alias of
//! `kind:`), `in:` (alias of `path:`) and `modified:<n><d|w|m|y>`.

use crate::search::js_text::is_js_whitespace;

/// Largest `modified:` window, in days (100 years).
pub const MAX_MODIFIED_DAYS: u32 = 36_500;

/// Every entity kind the workspace index covers (TS `SEARCH_KINDS`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum SearchKind {
    /// Note.
    Note,
    /// Paper.
    Paper,
    /// List.
    List,
    /// Section.
    Section,
    /// Experiment.
    Experiment,
    /// Milestone.
    Milestone,
    /// Log.
    Log,
    /// PDF.
    Pdf,
    /// Annotation.
    Annotation,
}

impl SearchKind {
    /// All kinds, in the TypeScript order.
    pub const ALL: [SearchKind; 9] = [
        Self::Note,
        Self::Paper,
        Self::List,
        Self::Section,
        Self::Experiment,
        Self::Milestone,
        Self::Log,
        Self::Pdf,
        Self::Annotation,
    ];

    /// Lowercase name: "note", "paper", ..., "annotation".
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Note => "note",
            Self::Paper => "paper",
            Self::List => "list",
            Self::Section => "section",
            Self::Experiment => "experiment",
            Self::Milestone => "milestone",
            Self::Log => "log",
            Self::Pdf => "pdf",
            Self::Annotation => "annotation",
        }
    }

    /// Exact (already lowercase) name to kind; anything else is `None`.
    #[must_use]
    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.as_str() == name)
    }
}

/// One piece of a query, in input order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Clause {
    /// Free term, lowercased.
    Term(String),
    /// Quoted phrase, trimmed and lowercased.
    Phrase(String),
    /// `-term` or `-"phrase"`, trimmed and lowercased.
    Exclude(String),
    /// `kind:` / `type:` filter.
    Kind(SearchKind),
    /// `path:` / `in:` filter, lowercased.
    Path(String),
    /// `tag:` filter, one leading `#` removed, lowercased (may be empty).
    Tag(String),
    /// `modified:` window in days, 1..=MAX_MODIFIED_DAYS.
    ModifiedWithinDays(u32),
}

/// A parsed query (TS `ParsedQuery` plus `modified_within_days`).
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct ParsedQuery {
    /// Free terms.
    pub terms: Vec<String>,
    /// Phrases.
    pub phrases: Vec<String>,
    /// Exclusions.
    pub exclude: Vec<String>,
    /// Kind filters.
    pub kinds: Vec<SearchKind>,
    /// Path filters.
    pub paths: Vec<String>,
    /// Tag filters.
    pub tags: Vec<String>,
    /// Smallest `modified:` window, if any.
    pub modified_within_days: Option<u32>,
    /// Terms and phrases in input order, joined by one space: what the ranker sees.
    pub text: String,
}

impl ParsedQuery {
    /// Collect clauses into the per-field lists (order kept within each list).
    #[must_use]
    pub fn from_clauses(clauses: &[Clause]) -> Self {
        let mut query = Self::default();
        let mut text_parts: Vec<&str> = Vec::new();
        for clause in clauses {
            match clause {
                Clause::Term(term) => {
                    query.terms.push(term.clone());
                    text_parts.push(term);
                }
                Clause::Phrase(phrase) => {
                    query.phrases.push(phrase.clone());
                    text_parts.push(phrase);
                }
                Clause::Exclude(value) => query.exclude.push(value.clone()),
                Clause::Kind(kind) => query.kinds.push(*kind),
                Clause::Path(path) => query.paths.push(path.clone()),
                Clause::Tag(tag) => query.tags.push(tag.clone()),
                Clause::ModifiedWithinDays(days) => {
                    query.modified_within_days = Some(
                        query
                            .modified_within_days
                            .map_or(*days, |min| min.min(*days)),
                    );
                }
            }
        }
        let joined = text_parts.join(" ");
        query.text = trim(&joined).to_owned();
        debug_assert_eq!(query.terms.len() + query.phrases.len(), text_parts.len());
        debug_assert!(query.text.len() <= joined.len());
        query
    }

    /// True when there is no ranking input (`text` empty).
    #[must_use]
    pub fn is_filter_only(&self) -> bool {
        self.text.is_empty()
    }

    /// True when filter-only and kinds, paths, tags, exclude are empty and modified is None.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.is_filter_only()
            && self.kinds.is_empty()
            && self.paths.is_empty()
            && self.tags.is_empty()
            && self.exclude.is_empty()
            && self.modified_within_days.is_none()
    }
}

/// Parse into ordered clauses.
#[must_use]
pub fn parse_clauses(input: &str) -> Vec<Clause> {
    let clauses: Vec<Clause> = tokenize(input)
        .into_iter()
        .filter_map(parse_token)
        .collect();
    debug_assert!(clauses.len() <= input.len());
    debug_assert!(clauses.iter().all(|clause| match clause {
        Clause::ModifiedWithinDays(days) => (1..=MAX_MODIFIED_DAYS).contains(days),
        _ => true,
    }));
    clauses
}

/// `ParsedQuery::from_clauses(&parse_clauses(input))`.
#[must_use]
pub fn parse_query(input: &str) -> ParsedQuery {
    ParsedQuery::from_clauses(&parse_clauses(input))
}

/// Canonical text that parses back to the same clauses.
#[must_use]
pub fn format_query(clauses: &[Clause]) -> String {
    let parts: Vec<String> = clauses.iter().map(format_clause).collect();
    debug_assert_eq!(parts.len(), clauses.len());
    let out = parts.join(" ");
    debug_assert_eq!(out.is_empty(), clauses.is_empty());
    out
}

/// Trim JS whitespace from both ends.
fn trim(s: &str) -> &str {
    s.trim_start_matches(is_js_whitespace)
        .trim_end_matches(is_js_whitespace)
}

/// Remove one leading `"`, then one trailing `"` from what remains.
fn unquote(v: &str) -> &str {
    let v = v.strip_prefix('"').unwrap_or(v);
    v.strip_suffix('"').unwrap_or(v)
}

/// Unquote, trim, then lowercase.
fn clean(s: &str) -> String {
    trim(unquote(s)).to_lowercase()
}

/// Split `input` into raw tokens (port of `splitTokens`).
fn tokenize(input: &str) -> Vec<&str> {
    let mut rest = trim(input);
    let mut tokens = Vec::new();
    loop {
        rest = rest.trim_start_matches(is_js_whitespace);
        if rest.is_empty() {
            break;
        }
        let end = token_end(rest);
        let Some((token, tail)) = rest.split_at_checked(end) else {
            break;
        };
        tokens.push(token);
        rest = tail;
    }
    debug_assert!(tokens.iter().all(|token| !token.is_empty()));
    debug_assert!(tokens.len() <= input.len());
    tokens
}

/// Byte length of the token at the start of `s` (`s` non-empty, no leading whitespace).
fn token_end(s: &str) -> usize {
    debug_assert!(!s.is_empty());
    debug_assert!(!s.starts_with(is_js_whitespace));
    let dash = usize::from(s.starts_with('-'));
    let body = s.get(dash..).unwrap_or_default();
    if !body.starts_with('"') {
        return s.find(is_js_whitespace).unwrap_or(s.len());
    }
    // Quoted: runs to the next `"` (inclusive) or to the end of input.
    let close = body
        .get(1..)
        .and_then(|rest| rest.find('"'))
        .map_or(body.len(), |pos| pos + 2);
    dash + close
}

/// Clause for one raw token; `None` when the token is skipped or consumed.
fn parse_token(token: &str) -> Option<Clause> {
    if token == "-" || token == "\"" {
        return None;
    }
    if let Some(rest) = token.strip_prefix('-') {
        let value = clean(rest);
        return (!value.is_empty()).then_some(Clause::Exclude(value));
    }
    if let Some((key, raw)) = token.split_once(':')
        && let Some(field) = FIELDS.iter().copied().find(|f| key.eq_ignore_ascii_case(f))
    {
        return field_clause(field, raw);
    }
    if token.starts_with('"') {
        let phrase = clean(token);
        return (!phrase.is_empty()).then_some(Clause::Phrase(phrase));
    }
    Some(Clause::Term(token.to_lowercase()))
}

/// Field keys recognised before `:` (ASCII case-insensitive).
const FIELDS: [&str; 6] = ["kind", "type", "path", "in", "tag", "modified"];

/// Clause for `<field>:<raw>`; `None` when the value is empty or invalid.
fn field_clause(field: &str, raw: &str) -> Option<Clause> {
    debug_assert!(FIELDS.contains(&field));
    let value = trim(unquote(raw));
    debug_assert!(value.len() <= raw.len());
    if value.is_empty() {
        return None;
    }
    match field {
        "kind" | "type" => SearchKind::parse(&value.to_lowercase()).map(Clause::Kind),
        "path" | "in" => Some(Clause::Path(value.to_lowercase())),
        "tag" => {
            let inner = value.strip_prefix('#').unwrap_or(value);
            Some(Clause::Tag(inner.to_lowercase()))
        }
        "modified" => parse_modified(value).map(Clause::ModifiedWithinDays),
        _ => None,
    }
}

/// Days for `<digits><d|w|m|y>`, or `None` when malformed or outside 1..=MAX.
fn parse_modified(value: &str) -> Option<u32> {
    debug_assert!(!value.is_empty());
    let unit = value.chars().last()?;
    let digits = value.strip_suffix(unit)?;
    let factor: u32 = match unit.to_ascii_lowercase() {
        'd' => 1,
        'w' => 7,
        'm' => 30,
        'y' => 365,
        _ => return None,
    };
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let days = digits.parse::<u32>().ok()?.checked_mul(factor)?;
    debug_assert!(factor > 0);
    (1..=MAX_MODIFIED_DAYS).contains(&days).then_some(days)
}

/// Canonical text for one clause.
fn format_clause(clause: &Clause) -> String {
    match clause {
        Clause::Term(term) => term.clone(),
        Clause::Phrase(phrase) => format!("\"{phrase}\""),
        Clause::Exclude(value) => {
            if value.chars().any(is_js_whitespace) {
                format!("-\"{value}\"")
            } else if value.ends_with('"') {
                format!("-{value}\"")
            } else {
                format!("-{value}")
            }
        }
        Clause::Kind(kind) => format!("kind:{}", kind.as_str()),
        Clause::Path(path) => format!("path:{}", quote_if_needed(path)),
        Clause::Tag(tag) => {
            let inner = if tag.is_empty() || tag.starts_with('#') {
                format!("#{tag}")
            } else {
                tag.clone()
            };
            format!("tag:{}", quote_if_needed(&inner))
        }
        Clause::ModifiedWithinDays(days) => format!("modified:{days}d"),
    }
}

/// Wrap `x` in quotes when it starts or ends with `"`.
fn quote_if_needed(x: &str) -> String {
    if x.starts_with('"') || x.ends_with('"') {
        format!("\"{x}\"")
    } else {
        x.to_owned()
    }
}
