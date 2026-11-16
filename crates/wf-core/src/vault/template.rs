//! Vault note template engine (`apps/web/src/features/vault/application/note-template-engine.ts`).
//!
//! Templates use `{{var}}` substitution and HTML-comment region markers. Generated regions
//! refresh on re-render; editable regions and unmarked text are kept byte-for-byte. Damaged
//! markers keep the existing document unchanged, because losing user text is the one
//! unacceptable failure.
//!
//! Marker forms:
//! `<!-- wf:generated:name -->...<!-- /wf:generated:name -->` and the same for `editable`.
//!
//! Known divergences from the TS twin: numbers print with Rust's `Display`, so exponent
//! forms (1e21, 1e-7) differ from JS `String(n)`; `\s` is spelled out to JS's set by
//! [`compile`], and dotted paths index arrays by numeric position only.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::papers::js_regex::compile;

/// Template variables, the JS `Record<string, unknown>` of the TS engine.
pub type TemplateContext = serde_json::Map<String, Value>;

/// Which kind of region a marker opens.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum RegionKind {
    /// Refreshed from the template on every render.
    Generated,
    /// Kept byte-for-byte across re-renders.
    Editable,
}

impl RegionKind {
    /// The marker word: `generated` or `editable`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Generated => "generated",
            Self::Editable => "editable",
        }
    }

    /// Parses the marker word; `None` for anything else.
    #[must_use]
    pub fn parse(word: &str) -> Option<Self> {
        match word {
            "generated" => Some(Self::Generated),
            "editable" => Some(Self::Editable),
            _ => None,
        }
    }
}

/// One piece of a parsed document: plain text, or a marked region.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum Segment {
    /// Text outside every region.
    Text {
        /// The raw text.
        text: String,
    },
    /// A well-formed marked region.
    Region {
        /// Generated or editable.
        kind: RegionKind,
        /// The region name from the marker.
        name: String,
        /// Text between the open and close markers.
        body: String,
        /// The exact open marker as written.
        open: String,
        /// The exact close marker as written.
        close: String,
    },
}

/// Any HTML-comment opener of a region marker (`<!-- wf:generated:` or `<!-- wf:editable:`).
static OPEN_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"<!--\s*wf:(generated|editable):([A-Za-z0-9_-]+)\s*-->").ok());
/// Matches both spaced and compact close markers.
static CLOSE_ANY_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"<!--\s*/wf:(?:generated|editable):[A-Za-z0-9_-]+\s*-->").ok());
/// Any region opener inside a region body. Nesting is not supported.
static NESTED_OPEN_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"<!--\s*wf:(generated|editable):").ok());
/// `{{key}}` or `{{dotted.key}}`.
static PLACEHOLDER_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}").ok());
/// Region markers with their surrounding spaces and one trailing newline, for display.
static STRIP_RE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    compile(r"[ \t]*<!--\s*/?wf:(?:generated|editable):[A-Za-z0-9_-]+\s*-->[ \t]*\n?").ok()
});

/// Strips sequences that could forge region markers when interpolated.
/// Prefers empty over emitting a poisoned close or open comment.
fn sanitize_interpolated(text: &str) -> String {
    text.replace("<!--", "")
}

/// JS `String(n)` for a number. Integral values print without a fraction, and `-0` prints `0`.
fn format_number(value: &serde_json::Number) -> String {
    match value.as_f64() {
        Some(f) if !value.is_i64() && !value.is_u64() => {
            if f == 0.0 {
                "0".to_owned()
            } else {
                f.to_string()
            }
        }
        _ => value.to_string(),
    }
}

/// Formats one context value the way the TS `formatValue` does.
fn format_value(value: &Value) -> String {
    match value {
        Value::Null | Value::Object(_) => String::new(),
        Value::String(text) => sanitize_interpolated(text),
        Value::Number(number) => format_number(number),
        Value::Bool(flag) => flag.to_string(),
        Value::Array(items) => items
            .iter()
            .map(format_value)
            .filter(|item| !item.is_empty())
            .collect::<Vec<_>>()
            .join(", "),
    }
}

/// Resolves `key` as an own key first, then as a dotted path. Missing paths give `""`.
fn resolve(context: &TemplateContext, key: &str) -> String {
    if let Some(value) = context.get(key) {
        return format_value(value);
    }
    let mut parts = key.split('.');
    let Some(first) = parts.next() else {
        return String::new();
    };
    let Some(mut current) = context.get(first) else {
        return String::new();
    };
    for part in parts {
        current = match current {
            Value::Object(map) => match map.get(part) {
                Some(next) => next,
                None => return String::new(),
            },
            Value::Array(items) => match part.parse::<usize>().ok().and_then(|i| items.get(i)) {
                Some(next) => next,
                None => return String::new(),
            },
            _ => return String::new(),
        };
    }
    format_value(current)
}

/// Substitutes `{{key}}` from `context`. Missing keys become `""`, never `undefined`.
#[must_use]
pub fn substitute_variables(template: &str, context: &TemplateContext) -> String {
    let Some(re) = PLACEHOLDER_RE.as_ref() else {
        return template.to_owned();
    };
    re.replace_all(template, |caps: &regex_lite::Captures<'_>| {
        resolve(context, caps.get(1).map_or("", |m| m.as_str()))
    })
    .into_owned()
}

/// Wraps `body` in the open and close markers of `kind` and `name`.
#[must_use]
pub fn wrap_region(kind: RegionKind, name: &str, body: &str) -> String {
    format!(
        "<!-- wf:{kind}:{name} -->{body}<!-- /wf:{kind}:{name} -->",
        kind = kind.as_str()
    )
}

/// The close marker for one region, accepting the same whitespace as the open marker.
fn close_marker_re(kind: RegionKind, name: &str) -> Option<Regex> {
    compile(&format!(
        r"<!--\s*/wf:{kind}:{name}\s*-->",
        kind = kind.as_str()
    ))
    .ok()
}

/// Parses a document into text and region segments. Any mismatched, nested or half-deleted
/// marker gives `None`, so callers keep the whole document rather than guess.
///
/// A leftover close marker in text, where a documented close example sits mid-region, also
/// fails closed.
#[must_use]
pub fn parse_regions(document: &str) -> Option<Vec<Segment>> {
    let open_re = OPEN_RE.as_ref()?;
    let close_any = CLOSE_ANY_RE.as_ref()?;
    let nested = NESTED_OPEN_RE.as_ref()?;
    let mut segments = Vec::new();
    let mut cursor = 0_usize;
    while cursor <= document.len() {
        let Some(open_caps) = open_re.captures_at(document, cursor) else {
            if cursor < document.len() {
                let rest = &document[cursor..];
                if close_any.is_match(rest) {
                    return None;
                }
                segments.push(Segment::Text {
                    text: rest.to_owned(),
                });
            }
            break;
        };
        let whole = open_caps.get(0)?;
        if whole.start() > cursor {
            let gap = &document[cursor..whole.start()];
            if close_any.is_match(gap) {
                return None;
            }
            segments.push(Segment::Text {
                text: gap.to_owned(),
            });
        }
        let kind = RegionKind::parse(open_caps.get(1)?.as_str())?;
        let name = open_caps.get(2)?.as_str().to_owned();
        let body_start = whole.end();
        let close_re = close_marker_re(kind, &name)?;
        let close_match = close_re.find(&document[body_start..])?;
        let close_start = body_start + close_match.start();
        let body = &document[body_start..close_start];
        if nested.is_match(body) {
            return None;
        }
        let close = close_match.as_str();
        segments.push(Segment::Region {
            kind,
            name,
            body: body.to_owned(),
            open: whole.as_str().to_owned(),
            close: close.to_owned(),
        });
        cursor = close_start + close.len();
    }
    Some(segments)
}

/// Removes region markers for display (read mode). Persisted documents keep their markers.
#[must_use]
pub fn strip_region_markers(document: &str) -> String {
    match STRIP_RE.as_ref() {
        Some(re) => re.replace_all(document, "").into_owned(),
        None => document.to_owned(),
    }
}

/// Renders a template with variable substitution. Markers stay intact.
#[must_use]
pub fn render_template(template: &str, context: &TemplateContext) -> String {
    substitute_variables(template, context)
}

/// Merges a freshly rendered template into an existing document.
///
/// Rebuilds from the existing segment structure, so unmarked text and editable regions stay
/// identical. Generated bodies refresh when the same name is rendered. Generated regions that
/// only the new template has go at the end. Malformed markers on either side return
/// `existing` unchanged.
#[must_use]
pub fn merge_template(existing: &str, rendered: &str) -> String {
    if existing.is_empty() {
        return rendered.to_owned();
    }
    let Some(existing_segments) = parse_regions(existing) else {
        return existing.to_owned();
    };
    let Some(rendered_segments) = parse_regions(rendered) else {
        return existing.to_owned();
    };

    // Last rendered body wins for a duplicated name; order is first appearance.
    let mut bodies: HashMap<&str, &str> = HashMap::new();
    let mut order: Vec<&str> = Vec::new();
    for segment in &rendered_segments {
        if let Segment::Region {
            kind: RegionKind::Generated,
            name,
            body,
            ..
        } = segment
        {
            if !bodies.contains_key(name.as_str()) {
                order.push(name.as_str());
            }
            let _previous = bodies.insert(name.as_str(), body.as_str());
        }
    }

    let mut seen: HashSet<&str> = HashSet::new();
    let mut out = String::new();
    for segment in &existing_segments {
        match segment {
            Segment::Text { text } => out.push_str(text),
            Segment::Region {
                kind: RegionKind::Editable,
                body,
                open,
                close,
                ..
            } => {
                out.push_str(open);
                out.push_str(body);
                out.push_str(close);
            }
            Segment::Region {
                kind: RegionKind::Generated,
                name,
                body,
                open,
                close,
            } => {
                let _first_time = seen.insert(name.as_str());
                let next = bodies.get(name.as_str()).copied().unwrap_or(body.as_str());
                out.push_str(open);
                out.push_str(next);
                out.push_str(close);
            }
        }
    }

    for name in order {
        if seen.contains(name) {
            continue;
        }
        let body = bodies.get(name).copied().unwrap_or("");
        if !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(&wrap_region(RegionKind::Generated, name, body));
    }
    out
}

/// First render (empty or whitespace-only existing) or merge on re-render. Whitespace-only
/// notes count as empty, so the template can install its editable regions.
#[must_use]
pub fn apply_template(existing: Option<&str>, template: &str, context: &TemplateContext) -> String {
    let rendered = render_template(template, context);
    match existing {
        Some(text) if !text.trim().is_empty() => merge_template(text, &rendered),
        _ => rendered,
    }
}

/// The default source-note template (TS `DEFAULT_SOURCE_NOTE_TEMPLATE`): generated metadata,
/// then editable summary, key points and notes. Lines are joined with `\n` and end with one.
#[must_use]
pub fn default_source_note_template() -> String {
    [
        wrap_region(
            RegionKind::Generated,
            "metadata",
            "# {{title}}\n\n- Authors: {{authors}}\n- Year: {{year}}\n- Venue: {{venue}}\n- DOI: {{doi}}\n- Cite key: {{citeKey}}\n",
        ),
        "## Summary".to_owned(),
        String::new(),
        wrap_region(RegionKind::Editable, "summary", "\nWrite a short summary.\n"),
        "## Key points".to_owned(),
        String::new(),
        wrap_region(RegionKind::Editable, "key-points", "\n- \n"),
        "## Notes".to_owned(),
        String::new(),
        wrap_region(
            RegionKind::Editable,
            "notes",
            "\nYour notes stay here across re-renders.\n",
        ),
        String::new(),
    ]
    .join("\n")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn ctx(value: &Value) -> TemplateContext {
        value.as_object().cloned().unwrap_or_default()
    }

    fn template() -> String {
        [
            "# {{title}}".to_owned(),
            String::new(),
            wrap_region(
                RegionKind::Generated,
                "metadata",
                &["- Year: {{year}}", "- Tags: {{tags}}", ""].join("\n"),
            ),
            wrap_region(
                RegionKind::Editable,
                "notes",
                &["", "Write your notes here.", ""].join("\n"),
            ),
            String::new(),
        ]
        .join("\n")
    }

    /// Replaces the body of the editable region `name` (test helper, mirrors the TS regex swap).
    fn set_editable(doc: &str, name: &str, body: &str) -> String {
        let open = format!("<!-- wf:editable:{name} -->");
        let close = format!("<!-- /wf:editable:{name} -->");
        match (doc.find(&open), doc.find(&close)) {
            (Some(start), Some(end)) if start < end => format!(
                "{}{}{}",
                &doc[..start],
                wrap_region(RegionKind::Editable, name, body),
                &doc[end + close.len()..]
            ),
            _ => doc.to_owned(),
        }
    }

    /// The text between the editable markers `name` (test helper).
    fn editable_body<'a>(doc: &'a str, name: &str) -> &'a str {
        let open = format!("<!-- wf:editable:{name} -->");
        let close = format!("<!-- /wf:editable:{name} -->");
        let start = doc.find(&open).map_or(0, |i| i + open.len());
        let end = doc.find(&close).unwrap_or(doc.len());
        &doc[start..end]
    }

    #[test]
    fn render_substitutes_variables_and_leaves_missing_keys_empty() {
        let out = render_template(
            &template(),
            &ctx(&json!({"title": "Attention", "year": 2017, "tags": ["nlp", "transformers"]})),
        );
        assert!(out.starts_with("# Attention"));
        assert!(out.contains("- Year: 2017"));
        assert!(out.contains("- Tags: nlp, transformers"));
        assert!(!out.contains("undefined"));
        assert_eq!(
            substitute_variables("Hello {{missing}}!", &ctx(&json!({}))),
            "Hello !"
        );
    }

    #[test]
    fn apply_first_render_from_empty_produces_the_rendered_template() {
        let c = ctx(&json!({"title": "X", "year": 2020, "tags": []}));
        let out = apply_template(Some(""), &template(), &c);
        assert_eq!(out, render_template(&template(), &c));
        assert!(out.contains("<!-- wf:generated:metadata -->"));
        assert!(out.contains("<!-- wf:editable:notes -->"));
    }

    #[test]
    fn merge_refreshes_generated_and_preserves_editable_byte_for_byte() {
        let first = apply_template(
            Some(""),
            &template(),
            &ctx(&json!({"title": "V1", "year": 2017, "tags": ["a"]})),
        );
        let user_notes = "\nMy week of careful notes \u{2014} keep me.\n";
        let edited = set_editable(&first, "notes", user_notes);
        let merged = apply_template(
            Some(&edited),
            &template(),
            &ctx(&json!({"title": "V2", "year": 2018, "tags": ["b", "c"]})),
        );
        assert!(merged.contains("- Year: 2018"));
        assert!(merged.contains("- Tags: b, c"));
        assert_eq!(editable_body(&merged, "notes"), user_notes);
        // The title sits outside markers, so the old line survives the merge.
        assert!(merged.starts_with("# V1"));
    }

    #[test]
    fn merge_preserves_unmarked_user_content_outside_all_markers() {
        let base = apply_template(
            Some(""),
            &template(),
            &ctx(&json!({"title": "T", "year": 1, "tags": []})),
        );
        let with_freeform = format!("{base}\n\n## My appendix\n\nDo not touch.\n");
        let merged = merge_template(
            &with_freeform,
            &render_template(
                &template(),
                &ctx(&json!({"title": "T", "year": 2, "tags": ["x"]})),
            ),
        );
        assert!(merged.contains("## My appendix"));
        assert!(merged.contains("Do not touch."));
        assert!(merged.contains("- Year: 2"));
        assert!(merged.ends_with("Do not touch.\n") || merged.contains("Do not touch.\n"));
    }

    #[test]
    fn merge_preserves_everything_when_markers_are_malformed() {
        let damaged = [
            "# Title",
            "<!-- wf:generated:metadata -->",
            "- Year: 2017",
            "<!-- wf:editable:notes -->",
            "user text",
            "<!-- /wf:editable:notes -->",
        ]
        .join("\n");
        let rendered = render_template(
            &template(),
            &ctx(&json!({"title": "N", "year": 9, "tags": []})),
        );
        assert_eq!(merge_template(&damaged, &rendered), damaged);
        assert!(parse_regions(&damaged).is_none());
    }

    #[test]
    fn merge_preserves_everything_when_a_close_marker_is_half_deleted() {
        let damaged = [
            wrap_region(RegionKind::Generated, "metadata", "- Year: 1\n"),
            "<!-- wf:editable:notes -->".to_owned(),
            "keep me".to_owned(),
            "<!-- /wf:editable:note -->".to_owned(),
        ]
        .join("\n");
        let rendered = render_template(
            &template(),
            &ctx(&json!({"title": "N", "year": 9, "tags": []})),
        );
        assert_eq!(merge_template(&damaged, &rendered), damaged);
    }

    #[test]
    fn round_trip_keeps_user_editable_text_identical_across_rerenders() {
        let mut doc = apply_template(
            Some(""),
            &template(),
            &ctx(&json!({"title": "R", "year": 2020, "tags": ["t"]})),
        );
        let payload = "Line A\nLine B with [[wikilink]] and $math$\n";
        doc = set_editable(&doc, "notes", payload);
        for i in 0..3 {
            doc = apply_template(
                Some(&doc),
                &template(),
                &ctx(
                    &json!({"title": format!("R{i}"), "year": 2020 + i, "tags": [format!("t{i}")]}),
                ),
            );
        }
        assert_eq!(editable_body(&doc, "notes"), payload);
    }

    #[test]
    fn substitute_strips_html_comment_openers_from_context_values() {
        let out = substitute_variables(
            "Hi {{name}}",
            &ctx(&json!({"name": "Ada <!-- /wf:generated:metadata --> Lovelace"})),
        );
        assert_eq!(out, "Hi Ada  /wf:generated:metadata --> Lovelace");
        assert!(!out.contains("<!--"));
    }

    #[test]
    fn merge_appends_new_generated_regions_from_a_later_template() {
        let v1 = [
            wrap_region(RegionKind::Generated, "metadata", "- Year: 1\n"),
            wrap_region(RegionKind::Editable, "notes", "mine\n"),
        ]
        .join("");
        let v2 = [
            wrap_region(RegionKind::Generated, "metadata", "- Year: {{year}}\n"),
            wrap_region(RegionKind::Generated, "abstract", "{{abstract}}\n"),
            wrap_region(RegionKind::Editable, "notes", "default\n"),
        ]
        .join("");
        let merged = apply_template(
            Some(&v1),
            &v2,
            &ctx(&json!({"year": 2, "abstract": "Short abs."})),
        );
        assert!(merged.contains("- Year: 2"));
        assert!(merged.contains("<!-- wf:generated:abstract -->"));
        assert!(merged.contains("Short abs."));
        assert!(merged.contains("<!-- wf:editable:notes -->mine\n<!-- /wf:editable:notes -->"));
    }

    #[test]
    fn parse_fails_closed_when_a_documented_close_leaves_a_stray_close() {
        let damaged = [
            "<!-- wf:editable:notes -->",
            "see <!-- /wf:editable:notes --> in docs",
            "real close follows",
            "<!-- /wf:editable:notes -->",
        ]
        .join("\n");
        assert!(parse_regions(&damaged).is_none());
        let rendered = render_template(
            &template(),
            &ctx(&json!({"title": "X", "year": 1, "tags": []})),
        );
        assert_eq!(merge_template(&damaged, &rendered), damaged);
    }

    #[test]
    fn substitute_resolves_dotted_paths_and_empties_missing_ones() {
        assert_eq!(
            substitute_variables(
                "{{paper.title}} / {{paper.missing}}",
                &ctx(&json!({"paper": {"title": "Attention"}})),
            ),
            "Attention / "
        );
    }

    #[test]
    fn parse_rejects_nested_markers_and_merge_preserves_existing() {
        let nested = wrap_region(
            RegionKind::Editable,
            "notes",
            &wrap_region(RegionKind::Generated, "inside", "unsafe"),
        );
        assert!(parse_regions(&nested).is_none());
        assert_eq!(
            merge_template(&nested, &render_template(&template(), &ctx(&json!({})))),
            nested
        );
    }

    #[test]
    fn merge_preserves_existing_when_the_rendered_template_is_malformed() {
        let existing = [
            wrap_region(RegionKind::Generated, "metadata", "old"),
            wrap_region(RegionKind::Editable, "notes", "user text"),
        ]
        .join("\n");
        assert_eq!(
            merge_template(&existing, "<!-- wf:generated:metadata -->new"),
            existing
        );
    }

    #[test]
    fn duplicate_generated_names_resolve_to_the_last_rendered_body() {
        let existing = wrap_region(RegionKind::Generated, "metadata", "old");
        let rendered = [
            wrap_region(RegionKind::Generated, "metadata", "first"),
            wrap_region(RegionKind::Generated, "metadata", "second"),
        ]
        .join("\n");
        assert_eq!(
            merge_template(&existing, &rendered),
            wrap_region(RegionKind::Generated, "metadata", "second")
        );
    }

    #[test]
    fn parse_accepts_compact_markers_and_rejects_compact_stray_closes() {
        let compact = "<!--wf:generated:metadata-->body<!--/wf:generated:metadata-->";
        let segments = parse_regions(compact);
        assert!(matches!(
            segments.as_deref().and_then(<[Segment]>::first),
            Some(Segment::Region { .. })
        ));
        assert!(parse_regions("hello <!--/wf:generated:x-->").is_none());
    }

    #[test]
    fn apply_treats_whitespace_only_existing_notes_as_empty() {
        let c = ctx(&json!({"title": "Fresh", "year": 2026, "tags": []}));
        let out = apply_template(Some("  \n\t  "), &template(), &c);
        assert_eq!(out, render_template(&template(), &c));
        assert!(out.contains("<!-- wf:editable:notes -->"));
    }

    #[test]
    fn strip_region_markers_removes_markers_without_touching_the_body() {
        let default_template = [
            wrap_region(
                RegionKind::Generated,
                "metadata",
                "# {{title}}\n\n- Year: {{year}}\n",
            ),
            "## Summary\n\n".to_owned(),
            wrap_region(
                RegionKind::Editable,
                "summary",
                "\nWrite a short summary.\n",
            ),
        ]
        .join("");
        let doc = apply_template(None, &default_template, &ctx(&json!({"title": "BISCUIT"})));
        let shown = strip_region_markers(&doc);
        assert!(!shown.contains("<!--"), "no HTML comment survives display");
        assert!(shown.contains("# BISCUIT"));
        assert!(shown.contains("Write a short summary."));
        assert!(
            shown.starts_with("# BISCUIT"),
            "inline marker leaves the heading at line start"
        );
    }

    #[test]
    fn default_source_note_template_matches_the_ts_literal() {
        let expected = concat!(
            "<!-- wf:generated:metadata -->",
            "# {{title}}\n\n- Authors: {{authors}}\n- Year: {{year}}\n- Venue: {{venue}}\n- DOI: {{doi}}\n- Cite key: {{citeKey}}\n",
            "<!-- /wf:generated:metadata -->",
            "\n## Summary\n",
            "\n",
            "<!-- wf:editable:summary -->\nWrite a short summary.\n<!-- /wf:editable:summary -->",
            "\n## Key points\n\n",
            "<!-- wf:editable:key-points -->\n- \n<!-- /wf:editable:key-points -->",
            "\n## Notes\n\n",
            "<!-- wf:editable:notes -->\nYour notes stay here across re-renders.\n<!-- /wf:editable:notes -->",
            "\n",
        );
        assert_eq!(default_source_note_template(), expected);
    }

    #[test]
    fn region_kind_round_trips_its_marker_word() {
        assert_eq!(RegionKind::parse("generated"), Some(RegionKind::Generated));
        assert_eq!(RegionKind::Editable.as_str(), "editable");
        assert_eq!(RegionKind::parse("nope"), None);
    }
}
