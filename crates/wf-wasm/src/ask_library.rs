//! Ask-your-library prompt and citations for JavaScript (wf-core `search::ask_library` and
//! `ai::retrieval::cited_sources`). The JS names match `apps/web/src/features/search/application/parts-1.ts`.

use js_sys::{Array, Object, Reflect};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::ai::retrieval::cited_sources;
use wf_core::search::ask_library::{self, AskSource};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// The fields of a search hit the prompt reads, as the JS hit carries them.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AskHit {
    title: String,
    page: Option<u32>,
    excerpt: Option<AskExcerpt>,
}

/// The excerpt's text, the only part of a JS excerpt the prompt reads.
#[derive(Debug, Clone, Deserialize)]
struct AskExcerpt {
    text: String,
}

/// One chat turn of the ask request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct AskMessage {
    role: &'static str,
    content: String,
}

/// The ask request before the app wraps it as a model request.
#[derive(Debug, Clone, PartialEq, Serialize)]
struct AskRequest {
    messages: [AskMessage; 2],
    temperature: f64,
}

/// Maps the hits to the prompt's sources, with an empty excerpt treated as none.
fn sources_from_hits(hits: Vec<AskHit>) -> Vec<AskSource> {
    hits.into_iter()
        .map(|hit| AskSource {
            title: hit.title,
            page: hit.page,
            excerpt: hit.excerpt.map(|excerpt| excerpt.text),
        })
        .collect()
}

/// The system and user turns for `question` over `sources`, at the ask temperature.
fn ask_request(question: &str, sources: &[AskSource], nonce: &str) -> AskRequest {
    let prompt = ask_library::ask_prompt(question, sources, nonce);
    AskRequest {
        messages: [
            AskMessage {
                role: "system",
                content: prompt.system,
            },
            AskMessage {
                role: "user",
                content: prompt.user,
            },
        ],
        temperature: 0.2,
    }
}

/// The hits named by `[n]` or `[n, m]` markers, in first-citation order, each once, as
/// `(n, hit)` where `n` is 1-based.
#[cfg(test)]
fn cited_pairs<'a, T>(answer: &str, hits: &'a [T]) -> Vec<(usize, &'a T)> {
    cited_sources(answer, hits.len())
        .into_iter()
        .map(|n| (n, &hits[n - 1]))
        .collect()
}

/// [`ask_prompt`](ask_library::ask_prompt): `{ system, user }` for the sources as passed.
#[wasm_bindgen(js_name = askPrompt, unchecked_return_type = "B.AskPrompt")]
pub fn ask_prompt_js(
    question: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly B.AskSource[]")] sources: JsValue,
    nonce: &str,
) -> JsResult<JsValue> {
    let sources: Vec<AskSource> = serde_wasm_bindgen::from_value(sources)?;
    serde_wasm_bindgen::to_value(&ask_library::ask_prompt(question, &sources, nonce))
}

/// The ask request `{ messages: [system, user], temperature }` for the search hits.
///
/// # Errors
///
/// Fails if `hits` is not an array of search hits.
#[wasm_bindgen(
    js_name = buildAskRequest,
    unchecked_return_type = "{ readonly messages: readonly [{ readonly role: \"system\"; readonly content: string }, { readonly role: \"user\"; readonly content: string }]; readonly temperature: number }"
)]
pub fn build_ask_request_js(
    question: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly SearchHit[]")] hits: JsValue,
    nonce: &str,
) -> JsResult<JsValue> {
    let hits: Vec<AskHit> = serde_wasm_bindgen::from_value(hits)?;
    to_js(&ask_request(question, &sources_from_hits(hits), nonce))
}

/// The hits an answer cites, as `{ n, hit }` in first-citation order. `hit` is the element of
/// `hits` itself, so object identity is kept.
///
/// # Errors
///
/// Fails if `hits` is not an array.
#[wasm_bindgen(
    js_name = citedSources,
    unchecked_return_type = "readonly { readonly n: number; readonly hit: SearchHit }[]"
)]
pub fn cited_sources_js(
    answer: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly SearchHit[]")] hits: JsValue,
) -> Result<JsValue, JsValue> {
    let hits: Array = hits.unchecked_into();
    let out = Array::new();
    for n in cited_sources(answer, usize::try_from(hits.length()).unwrap_or(usize::MAX)) {
        let entry = Object::new();
        let number = u32::try_from(n).unwrap_or(u32::MAX);
        let index = u32::try_from(n - 1).unwrap_or(u32::MAX);
        let _ = Reflect::set(&entry, &"n".into(), &JsValue::from_f64(f64::from(number)))?;
        let _ = Reflect::set(&entry, &"hit".into(), &hits.get(index))?;
        let _ = out.push(&entry);
    }
    Ok(out.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(title: &str, page: Option<u32>, excerpt: Option<&str>) -> AskHit {
        AskHit {
            title: title.to_owned(),
            page,
            excerpt: excerpt.map(|text| AskExcerpt {
                text: text.to_owned(),
            }),
        }
    }

    #[test]
    fn request_has_system_then_user_turn_at_low_temperature() {
        let hits = vec![hit("Attention", Some(3), Some("Self-attention"))];
        let request = ask_request("What?", &sources_from_hits(hits), "n0nce");
        assert_eq!(request.messages[0].role, "system");
        assert_eq!(request.messages[1].role, "user");
        assert!(request.messages[0].content.contains("<<context-n0nce>>"));
        assert!(
            request.messages[1]
                .content
                .contains("[1]\nAttention (p. 3)\nSelf-attention")
        );
        assert!((request.temperature - 0.2).abs() < f64::EPSILON);
    }

    #[test]
    fn a_hit_with_only_a_title_keeps_just_the_heading() {
        let sources = sources_from_hits(vec![hit("Only a title", None, None)]);
        let prompt = ask_library::ask_prompt("Q?", &sources, "n0nce");
        assert!(prompt.user.contains("[1]\nOnly a title"));
    }

    #[test]
    fn an_empty_excerpt_is_treated_as_none() {
        let sources = sources_from_hits(vec![hit("T", None, Some(""))]);
        assert_eq!(sources[0].excerpt, Some(String::new()));
        assert_eq!(ask_library::source_text(&sources[0]), "T");
    }

    #[test]
    fn citations_follow_first_mention_and_skip_out_of_range() {
        let hits = ["a", "b"];
        let cited = cited_pairs("See [2] and [1][2], not [3] or [0]. Also [1, 2].", &hits);
        let pairs: Vec<(usize, &str)> = cited.into_iter().map(|(n, h)| (n, *h)).collect();
        assert_eq!(pairs, vec![(2, "b"), (1, "a")]);
    }
}
