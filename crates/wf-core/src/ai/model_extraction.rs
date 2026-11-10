//! Port of the pure parts of packages/core/src/features/ai-assistant/domain/model-concept-extractor.ts.
//!
//! The batch loop, the model call and the error policy stay in the TS shim.
//! This module builds each batch's request, and merges batch results after the shim has collected them.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::ai::extraction::{
    ExtractionResult, concept_key, js_slice_keep, merge_extractions, without_existing,
};
use crate::ai::model_concepts::CONCEPT_KINDS;
use crate::ai::untrusted_context::{UNTRUSTED_CONTEXT_RULE, UntrustedItem, fence_untrusted};

/// Characters (UTF-16 units) of a document sent per batch.
pub const MAX_DOC_CHARS: usize = 6_000;
/// Documents per model call.
pub const DEFAULT_BATCH_SIZE: usize = 12;
/// Known concept names listed in the prompt.
pub const KNOWN_CONCEPT_LIMIT: usize = 200;

/// Defaults the TS shim reads, so the limits live in one place.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ModelExtractionLimits {
    /// Documents per model call.
    pub batch_size: f64,
    /// Characters of each document included.
    pub max_document_chars: f64,
    /// Known concept names listed in the prompt.
    pub known_concept_limit: f64,
}

/// One document in a batch (TS `ExtractionDocument`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ModelDocument {
    /// Note or paper id.
    pub id: String,
    /// Title shown beside the id.
    pub title: String,
    /// Body; absent reads as empty.
    #[serde(default)]
    pub text: Option<String>,
}

/// Who wrote a message (TS `AiMessage.role`, the two roles extraction uses).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ModelRole {
    /// Instructions to the model.
    System,
    /// The user's turn.
    User,
}

/// One message of a model request (TS `AiMessage`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ModelMessage {
    /// Who wrote the message.
    pub role: ModelRole,
    /// The message text.
    pub content: String,
}

/// A request for one batch (TS `AiModelRequest`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ModelRequest {
    /// The conversation, in order.
    pub messages: Vec<ModelMessage>,
    /// Passed through to the adapter; absent when not configured.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Extraction is a reading task, so sampling stays at zero.
    pub temperature: f64,
}

/// The system prompt. The kind list comes from the shared concept kinds.
pub fn system_prompt() -> String {
    [
        "You extract the named concepts a research corpus is about.".to_string(),
        "Return only JSON matching this shape, with no prose and no code fence:".to_string(),
        r#"{"concepts":[{"name":"","aliases":[],"kind":"","documentIds":[],"evidence":""}]}"#
            .to_string(),
        format!(r#""kind" must be one of: {}."#, CONCEPT_KINDS.join(", ")),
        r#""documentIds" must contain only ids from the input."#.to_string(),
        r#""evidence" must be a short verbatim quote from one of those documents."#.to_string(),
        "Prefer the name the corpus itself uses. Do not invent concepts that are not present."
            .to_string(),
    ]
    .join("\n")
}

/// The limits the TS shim starts from.
pub fn limits() -> ModelExtractionLimits {
    ModelExtractionLimits {
        batch_size: DEFAULT_BATCH_SIZE as f64,
        max_document_chars: MAX_DOC_CHARS as f64,
        known_concept_limit: KNOWN_CONCEPT_LIMIT as f64,
    }
}

/// The first `max_units` UTF-16 units of `text`. A surrogate pair split at the
/// boundary is dropped whole, since a Rust string cannot hold a lone surrogate.
fn take_utf16(text: &str, max_units: usize) -> String {
    let mut used = 0usize;
    let mut out = String::new();
    for ch in text.chars() {
        let width = ch.len_utf16();
        if used + width > max_units {
            break;
        }
        used += width;
        out.push(ch);
    }
    out
}

/// Builds the request for one batch. The nonce is supplied by the caller, who
/// generates it per batch so text that existed before the request cannot forge
/// the fence.
pub fn build_batch_request(
    batch: &[ModelDocument],
    existing: &[String],
    model: Option<&str>,
    max_chars: usize,
    nonce: &str,
) -> ModelRequest {
    let items: Vec<UntrustedItem> = batch
        .iter()
        .map(|doc| UntrustedItem {
            label: format!("id: {} — {}", doc.id, doc.title),
            text: take_utf16(doc.text.as_deref().unwrap_or(""), max_chars),
        })
        .collect();
    let corpus = fence_untrusted(&items, nonce);

    let known = &existing[..existing.len().min(KNOWN_CONCEPT_LIMIT)];
    let known_line = if known.is_empty() {
        String::new()
    } else {
        format!(
            "\nConcepts already in the wiki — reuse these names exactly rather than coining variants:\n{}\n",
            known.join(", ")
        )
    };

    let system = [
        system_prompt(),
        format!("Documents are delimited by <<context-{nonce}>> and <</context-{nonce}>>, each headed by its id."),
        UNTRUSTED_CONTEXT_RULE.to_string(),
    ]
    .join("\n");

    ModelRequest {
        messages: vec![
            ModelMessage {
                role: ModelRole::System,
                content: system,
            },
            ModelMessage {
                role: ModelRole::User,
                content: format!("{known_line}\nDocuments:\n\n{corpus}"),
            },
        ],
        model: model.map(str::to_string),
        temperature: 0.0,
    }
}

/// Merges the batch results, drops concepts already in the wiki, then caps the
/// concepts (JS `slice(0, max_concepts)` semantics, see `js_slice_keep`) and
/// keeps only mentions of the kept ones. A falsy cap means no cap.
pub fn finalize_extraction(
    results: &[ExtractionResult],
    existing: &[String],
    max_concepts: Option<f64>,
) -> ExtractionResult {
    let merged = merge_extractions(results);
    let filtered = without_existing(&merged, existing);
    let Some(keep) = js_slice_keep(filtered.concepts.len(), max_concepts) else {
        return filtered;
    };

    let concepts: Vec<_> = filtered.concepts.iter().take(keep).cloned().collect();
    let kept: HashSet<String> = concepts.iter().map(|c| concept_key(&c.name)).collect();
    let mentions = filtered
        .mentions
        .iter()
        .filter(|m| kept.contains(&concept_key(&m.concept_name)))
        .cloned()
        .collect();
    ExtractionResult {
        concepts,
        mentions,
        pending: filtered.pending,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::model_concepts::{parse_extraction_json, to_extraction_result};
    use serde_json::{Value, json};

    const REPLY: &str = r#"{"concepts":[{"name":"Attention","aliases":["Self-Attention"],"kind":"method","documentIds":["d1","d2"],"evidence":"multi-head attention"},{"name":"LSTM","aliases":[],"kind":"method","documentIds":["d2"],"evidence":"an LSTM"}]}"#;

    fn batch_ids() -> Vec<String> {
        vec!["d1".to_string(), "d2".to_string()]
    }

    /// Parse then convert against the two test documents, as the TS shim does.
    fn from_reply(text: &str) -> ExtractionResult {
        to_extraction_result(&parse_extraction_json(text), &batch_ids())
    }

    fn names(result: &ExtractionResult) -> Vec<String> {
        result.concepts.iter().map(|c| c.name.clone()).collect()
    }

    #[test]
    fn concepts_come_with_document_ids_as_mentions() {
        let result = from_reply(REPLY);
        assert_eq!(names(&result), vec!["Attention", "LSTM"]);
        let attention = &result.concepts[0];
        assert_eq!(attention.mentions, 2.0);
        assert_eq!(attention.aliases, vec!["Self-Attention"]);
        assert_eq!(result.mentions.len(), 3);
    }

    #[test]
    fn fence_and_preamble_around_the_json_are_tolerated() {
        let text = format!("Sure! Here you go:\n```json\n{REPLY}\n```\nHope that helps.");
        assert_eq!(parse_extraction_json(&text).len(), 2);
    }

    #[test]
    fn braces_inside_a_name_do_not_break_the_scan() {
        let text = r#"{"concepts":[{"name":"a }{ b","aliases":[],"kind":"concept","documentIds":["d1"]}]}"#;
        let parsed = parse_extraction_json(text);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0]["name"], "a }{ b");
    }

    #[test]
    fn escaped_quotes_in_a_name_survive() {
        let text = r#"{"concepts":[{"name":"say \"hi\"","aliases":[],"kind":"concept","documentIds":["d1"]}]}"#;
        let result = to_extraction_result(&parse_extraction_json(text), &batch_ids());
        assert_eq!(result.concepts[0].name, r#"say "hi""#);
    }

    #[test]
    fn a_reply_with_no_json_yields_no_concepts() {
        assert!(parse_extraction_json("I cannot help with that.").is_empty());
    }

    #[test]
    fn concepts_naming_only_unknown_documents_are_dropped() {
        let raw = vec![
            json!({"name": "Ghost", "aliases": [], "kind": "concept", "documentIds": ["nope"]}),
            json!({"name": "Real", "aliases": [], "kind": "concept", "documentIds": ["d1", "nope"]}),
        ];
        let result = to_extraction_result(&raw, &batch_ids());
        assert_eq!(names(&result), vec!["Real"]);
        assert_eq!(result.concepts[0].mentions, 1.0);
        assert_eq!(result.mentions.len(), 1);
        assert_eq!(result.mentions[0].document_id, "d1");
    }

    #[test]
    fn an_unknown_kind_becomes_concept() {
        let raw =
            vec![json!({"name": "X", "aliases": [], "kind": "nonsense", "documentIds": ["d1"]})];
        let result = to_extraction_result(&raw, &batch_ids());
        assert_eq!(result.concepts[0].kind, "concept");
    }

    #[test]
    fn an_alias_matching_the_name_is_dropped() {
        let raw = vec![
            json!({"name": "VAE", "aliases": ["vae", "Variational Autoencoder"], "kind": "method", "documentIds": ["d1"]}),
        ];
        let result = to_extraction_result(&raw, &batch_ids());
        assert_eq!(result.concepts[0].aliases, vec!["Variational Autoencoder"]);
    }

    #[test]
    fn concepts_already_in_the_wiki_are_removed() {
        let raw = parse_extraction_json(REPLY);
        let merged = finalize_extraction(
            &[to_extraction_result(&raw, &batch_ids())],
            &["attention".to_string()],
            None,
        );
        assert_eq!(names(&merged), vec!["LSTM"]);
        assert!(merged.mentions.iter().all(|m| m.concept_name == "LSTM"));
    }

    #[test]
    fn the_known_list_is_named_in_the_prompt() {
        let request = build_batch_request(
            &[ModelDocument {
                id: "d1".to_string(),
                title: "T".to_string(),
                text: Some("attention".to_string()),
            }],
            &["Transformer".to_string()],
            None,
            MAX_DOC_CHARS,
            "n0nce",
        );
        assert!(request.messages[1].content.contains("Transformer"));
    }

    #[test]
    fn the_cap_keeps_the_top_concept_and_only_its_mentions() {
        let raw = parse_extraction_json(REPLY);
        let result =
            finalize_extraction(&[to_extraction_result(&raw, &batch_ids())], &[], Some(1.0));
        assert_eq!(result.concepts.len(), 1);
        assert!(
            result
                .mentions
                .iter()
                .all(|m| m.concept_name == result.concepts[0].name)
        );
    }

    #[test]
    fn the_cap_follows_js_slice_for_odd_values() {
        let raw = parse_extraction_json(REPLY);
        let results = [to_extraction_result(&raw, &batch_ids())];
        let count = |max: Option<f64>| finalize_extraction(&results, &[], max).concepts.len();
        let uncapped = count(None);
        assert_eq!(uncapped, 2);
        assert_eq!(count(Some(f64::NAN)), uncapped);
        assert_eq!(count(Some(0.0)), uncapped);
        assert_eq!(count(Some(1.7)), 1);
        assert_eq!(count(Some(-1.0)), 1);
        assert_eq!(count(Some(f64::INFINITY)), 2);
        assert_eq!(count(Some(-5.0)), 0);
    }

    #[test]
    fn a_reply_that_is_only_empty_concepts_yields_none() {
        assert!(parse_extraction_json(r#"{"concepts":[]}"#).is_empty());
    }

    #[test]
    fn a_reply_without_a_concepts_key_yields_none() {
        assert!(parse_extraction_json(r#"{"status":"ok"}"#).is_empty());
    }

    #[test]
    fn a_template_before_the_real_json_is_skipped() {
        let text = format!("I filled in the {{concepts}} template:\n{REPLY}");
        assert_eq!(parse_extraction_json(&text).len(), 2);
    }

    #[test]
    fn a_status_object_before_the_real_json_is_skipped() {
        let text = format!("{{\"status\":\"ok\"}}\n{REPLY}");
        assert_eq!(parse_extraction_json(&text).len(), 2);
    }

    #[test]
    fn the_first_concepts_object_wins() {
        let text = r#"{"concepts":[]} and later {"concepts":[{"name":"x","documentIds":["d1"]}]}"#;
        assert!(parse_extraction_json(text).is_empty());
    }

    #[test]
    fn non_object_entries_are_ignored_and_objects_kept() {
        let raw: Vec<Value> = vec![
            Value::Null,
            json!(7),
            json!("attention"),
            json!([]),
            json!({"name": "Attention", "aliases": [], "kind": "concept", "documentIds": ["d1"]}),
        ];
        let result = to_extraction_result(&raw, &batch_ids());
        assert_eq!(names(&result), vec!["Attention"]);
        assert_eq!(result.mentions.len(), 1);
        assert_eq!(result.mentions[0].document_id, "d1");
        assert_eq!(result.mentions[0].concept_name, "Attention");
        assert_eq!(result.mentions[0].evidence, "");
    }

    #[test]
    fn null_entries_inside_the_concepts_list_are_skipped() {
        let text = r#"{"concepts":[null,{"name":"LSTM","aliases":[],"kind":"method","documentIds":["d2"]}]}"#;
        assert_eq!(names(&from_reply(text)), vec!["LSTM"]);
    }

    #[test]
    fn a_truncated_reply_yields_none() {
        assert!(parse_extraction_json(r#"{"concepts":[{"name":"x""#).is_empty());
        assert!(parse_extraction_json("}{").is_empty());
    }

    #[test]
    fn take_utf16_counts_units_not_chars() {
        assert_eq!(take_utf16("ab😀cd", 4), "ab😀");
        assert_eq!(take_utf16("ab😀cd", 3), "ab");
        assert_eq!(take_utf16("abc", 10), "abc");
    }

    #[test]
    fn the_request_sets_temperature_zero_and_the_model_only_when_given() {
        let batch = [ModelDocument {
            id: "d1".to_string(),
            title: "T".to_string(),
            text: None,
        }];
        let bare = build_batch_request(&batch, &[], None, MAX_DOC_CHARS, "n");
        assert_eq!(bare.temperature, 0.0);
        assert_eq!(bare.model, None);
        let named = build_batch_request(&batch, &[], Some("m-1"), MAX_DOC_CHARS, "n");
        assert_eq!(named.model.as_deref(), Some("m-1"));
    }
}
