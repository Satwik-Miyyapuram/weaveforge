//! Bring-your-own-key wire formats (TS `ByokModelConversation` in `byok-model-conversation.ts`).
//!
//! Builds the request each provider API expects and reads the reply text back out. No I/O: the
//! browser sends the request and hands the parsed reply back. There is no streamed-chunk parse in
//! the TS source; every call is a single JSON reply (`stream: false` for Ollama).

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{Value, json};

use super::chat_split::split_system;
use super::provider_descriptor::{ProviderApi, ProviderDescriptor};

/// Anthropic `max_tokens` (TS `4096`).
const ANTHROPIC_MAX_TOKENS: u64 = 4096;
/// Anthropic `anthropic-version` header.
const ANTHROPIC_VERSION: &str = "2023-06-01";
/// Longest provider error detail kept in an error message, in UTF-16 code units (TS `slice(0, 300)`).
const ERROR_DETAIL_UNITS: usize = 300;

/// One request to a provider: the URL, the headers and the JSON body (TS `buildRequest` result).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ByokRequest {
    /// Full endpoint URL.
    pub url: String,
    /// Request headers, by lower-case name.
    pub headers: BTreeMap<String, String>,
    /// JSON request body.
    pub body: Value,
}

/// Builds the request for `descriptor` from the chat `messages`. The key is sent only in the
/// provider's own auth header. Anthropic takes the system prompt as a field, the other APIs keep
/// the messages as they are.
#[must_use]
pub fn build_request(descriptor: &ProviderDescriptor, api_key: &str, messages: &[Value]) -> ByokRequest {
    let base = descriptor.base_url.trim_end_matches('/');
    match descriptor.api {
        ProviderApi::AnthropicMessages => {
            let split = split_system(messages);
            let mut body = json!({
                "model": descriptor.model,
                "max_tokens": ANTHROPIC_MAX_TOKENS,
                "messages": split.rest,
            });
            if !split.system.is_empty() {
                body["system"] = Value::String(split.system);
            }
            ByokRequest {
                url: format!("{base}/v1/messages"),
                headers: headers(&[
                    ("content-type", "application/json"),
                    ("x-api-key", api_key),
                    ("anthropic-version", ANTHROPIC_VERSION),
                    // Anthropic blocks browser calls unless this opt-in is present.
                    ("anthropic-dangerous-direct-browser-access", "true"),
                ]),
                body,
            }
        }
        ProviderApi::Ollama => ByokRequest {
            url: format!("{base}/api/chat"),
            headers: headers(&[("content-type", "application/json")]),
            body: json!({
                "model": descriptor.model,
                "messages": messages,
                "stream": false,
            }),
        },
        ProviderApi::OpenaiChat => {
            let bearer = format!("Bearer {api_key}");
            ByokRequest {
                url: format!("{base}/v1/chat/completions"),
                headers: headers(&[
                    ("content-type", "application/json"),
                    ("authorization", bearer.as_str()),
                ]),
                body: json!({ "model": descriptor.model, "messages": messages }),
            }
        }
    }
}

/// Whether the provider can be used: local providers need no key, hosted ones need a non-blank one.
#[must_use]
pub fn is_available(descriptor: &ProviderDescriptor, api_key: &str) -> bool {
    descriptor.api == ProviderApi::Ollama || !api_key.trim().is_empty()
}

/// The reply text in a provider's JSON `payload`. Anthropic joins its `text` blocks untrimmed;
/// the other APIs trim. `None` when the text is blank, which the caller reports as an empty reply.
#[must_use]
pub fn parse_reply(api: ProviderApi, payload: &Value) -> Option<String> {
    let text = match api {
        ProviderApi::AnthropicMessages => payload
            .get("content")
            .and_then(Value::as_array)
            .map(|blocks| {
                blocks
                    .iter()
                    .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
                    .map(|block| block.get("text").and_then(Value::as_str).unwrap_or(""))
                    .collect::<String>()
            })
            .unwrap_or_default(),
        ProviderApi::Ollama => payload
            .get("message")
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_owned(),
        ProviderApi::OpenaiChat => payload
            .get("choices")
            .and_then(|choices| choices.get(0))
            .and_then(|choice| choice.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_owned(),
    };
    if text.trim().is_empty() { None } else { Some(text) }
}

/// The message for a failed HTTP call: the provider's status, then its own detail text (cut to
/// 300 UTF-16 units) when there is any, so "insufficient quota" is not lost.
#[must_use]
pub fn http_error_message(label: &str, status: u16, detail: &str) -> String {
    if detail.is_empty() {
        return format!("{label} returned {status}");
    }
    let units: Vec<u16> = detail.encode_utf16().take(ERROR_DETAIL_UNITS).collect();
    format!("{label} returned {status}: {}", String::from_utf16_lossy(&units))
}

fn headers(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn descriptor(id: &str, api: ProviderApi, base_url: &str) -> ProviderDescriptor {
        ProviderDescriptor {
            id: id.to_owned(),
            label: "OpenAI".to_owned(),
            base_url: base_url.to_owned(),
            api,
            model: "gpt-x".to_owned(),
        }
    }

    fn chat() -> Vec<Value> {
        vec![
            json!({ "role": "system", "content": "Be brief." }),
            json!({ "role": "user", "content": "Hello" }),
        ]
    }

    // it: "OpenAI-compatible calls use bearer auth and read the choice"
    #[test]
    fn openai_compatible_calls_use_bearer_auth() {
        let d = descriptor("openai", ProviderApi::OpenaiChat, "https://api.openai.com");
        let request = build_request(&d, "sk-test", &chat());
        assert!(request.url.ends_with("/v1/chat/completions"));
        assert_eq!(request.headers["authorization"], "Bearer sk-test");
        assert_eq!(request.body["messages"], json!(chat()));
        let reply = json!({ "choices": [{ "message": { "content": " hi " } }] });
        assert_eq!(parse_reply(ProviderApi::OpenaiChat, &reply).as_deref(), Some("hi"));
    }

    // it: "Anthropic gets its own header shape and a hoisted system prompt"
    #[test]
    fn anthropic_gets_its_own_header_shape_and_hoisted_system() {
        let d = descriptor("anthropic", ProviderApi::AnthropicMessages, "https://api.anthropic.com");
        let request = build_request(&d, "sk-ant", &chat());
        assert_eq!(request.headers["x-api-key"], "sk-ant");
        // Without this header the browser call is refused outright.
        assert_eq!(request.headers["anthropic-dangerous-direct-browser-access"], "true");
        assert_eq!(request.headers["anthropic-version"], "2023-06-01");
        assert_eq!(request.body["system"], "Be brief.", "system is a field, not a message");
        assert_eq!(request.body["max_tokens"], 4096);
        assert_eq!(request.body["messages"], json!([{ "role": "user", "content": "Hello" }]));
        let reply = json!({ "content": [{ "type": "text", "text": "hello" }] });
        assert_eq!(parse_reply(ProviderApi::AnthropicMessages, &reply).as_deref(), Some("hello"));
    }

    #[test]
    fn anthropic_without_system_omits_the_field() {
        let d = descriptor("anthropic", ProviderApi::AnthropicMessages, "https://api.anthropic.com");
        let request = build_request(&d, "k", &[json!({ "role": "user", "content": "Hi" })]);
        assert!(request.body.get("system").is_none());
    }

    // it: "Ollama needs no key and is usable as-is"
    #[test]
    fn ollama_needs_no_key_and_is_usable_as_is() {
        let d = descriptor("ollama", ProviderApi::Ollama, "http://localhost:11434");
        assert!(is_available(&d, ""));
        let request = build_request(&d, "", &chat());
        assert!(request.url.ends_with("/api/chat"));
        assert_eq!(request.body["stream"], false);
        assert_eq!(request.body["messages"], json!(chat()), "Ollama keeps system messages in place");
        let reply = json!({ "message": { "content": "local reply" } });
        assert_eq!(parse_reply(ProviderApi::Ollama, &reply).as_deref(), Some("local reply"));
    }

    // it: "a hosted provider without a key reports itself unavailable"
    #[test]
    fn a_hosted_provider_without_a_key_is_unavailable() {
        let d = descriptor("openai", ProviderApi::OpenaiChat, "https://api.openai.com");
        assert!(!is_available(&d, "   "));
        assert!(is_available(&d, "sk"));
    }

    // it: "a trailing slash in the base URL does not double up"
    #[test]
    fn a_trailing_slash_in_the_base_url_does_not_double_up() {
        let d = descriptor("openai", ProviderApi::OpenaiChat, "https://api.example.com/");
        assert_eq!(
            build_request(&d, "k", &chat()).url,
            "https://api.example.com/v1/chat/completions"
        );
    }

    // it: "the key is never sent anywhere but the provider's own host"
    #[test]
    fn the_key_stays_on_the_providers_own_host() {
        let d = descriptor("openai", ProviderApi::OpenaiChat, "https://api.openai.com");
        let request = build_request(&d, "sk-secret", &chat());
        assert!(request.url.starts_with("https://api.openai.com"));
        assert!(!request.url.starts_with("/api/"));
        assert!(!request.body.to_string().contains("sk-secret"));
    }

    // it: "an empty answer is an error, not a blank reply (32-12)"
    #[test]
    fn an_empty_answer_is_no_reply() {
        assert_eq!(parse_reply(ProviderApi::OpenaiChat, &json!({ "choices": [{ "message": { "content": "  " } }] })), None);
        assert_eq!(parse_reply(ProviderApi::OpenaiChat, &json!({})), None);
        assert_eq!(parse_reply(ProviderApi::AnthropicMessages, &json!({ "content": [{ "type": "tool_use" }] })), None);
        assert_eq!(parse_reply(ProviderApi::Ollama, &json!({ "message": { "content": "" } })), None);
    }

    #[test]
    fn anthropic_joins_text_blocks_and_keeps_their_spacing() {
        let reply = json!({ "content": [
            { "type": "text", "text": "a " },
            { "type": "tool_use" },
            { "type": "text", "text": "b" },
        ] });
        assert_eq!(parse_reply(ProviderApi::AnthropicMessages, &reply).as_deref(), Some("a b"));
    }

    #[test]
    fn http_error_keeps_the_provider_detail_and_truncates_it() {
        assert_eq!(
            http_error_message("OpenAI", 429, "insufficient quota"),
            "OpenAI returned 429: insufficient quota"
        );
        assert_eq!(http_error_message("OpenAI", 500, ""), "OpenAI returned 500");
        let long = "x".repeat(400);
        let message = http_error_message("OpenAI", 400, &long);
        assert_eq!(message.len(), "OpenAI returned 400: ".len() + 300);
    }
}
