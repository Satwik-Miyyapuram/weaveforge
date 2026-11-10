//! The secret names the app keeps in the keychain (TS `apps/shell/sidecar/src/secret-store.ts`
//! `SECRET_NAMES` and `isSecretName`). Keychain IO and the write queue stay in TypeScript.

/// The only names a secret may be stored under.
pub const SECRET_NAMES: [&str; 4] = [
    "ai-provider",
    "local-api-token",
    "overleaf-token",
    "git-sync-token",
];

/// Whether `name` is one of [`SECRET_NAMES`]. Exact match; no trimming or case folding.
pub fn is_secret_name(name: &str) -> bool {
    SECRET_NAMES.contains(&name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_every_known_name() {
        for name in SECRET_NAMES {
            assert!(is_secret_name(name));
        }
    }

    #[test]
    fn rejects_unknown_and_non_exact_names() {
        assert!(!is_secret_name(""));
        assert!(!is_secret_name("AI-PROVIDER"));
        assert!(!is_secret_name(" ai-provider"));
        assert!(!is_secret_name("github-token"));
    }
}
