//! Experiment artifact references in report markdown (`expartifact:`). Port of the parse, serialise
//! and basename helpers in `apps/web/src/features/report/application/artifact-refs.ts`.
//!
//! Syntax: `![caption](expartifact:<experimentId>/<artifactName>)`, parallel to `reportimg:`.
//! [`ParsedArtifactRef::start`] and [`ParsedArtifactRef::end`] count UTF-16 code units, as
//! JavaScript does, so the TS side can slice the source string it holds.

use std::fmt::Write as _;
use std::sync::LazyLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};

/// Prefix of an experiment artifact destination (TS `EXPERIMENT_ARTIFACT_PREFIX`).
pub const EXPERIMENT_ARTIFACT_PREFIX: &str = "expartifact:";

/// Matches `![alt](expartifact:path)`. Group 1 is the alt text, group 2 the path.
static REF_RE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"!\[([^\]]*)\]\(expartifact:([^)\s]+)\)").ok());

/// An artifact reference as written in a report (TS `ArtifactRef`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ArtifactRef {
    /// Id of the experiment that produced the artifact.
    pub experiment_id: String,
    /// Artifact name or URL; matched by basename when the stored URL is signed.
    pub artifact_name: String,
    /// Alt text. Omitted means the default caption `artifact`; `""` keeps an empty alt.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub alt: Option<String>,
}

/// A reference found in markdown, with its source span (TS `ParsedArtifactRef`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ParsedArtifactRef {
    /// Trimmed experiment id.
    pub experiment_id: String,
    /// Trimmed artifact name, percent-decoded.
    pub artifact_name: String,
    /// Alt text as written (empty when the image had none).
    pub alt: String,
    /// Start offset in UTF-16 code units (inclusive).
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub start: usize,
    /// End offset in UTF-16 code units (exclusive).
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub end: usize,
    /// The exact matched markdown.
    pub raw: String,
}

/// A reference found by the scanner, with byte offsets for slicing the source in this crate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ScannedRef {
    /// Trimmed experiment id.
    pub(crate) experiment_id: String,
    /// Trimmed artifact name.
    pub(crate) artifact_name: String,
    /// Alt text as written.
    pub(crate) alt: String,
    /// The exact matched markdown.
    pub(crate) raw: String,
    /// Byte offset of the match start.
    pub(crate) byte_start: usize,
    /// Byte offset just past the match.
    pub(crate) byte_end: usize,
}

/// Inverse of [`parse_artifact_refs`]: the canonical markdown for a reference.
#[must_use]
pub fn serialise_artifact_ref(artifact_ref: &ArtifactRef) -> String {
    // An explicit empty alt stays empty; an omitted one defaults to "artifact".
    let alt = match artifact_ref.alt.as_deref() {
        None => "artifact".to_owned(),
        Some(raw) => {
            let escaped = escape_alt(raw);
            if !escaped.is_empty() {
                escaped
            } else if raw.is_empty() {
                String::new()
            } else {
                "artifact".to_owned()
            }
        }
    };
    format!(
        "![{alt}]({EXPERIMENT_ARTIFACT_PREFIX}{}/{})",
        encode_ref_part(&artifact_ref.experiment_id),
        encode_ref_part(&artifact_ref.artifact_name),
    )
}

/// Every experiment-artifact reference in `markdown`, with UTF-16 offsets.
///
/// Wikilinks, `reportimg:` embeds and ordinary images are ignored. A raw `(` in the path is
/// rejected, because a Markdown destination ends at `)`; callers must percent-encode parentheses.
#[must_use]
pub fn parse_artifact_refs(markdown: &str) -> Vec<ParsedArtifactRef> {
    scan_artifact_refs(markdown)
        .into_iter()
        .map(|found| {
            let start = utf16_len(&markdown[..found.byte_start]);
            ParsedArtifactRef {
                start,
                end: start + utf16_len(&found.raw),
                experiment_id: found.experiment_id,
                artifact_name: found.artifact_name,
                alt: found.alt,
                raw: found.raw,
            }
        })
        .collect()
}

/// Basename of an artifact URL or path, so a signed URL and its plain name compare equal.
#[must_use]
pub fn artifact_basename(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    url_basename(trimmed).unwrap_or_else(|| last_segment_fallback(trimmed))
}

/// Scans `markdown` for references, keeping byte offsets. Used by the parser and the renderer.
pub(crate) fn scan_artifact_refs(markdown: &str) -> Vec<ScannedRef> {
    let Some(regex) = REF_RE.as_ref() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for captures in regex.captures_iter(markdown) {
        let Some(whole) = captures.get(0) else {
            continue;
        };
        let alt = captures.get(1).map_or("", |m| m.as_str());
        let path = captures.get(2).map_or("", |m| m.as_str());
        // Hand-written paths with a raw `(` truncate at `)`, so fail closed.
        if path.contains('(') {
            continue;
        }
        let Some(slash) = path.find('/') else {
            continue;
        };
        if slash == 0 || slash == path.len() - 1 {
            continue;
        }
        let (Some(experiment_id), Some(artifact_name)) = (
            decode_ref_part(&path[..slash]),
            decode_ref_part(&path[slash + 1..]),
        ) else {
            continue;
        };
        let id_trimmed = experiment_id.trim();
        let name_trimmed = artifact_name.trim();
        // Reject padded or whitespace-only parts; store trimmed so resolve matches.
        if id_trimmed.is_empty()
            || name_trimmed.is_empty()
            || id_trimmed != experiment_id
            || name_trimmed != artifact_name
        {
            continue;
        }
        out.push(ScannedRef {
            experiment_id: id_trimmed.to_owned(),
            artifact_name: name_trimmed.to_owned(),
            alt: alt.to_owned(),
            raw: whole.as_str().to_owned(),
            byte_start: whole.start(),
            byte_end: whole.end(),
        });
    }
    out
}

/// Collapses every run of whitespace to one space (JS `replace(/\s+/g, " ")`).
#[must_use]
pub(crate) fn collapse_whitespace(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_space = false;
    for ch in text.chars() {
        if ch.is_whitespace() {
            if !in_space {
                out.push(' ');
            }
            in_space = true;
        } else {
            out.push(ch);
            in_space = false;
        }
    }
    out
}

/// Alt text safe to put inside `![...]`. Brackets are stripped, not escaped, because the parser
/// reads alt with `[^\]]*` and cannot round-trip `\]`.
fn escape_alt(alt: &str) -> String {
    collapse_whitespace(alt)
        .chars()
        .filter(|c| *c != '[' && *c != ']')
        .collect::<String>()
        .trim()
        .to_owned()
}

/// `encodeURIComponent`, with `!'()*` also encoded so a parenthesis cannot end the destination.
fn encode_ref_part(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for &byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(char::from(byte));
        } else {
            let _ = write!(out, "%{byte:02X}");
        }
    }
    out
}

/// Decodes a path segment. Well-formed `%HH` decodes; a bare `%` stays literal, so `100%done.png`
/// keeps its name. `None` only when the result is not valid UTF-8.
fn decode_ref_part(value: &str) -> Option<String> {
    let repaired = String::from_utf8(repair_bare_percent(value)).ok()?;
    decode_uri_component(&repaired)
}

/// Replaces each `%` not followed by two hex digits with `%25`.
fn repair_bare_percent(value: &str) -> Vec<u8> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    for (index, &byte) in bytes.iter().enumerate() {
        if byte == b'%' && !is_hex_escape(bytes, index) {
            out.extend_from_slice(b"%25");
        } else {
            out.push(byte);
        }
    }
    out
}

fn is_hex_escape(bytes: &[u8], index: usize) -> bool {
    bytes
        .get(index + 1)
        .is_some_and(|&b| hex_value(b).is_some())
        && bytes
            .get(index + 2)
            .is_some_and(|&b| hex_value(b).is_some())
}

/// `decodeURIComponent`: `None` on a malformed escape or invalid UTF-8.
fn decode_uri_component(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = hex_value(*bytes.get(index + 1)?)?;
            let low = hex_value(*bytes.get(index + 2)?)?;
            out.push(high * 16 + low);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// The last path segment of a URL, decoded. `None` when `trimmed` does not parse as a URL or the
/// segment does not decode; the caller then falls back to splitting on `/` or `\`.
fn url_basename(trimmed: &str) -> Option<String> {
    let url = url::Url::parse(trimmed).ok()?;
    let segment = url
        .path()
        .split('/')
        .rfind(|s| !s.is_empty())
        .unwrap_or(trimmed);
    decode_uri_component(segment)
}

fn last_segment_fallback(trimmed: &str) -> String {
    trimmed
        .split(['\\', '/'])
        .rfind(|s| !s.is_empty())
        .unwrap_or(trimmed)
        .to_owned()
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn artifact_ref(experiment_id: &str, artifact_name: &str, alt: Option<&str>) -> ArtifactRef {
        ArtifactRef {
            experiment_id: experiment_id.to_owned(),
            artifact_name: artifact_name.to_owned(),
            alt: alt.map(str::to_owned),
        }
    }

    #[test]
    fn parses_one_ref_with_utf16_offsets() {
        let md = "See ![loss](expartifact:exp1/loss.png) above.";
        let refs = parse_artifact_refs(md);
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].experiment_id, "exp1");
        assert_eq!(refs[0].artifact_name, "loss.png");
        assert_eq!(refs[0].alt, "loss");
        assert_eq!((refs[0].start, refs[0].end), (4, 38));
        assert_eq!(refs[0].raw, "![loss](expartifact:exp1/loss.png)");
    }

    #[test]
    fn offsets_count_utf16_units_after_non_ascii() {
        let md = "é 😀 ![a](expartifact:e1/a.png)";
        let refs = parse_artifact_refs(md);
        assert_eq!(refs.len(), 1);
        // "é 😀 " is 5 UTF-16 units ("😀" is two).
        assert_eq!(refs[0].start, 5);
        assert_eq!(refs[0].end, 5 + refs[0].raw.encode_utf16().count());
    }

    #[test]
    fn ignores_wikilinks_and_other_images() {
        let md =
            "Compare [[Paper]] and ![photo](https://example/a.png) and ![x](reportimg:u/s/f.webp)";
        assert!(parse_artifact_refs(md).is_empty());
    }

    #[test]
    fn parses_multiple_refs_with_subdirectory_names() {
        let md = "![a](expartifact:e1/a.png) then ![b](expartifact:e2/subdir/b.webp)";
        let refs = parse_artifact_refs(md);
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].experiment_id, "e1");
        assert_eq!(refs[1].experiment_id, "e2");
        assert_eq!(refs[1].artifact_name, "subdir/b.webp");
    }

    #[test]
    fn serialise_round_trips_with_parse() {
        let raw = serialise_artifact_ref(&artifact_ref("exp-9", "plots/acc.png", Some("Accuracy")));
        assert_eq!(raw, "![Accuracy](expartifact:exp-9/plots%2Facc.png)");
        let parsed = &parse_artifact_refs(&format!("Intro {raw} outro"))[0];
        assert_eq!(parsed.artifact_name, "plots/acc.png");
        assert_eq!(parsed.alt, "Accuracy");
        assert_eq!(
            serialise_artifact_ref(&artifact_ref(
                &parsed.experiment_id,
                &parsed.artifact_name,
                Some(&parsed.alt)
            )),
            raw
        );
    }

    #[test]
    fn serialise_encodes_space_and_parentheses() {
        let raw =
            serialise_artifact_ref(&artifact_ref("exp 9", "plots/loss (1).png", Some("Loss")));
        assert_eq!(
            raw,
            "![Loss](expartifact:exp%209/plots%2Floss%20%281%29.png)"
        );
        let parsed = &parse_artifact_refs(&raw)[0];
        assert_eq!(parsed.experiment_id, "exp 9");
        assert_eq!(parsed.artifact_name, "plots/loss (1).png");
    }

    #[test]
    fn serialise_strips_brackets_from_alt() {
        let raw = serialise_artifact_ref(&artifact_ref("e1", "a.png", Some("Fig [1]")));
        assert_eq!(raw, "![Fig 1](expartifact:e1/a.png)");
    }

    #[test]
    fn serialise_defaults_missing_alt_and_keeps_empty_alt() {
        assert_eq!(
            serialise_artifact_ref(&artifact_ref("e1", "a.png", None)),
            "![artifact](expartifact:e1/a.png)"
        );
        assert_eq!(
            serialise_artifact_ref(&artifact_ref("e1", "a.png", Some(""))),
            "![](expartifact:e1/a.png)"
        );
        assert_eq!(
            serialise_artifact_ref(&artifact_ref("e1", "a.png", Some("[]"))),
            "![artifact](expartifact:e1/a.png)"
        );
    }

    #[test]
    fn skips_malformed_and_invalid_paths() {
        let md = [
            "![a](expartifact:noslash)",
            "![b](expartifact:/a.png)",
            "![c](expartifact:e1/)",
            "![e](expartifact:%20/a.png)",
            "![f](expartifact:%20exp/a.png)",
            "![g](expartifact:e1/loss(1).png)",
        ]
        .join(" ");
        assert!(parse_artifact_refs(&md).is_empty());
    }

    #[test]
    fn keeps_bare_percent_signs_in_legacy_paths() {
        let refs =
            parse_artifact_refs("![a](expartifact:e1/100%done.png) ![b](expartifact:e1/%ZZ)");
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].artifact_name, "100%done.png");
        assert_eq!(refs[1].artifact_name, "%ZZ");
    }

    #[test]
    fn duplicate_refs_get_distinct_offsets() {
        let raw = "![a](expartifact:e1/a.png)";
        let markdown = format!("{raw} then {raw}");
        let refs = parse_artifact_refs(&markdown);
        assert_eq!(refs.len(), 2);
        assert_ne!(refs[0].start, refs[1].start);
    }

    #[test]
    fn basename_strips_query_and_directories() {
        assert_eq!(
            artifact_basename("https://cdn.test/plots/loss.png?token=abc"),
            "loss.png"
        );
        assert_eq!(artifact_basename("loss.png"), "loss.png");
        // Not a URL, so the last `/` or `\` segment wins (JS falls back the same way).
        assert_eq!(artifact_basename("runs\\loss.png"), "loss.png");
        assert_eq!(artifact_basename("   "), "");
    }

    #[test]
    fn basename_decodes_percent_escapes_in_urls() {
        assert_eq!(
            artifact_basename("https://cdn.test/my%20plot.png"),
            "my plot.png"
        );
    }
}
