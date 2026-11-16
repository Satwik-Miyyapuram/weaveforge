//! Restoring the model provider kept in the OS keychain (TS `ai-provider-session.ts`, `parseStored`).
//!
//! The stored blob is written by the app. A blob that does not match the current shape counts as
//! absent, so a half-valid provider never reaches a model call and fails with the provider's message.

/// The wire API a provider speaks (TS `ProviderApi`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ProviderApi {
    /// OpenAI-compatible chat completions (`openai-chat`).
    OpenaiChat,
    /// Anthropic messages API (`anthropic-messages`).
    AnthropicMessages,
    /// Ollama API (`ollama`).
    Ollama,
}

/// A configured model provider, without its key (TS `ProviderDescriptor`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ProviderDescriptor {
    /// Provider id.
    pub id: String,
    /// Display label.
    pub label: String,
    /// Base URL of the API.
    pub base_url: String,
    /// Wire API the provider speaks.
    pub api: ProviderApi,
    /// Model name.
    pub model: String,
}

/// A provider restored from storage, with its key (TS `ActiveProvider`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct StoredProvider {
    /// The provider.
    pub descriptor: ProviderDescriptor,
    /// The API key the user supplied.
    pub api_key: String,
}

/// Read a stored provider blob. Unparseable input, a missing or mistyped field, or an unknown
/// `api` gives `None`. Extra fields are ignored.
#[must_use]
pub fn parse_stored_provider(raw: &str) -> Option<StoredProvider> {
    serde_json::from_str(raw).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID: &str = r#"{"descriptor":{"id":"p1","label":"Local","baseUrl":"http://x","api":"ollama","model":"m"},"apiKey":"k","extra":1}"#;

    #[test]
    fn parses_a_current_blob_and_ignores_extra_fields() {
        let parsed = parse_stored_provider(VALID).expect("valid blob");
        assert_eq!(parsed.descriptor.api, ProviderApi::Ollama);
        assert_eq!(parsed.descriptor.base_url, "http://x");
        assert_eq!(parsed.api_key, "k");
    }

    #[test]
    fn maps_each_wire_api_name() {
        let openai = VALID.replace("\"ollama\"", "\"openai-chat\"");
        let anthropic = VALID.replace("\"ollama\"", "\"anthropic-messages\"");
        assert_eq!(
            parse_stored_provider(&openai).map(|p| p.descriptor.api),
            Some(ProviderApi::OpenaiChat)
        );
        assert_eq!(
            parse_stored_provider(&anthropic).map(|p| p.descriptor.api),
            Some(ProviderApi::AnthropicMessages)
        );
    }

    #[test]
    fn rejects_unparseable_or_mistyped_blobs() {
        assert_eq!(parse_stored_provider("not json"), None);
        assert_eq!(parse_stored_provider("null"), None);
        assert_eq!(
            parse_stored_provider(&VALID.replace("\"apiKey\":\"k\"", "\"apiKey\":1")),
            None
        );
        assert_eq!(
            parse_stored_provider(&VALID.replace("\"ollama\"", "\"gemini\"")),
            None
        );
        assert_eq!(
            parse_stored_provider(&VALID.replace("\"model\":\"m\"", "\"model\":null")),
            None
        );
    }
}
