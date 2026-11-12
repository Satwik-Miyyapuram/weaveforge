//! Concept extraction, folder drafts, APA references, presence and text anchors for
//! JavaScript (wf-core `ai::extraction`, `ai::folder_draft`, `papers::reference_text`,
//! `collab`, `text_anchor`).

use js_sys::{Array, Map, Reflect};
use serde_json::Value;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ai::extraction::{self, ExtractionResult};
use wf_core::ai::folder_draft;
use wf_core::collab::{self, Peer};
use wf_core::papers::reference_text::{self, ReferencePaper};
use wf_core::sharing::CommentAnchor;
use wf_core::text_anchor;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`concept_key`](extraction::concept_key).
#[wasm_bindgen(js_name = conceptKey)]
#[must_use]
pub fn concept_key_js(name: &str) -> String {
    extraction::concept_key(name)
}

/// [`merge_extractions`](extraction::merge_extractions).
///
/// # Errors
///
/// Fails when `results` is not a list of extraction results.
#[wasm_bindgen(js_name = mergeExtractions, unchecked_return_type = "B.ExtractionResult")]
pub fn merge_extractions_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ExtractionResult[]")] results: JsValue,
) -> JsResult<JsValue> {
    let results: Vec<ExtractionResult> = serde_wasm_bindgen::from_value(results)?;
    to_js(&extraction::merge_extractions(&results))
}

/// [`without_existing`](extraction::without_existing).
///
/// # Errors
///
/// Fails when `result` is not an extraction result.
#[wasm_bindgen(js_name = withoutExisting, unchecked_return_type = "B.ExtractionResult")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs an owned Vec<String>.
pub fn without_existing_js(
    #[wasm_bindgen(unchecked_param_type = "B.ExtractionResult")] result: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] existing: Vec<String>,
) -> JsResult<JsValue> {
    let result: ExtractionResult = serde_wasm_bindgen::from_value(result)?;
    to_js(&extraction::without_existing(&result, &existing))
}

/// [`parse_folder_draft`](folder_draft::parse_folder_draft): the draft, or `null`.
///
/// # Errors
///
/// Fails only if the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = parseFolderDraft, unchecked_return_type = "{ kind: string; tool: string; resourceId: string; resourceType?: string; content: string; payload?: Record<string, unknown>; sourceLinks?: string[]; expectedRevision?: string; createdAt?: string; projectId?: string } | null")]
pub fn parse_folder_draft_js(raw: &str) -> JsResult<JsValue> {
    folder_draft::parse_folder_draft(raw).map_or(Ok(JsValue::NULL), |draft| to_js(&draft))
}

/// [`format_reference`](reference_text::format_reference).
///
/// # Errors
///
/// Fails when `paper` is not a paper.
#[wasm_bindgen(js_name = formatReference)]
pub fn format_reference_js(
    #[wasm_bindgen(
        unchecked_param_type = "Omit<B.ReferencePaper, \"authors\"> & { authors: readonly string[] }"
    )]
    paper: JsValue,
) -> JsResult<String> {
    let paper: ReferencePaper = serde_wasm_bindgen::from_value(paper)?;
    Ok(reference_text::format_reference(&paper))
}

/// [`peers_from_states`](collab::peers_from_states); `users` is `[clientId, user][]`.
///
/// # Errors
///
/// Fails when `users` is not a list of pairs.
#[wasm_bindgen(js_name = peersFromUsers, unchecked_return_type = "B.Peer[]")]
pub fn peers_from_users_js(
    #[wasm_bindgen(unchecked_param_type = "readonly (readonly [number, unknown])[]")]
    users: JsValue,
    self_client_id: f64,
    self_author_id: &str,
) -> JsResult<JsValue> {
    let users: Vec<(f64, Value)> = serde_wasm_bindgen::from_value(users)?;
    to_js(&collab::peers_from_states(
        &users,
        self_client_id,
        self_author_id,
    ))
}

/// `state?.user ?? null` for one awareness state.
fn user_of(state: &JsValue) -> Result<JsValue, JsValue> {
    let user = if state.is_object() || state.is_function() {
        Reflect::get(state, &JsValue::from_str("user"))?
    } else {
        JsValue::UNDEFINED
    };
    Ok(if user.is_undefined() || user.is_null() {
        JsValue::NULL
    } else {
        user
    })
}

/// [`peers_from_states`](collab::peers_from_states) over awareness states: one entry per
/// other person (not you, not your other sessions, one per person). `me` is your
/// `{ clientId, authorId }`.
///
/// # Errors
///
/// Throws when `me` or a state cannot be read, or a user is not a JSON value.
#[wasm_bindgen(js_name = peersFromStates, unchecked_return_type = "B.Peer[]")]
pub fn peers_from_states_js(
    #[wasm_bindgen(unchecked_param_type = "ReadonlyMap<number, unknown>")] states: &Map,
    #[wasm_bindgen(unchecked_param_type = "{ clientId: number; authorId: string }")] me: &JsValue,
) -> Result<JsValue, JsValue> {
    let pairs = Array::new();
    let mut failure = None;
    states.for_each(&mut |state, id| match user_of(&state) {
        Ok(user) => {
            let _ = pairs.push(&Array::of2(&id, &user));
        }
        Err(error) => {
            let _ = failure.get_or_insert(error);
        }
    });
    if let Some(error) = failure {
        return Err(error);
    }
    let client_id = Reflect::get(me, &JsValue::from_str("clientId"))?.unchecked_into_f64();
    let author_id = Reflect::get(me, &JsValue::from_str("authorId"))?
        .as_string()
        .ok_or_else(|| JsValue::from(js_sys::TypeError::new("authorId must be a string")))?;
    let users: Vec<(f64, Value)> = serde_wasm_bindgen::from_value(pairs.into())?;
    Ok(to_js(&collab::peers_from_states(
        &users, client_id, &author_id,
    ))?)
}

/// [`same_peers`](collab::same_peers).
///
/// # Errors
///
/// Fails when either list is not a list of peers.
#[wasm_bindgen(js_name = samePeers)]
pub fn same_peers_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.Peer[]")] a: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.Peer[]")] b: JsValue,
) -> JsResult<bool> {
    let a: Vec<Peer> = serde_wasm_bindgen::from_value(a)?;
    let b: Vec<Peer> = serde_wasm_bindgen::from_value(b)?;
    Ok(collab::same_peers(&a, &b))
}

/// [`anchor_at`](text_anchor::anchor_at): the anchor, or `null`.
///
/// # Errors
///
/// Fails only if the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = anchorAt, unchecked_return_type = "B.CommentAnchor | null")]
pub fn anchor_at_js(text: &str, start: f64, end: f64) -> JsResult<JsValue> {
    text_anchor::anchor_at(text, start, end).map_or(Ok(JsValue::NULL), |anchor| to_js(&anchor))
}

/// [`locate_anchor`](text_anchor::locate_anchor): `{ start, end }`, or `null`.
///
/// # Errors
///
/// Fails when `anchor` is not a comment anchor.
#[wasm_bindgen(js_name = locateAnchor, unchecked_return_type = "{ start: number; end: number } | null")]
pub fn locate_anchor_js(
    text: &str,
    #[wasm_bindgen(unchecked_param_type = "B.CommentAnchor")] anchor: JsValue,
) -> JsResult<JsValue> {
    let anchor: CommentAnchor = serde_wasm_bindgen::from_value(anchor)?;
    text_anchor::locate_anchor(text, &anchor).map_or(Ok(JsValue::NULL), |span| to_js(&span))
}

/// [`should_persist_body`](collab::should_persist_body).
#[wasm_bindgen(js_name = shouldPersistBody)]
pub fn should_persist_body_js(ready: bool, next: &str, last_saved: &str) -> bool {
    collab::should_persist_body(ready, next, last_saved)
}

/// [`compact_skip_reason`](collab::compact_skip_reason): `undefined` when the request should be sent.
#[wasm_bindgen(js_name = compactSkipReason, unchecked_return_type = "\"nothing-to-do\" | \"stale\" | undefined")]
#[must_use]
pub fn compact_skip_reason_js(snapshot_upto_id: f64, current_upto: Option<f64>) -> Option<String> {
    collab::compact_skip_reason(snapshot_upto_id, current_upto).map(str::to_owned)
}

/// [`span_points`](text_anchor::span_points): `lengths` are the text node lengths, in order.
///
/// # Errors
///
/// Fails when `lengths` is not a list of counts or `span` is not a text span.
#[wasm_bindgen(js_name = spanPoints, unchecked_return_type = "B.SpanPoints | null")]
pub fn span_points_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] lengths: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.TextSpan")] span: JsValue,
) -> JsResult<JsValue> {
    let lengths: Vec<usize> = serde_wasm_bindgen::from_value(lengths)?;
    let span: text_anchor::TextSpan = serde_wasm_bindgen::from_value(span)?;
    to_js(&text_anchor::span_points(&lengths, span))
}
