//! The workspace-folder pointer in `~/.weaveforge/desktop.json`. Pure port of the parse in
//! `apps/shell/sidecar/src/home-config.ts` (`readHomeConfig`). Finding the path and reading or
//! writing the file stay in TypeScript, because `path.join` depends on the platform.

use serde_json::Value;

/// The `vaultRoot` the file names, or `None` when the text is not a JSON object, the key is
/// missing or not a string, or the string is empty. The TS side maps `None` to `{ vaultRoot: null }`.
#[must_use]
pub fn vault_root_from_text(text: &str) -> Option<String> {
    let parsed: Value = serde_json::from_str(text).ok()?;
    parsed
        .as_object()?
        .get("vaultRoot")?
        .as_str()
        .filter(|root| !root.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_non_empty_string_vault_root_is_returned() {
        assert_eq!(
            vault_root_from_text(r#"{"vaultRoot":"/Users/me/WeaveForge"}"#),
            Some("/Users/me/WeaveForge".to_owned())
        );
        assert_eq!(
            vault_root_from_text(r#"{"vaultRoot":"C:\\Users\\me\\Docs","other":1}"#),
            Some("C:\\Users\\me\\Docs".to_owned())
        );
    }

    #[test]
    fn an_empty_null_or_non_string_vault_root_is_none() {
        assert_eq!(vault_root_from_text(r#"{"vaultRoot":""}"#), None);
        assert_eq!(vault_root_from_text(r#"{"vaultRoot":null}"#), None);
        assert_eq!(vault_root_from_text(r#"{"vaultRoot":42}"#), None);
        assert_eq!(vault_root_from_text(r#"{"vaultRoot":["/a"]}"#), None);
        assert_eq!(vault_root_from_text(r#"{"other":"/a"}"#), None);
    }

    #[test]
    fn text_that_is_not_a_json_object_is_none() {
        assert_eq!(vault_root_from_text(""), None);
        assert_eq!(vault_root_from_text("not json"), None);
        assert_eq!(vault_root_from_text("null"), None);
        assert_eq!(vault_root_from_text("\"/a\""), None);
        assert_eq!(vault_root_from_text("[{\"vaultRoot\":\"/a\"}]"), None);
    }
}
