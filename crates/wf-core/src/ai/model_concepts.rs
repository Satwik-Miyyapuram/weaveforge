//! Reading a model's concept-extraction reply (TS `parseExtractionJson` and `toExtractionResult`,
//! `packages/core/src/features/ai-assistant/domain/model-concept-extractor.ts`).

use std::collections::HashSet;

use serde_json::{Map, Value};

use crate::ai::extraction::{ExtractedConcept, ExtractedMention, ExtractionResult, concept_key};
use crate::search::js_text::is_js_whitespace;

/// Concept kinds the model may name (TS `CONCEPT_KINDS`). Anything else becomes `concept`.
const CONCEPT_KINDS: [&str; 6] = ["concept", "method", "dataset", "metric", "person", "venue"];

/// Pull the `concepts` array out of a model reply.
///
/// Scans for balanced `{...}` objects and takes the first with a `concepts` array. Braces that
/// are not JSON, or objects without that array, are passed over. Nothing parseable gives `[]`.
#[must_use]
pub fn parse_extraction_json(text: &str) -> Vec<Value> {
    for (start, _) in text.match_indices('{') {
        // An unclosed brace (a stray `{` in prose) is skipped, not a reason to stop.
        let Some(end) = balanced_object_end(text.as_bytes(), start) else {
            continue;
        };
        if let Ok(Value::Object(object)) = serde_json::from_str::<Value>(&text[start..=end])
            && let Some(Value::Array(concepts)) = object.get("concepts")
        {
            return concepts.clone();
        }
    }
    Vec::new()
}

/// Index of the `}` closing the object opened at `start`, honouring JSON strings and escapes.
fn balanced_object_end(bytes: &[u8], start: usize) -> Option<usize> {
    let mut depth: usize = 0;
    let mut in_string = false;
    let mut escaped = false;

    for (index, &byte) in bytes.iter().enumerate().skip(start) {
        if escaped {
            escaped = false;
        } else if byte == b'\\' {
            escaped = true;
        } else if byte == b'"' {
            in_string = !in_string;
        } else if !in_string && byte == b'{' {
            depth += 1;
        } else if !in_string && byte == b'}' {
            depth -= 1;
            if depth == 0 {
                return Some(index);
            }
        }
    }
    None
}

/// Turn parsed concepts into an extraction result.
///
/// Document ids are kept only when they name a document in `batch_ids`. A concept with no valid
/// id is dropped, and so is a repeated concept (by [`concept_key`]). Malformed entries are skipped.
#[must_use]
pub fn to_extraction_result(raw: &[Value], batch_ids: &[String]) -> ExtractionResult {
    let valid: HashSet<&str> = batch_ids.iter().map(String::as_str).collect();
    let mut concepts = Vec::new();
    let mut mentions = Vec::new();
    let mut seen = HashSet::new();

    for entry in raw {
        let Some(entry) = entry.as_object() else {
            continue;
        };
        let name = string_field(entry, "name").map_or("", trim_js);
        if name.is_empty() {
            continue;
        }
        let key = concept_key(name);

        let document_ids: Vec<String> = string_array(entry, "documentIds")
            .into_iter()
            .filter(|id| valid.contains(id.as_str()))
            .collect();
        // A concept the model cannot tie to a document has no evidence behind it.
        if document_ids.is_empty() {
            continue;
        }
        // A repeat of an earlier concept is dropped, as is one already seen.
        if !seen.insert(key.clone()) {
            continue;
        }

        let aliases = string_array(entry, "aliases")
            .into_iter()
            .filter(|alias| concept_key(alias) != key)
            .collect();
        let kind = string_field(entry, "kind")
            .filter(|kind| CONCEPT_KINDS.contains(kind))
            .unwrap_or("concept")
            .to_owned();
        #[allow(clippy::cast_precision_loss)]
        let count = document_ids.len() as f64;
        concepts.push(ExtractedConcept {
            name: name.to_owned(),
            aliases,
            kind,
            mentions: count,
        });

        let evidence = string_field(entry, "evidence").map_or("", trim_js);
        for document_id in document_ids {
            mentions.push(ExtractedMention {
                document_id,
                concept_name: name.to_owned(),
                evidence: evidence.to_owned(),
            });
        }
    }

    ExtractionResult {
        concepts,
        mentions,
        pending: None,
    }
}

/// The field as a string, when it is one.
fn string_field<'a>(entry: &'a Map<String, Value>, field: &str) -> Option<&'a str> {
    entry.get(field).and_then(Value::as_str)
}

/// The non-blank strings of an array field, untrimmed; a non-array gives none.
fn string_array(entry: &Map<String, Value>, field: &str) -> Vec<String> {
    entry
        .get(field)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .filter(|text| !trim_js(text).is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn trim_js(value: &str) -> &str {
    value.trim_matches(is_js_whitespace)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn ids(values: &[&str]) -> Vec<String> {
        values.iter().map(|v| (*v).to_owned()).collect()
    }

    #[test]
    fn parses_a_fenced_reply_with_a_preamble() {
        let reply =
            "Sure { here is the answer:\n```json\n{\"concepts\":[{\"name\":\"Graph\"}]}\n```";
        let concepts = parse_extraction_json(reply);
        assert_eq!(concepts, vec![json!({"name": "Graph"})]);
    }

    #[test]
    fn skips_objects_without_a_concepts_list() {
        let reply = "{\"other\":1} then {\"concepts\":[{\"name\":\"A\"}]}";
        assert_eq!(parse_extraction_json(reply).len(), 1);
    }

    #[test]
    fn braces_inside_strings_do_not_close_the_object() {
        let reply = r#"{"concepts":[{"name":"a } b","evidence":"x \"}\" y"}]}"#;
        assert_eq!(parse_extraction_json(reply).len(), 1);
    }

    #[test]
    fn unparseable_or_unclosed_reply_gives_nothing() {
        assert!(parse_extraction_json("no json here").is_empty());
        assert!(parse_extraction_json("{\"concepts\":[").is_empty());
    }

    #[test]
    fn drops_unknown_documents_and_unsupported_concepts() {
        let raw = [
            json!({"name": " Graph ", "documentIds": ["d1", "ghost"], "kind": "method", "evidence": " quote "}),
            json!({"name": "Orphan", "documentIds": ["ghost"]}),
            json!(null),
            json!("bare string"),
        ];
        let out = to_extraction_result(&raw, &ids(&["d1"]));
        assert_eq!(out.concepts.len(), 1);
        assert_eq!(out.concepts[0].name, "Graph");
        assert_eq!(out.concepts[0].kind, "method");
        assert_eq!(out.concepts[0].mentions, 1.0);
        assert_eq!(out.mentions.len(), 1);
        assert_eq!(out.mentions[0].evidence, "quote");
        assert_eq!(out.mentions[0].concept_name, "Graph");
        assert!(out.pending.is_none());
    }

    #[test]
    fn unknown_kind_becomes_concept_and_repeats_are_dropped() {
        let raw = [
            json!({"name": "Net", "documentIds": ["d1"], "kind": "gizmo"}),
            json!({"name": "net", "documentIds": ["d1"], "kind": "method"}),
        ];
        let out = to_extraction_result(&raw, &ids(&["d1"]));
        assert_eq!(out.concepts.len(), 1);
        assert_eq!(out.concepts[0].kind, "concept");
    }

    #[test]
    fn aliases_equal_to_the_name_are_removed() {
        let raw = [json!({
            "name": "VAE",
            "aliases": ["vae", "Variational Autoencoder", 3],
            "documentIds": ["d1"]
        })];
        let out = to_extraction_result(&raw, &ids(&["d1"]));
        assert_eq!(out.concepts[0].aliases, ["Variational Autoencoder"]);
    }
}
