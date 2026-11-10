//! Picks the AI provider a caller named. Pure: there is no fallback order, because a silent
//! fallback would answer as a different model than the user chose.

use serde::{Deserialize, Serialize};

/// One configured AI adapter and whether it can answer right now (TS `AiModelAdapter`'s
/// `provider` and `available`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ModelProviderAvailability {
    /// The provider id, such as `openai`.
    pub provider: String,
    /// Whether the adapter is usable.
    pub available: bool,
}

/// The provider to use for `selected`. Port of the selection in `AiModelRouter`
/// (`packages/core/src/features/ai-assistant/domain/ai-model-router.ts`).
///
/// # Errors
///
/// Fails when `selected` is empty, or when no available adapter has that id. The message is the
/// one the TS router threw, and lists the configured providers.
pub fn select_model_provider(
    providers: &[ModelProviderAvailability],
    selected: &str,
) -> Result<String, String> {
    if selected.is_empty() {
        return Err("No AI provider is configured. Choose one in Settings → AI.".to_string());
    }
    if providers
        .iter()
        .any(|provider| provider.provider == selected && provider.available)
    {
        return Ok(selected.to_string());
    }
    let available: Vec<&str> = providers
        .iter()
        .filter(|provider| provider.available)
        .map(|provider| provider.provider.as_str())
        .collect();
    if available.is_empty() {
        Err(format!(
            "AI provider \"{selected}\" is not available and none are configured."
        ))
    } else {
        Err(format!(
            "AI provider \"{selected}\" is not available. Configured: {}.",
            available.join(", ")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::{ModelProviderAvailability, select_model_provider};

    fn provider(id: &str, available: bool) -> ModelProviderAvailability {
        ModelProviderAvailability {
            provider: id.to_string(),
            available,
        }
    }

    #[test]
    fn selects_the_named_available_provider() {
        let providers = [provider("openai", true), provider("anthropic", true)];
        assert_eq!(
            select_model_provider(&providers, "anthropic").as_deref(),
            Ok("anthropic")
        );
    }

    #[test]
    fn empty_selection_is_refused() {
        let error = select_model_provider(&[provider("openai", true)], "").unwrap_err();
        assert!(error.contains("Settings"));
    }

    #[test]
    fn unavailable_selection_lists_configured_providers() {
        let providers = [provider("openai", false), provider("anthropic", true)];
        let error = select_model_provider(&providers, "openai").unwrap_err();
        assert_eq!(
            error,
            "AI provider \"openai\" is not available. Configured: anthropic."
        );
    }

    #[test]
    fn no_configured_providers_says_so() {
        let error = select_model_provider(&[provider("openai", false)], "openai").unwrap_err();
        assert_eq!(
            error,
            "AI provider \"openai\" is not available and none are configured."
        );
    }
}
