//! Which browser storage keys hold account or workspace state (TS `isAppStorageKey` in
//! `apps/web/src/lib/desktop/clear-local-device-data.ts`). Sign-out wipes those and keeps the
//! keys that describe this device.

/// Device keys that survive sign-out: the pen and reader behaviour, the no-account mode, and the
/// account that owns this machine's database (sign-out resets that one itself).
const DEVICE_KEYS: [&str; 2] = ["weaveforge.local-mode", "weaveforge.local-first"];

const DEVICE_PREFIXES: [&str; 5] = [
    "weaveforge.ink.",
    "weaveforge.reader.",
    "weaveforge.md.",
    "wf.ink.",
    "wf.reader.",
];

/// True when a storage key holds account or workspace state. Unlisted `weaveforge.` and `wf.`
/// keys count as account state, so a new key is wiped unless it is listed as a device key.
#[must_use]
pub fn is_app_storage_key(key: &str) -> bool {
    if key.starts_with("tt:") || key.starts_with("thesis.") {
        return true;
    }
    if !key.starts_with("weaveforge.") && !key.starts_with("wf.") {
        return false;
    }
    !DEVICE_KEYS.contains(&key) && !DEVICE_PREFIXES.iter().any(|prefix| key.starts_with(prefix))
}

#[cfg(test)]
mod tests {
    use super::is_app_storage_key;

    #[test]
    fn account_and_workspace_keys_are_app_storage() {
        assert!(is_app_storage_key("tt:thread-1"));
        assert!(is_app_storage_key("thesis.citeFormat.global"));
        assert!(is_app_storage_key("weaveforge.session"));
        assert!(is_app_storage_key("wf.workspace"));
    }

    #[test]
    fn device_keys_are_kept() {
        assert!(!is_app_storage_key("weaveforge.local-mode"));
        assert!(!is_app_storage_key("weaveforge.local-first"));
        assert!(!is_app_storage_key("weaveforge.ink.pen"));
        assert!(!is_app_storage_key("weaveforge.reader.zoom"));
        assert!(!is_app_storage_key("weaveforge.md.preview"));
        assert!(!is_app_storage_key("wf.ink.pen"));
        assert!(!is_app_storage_key("wf.reader.zoom"));
    }

    #[test]
    fn prefix_needs_its_dot_and_other_keys_are_not_app_storage() {
        assert!(is_app_storage_key("weaveforge.inkx"));
        assert!(!is_app_storage_key("theme"));
        assert!(!is_app_storage_key("ink.weaveforge.x"));
        assert!(!is_app_storage_key("weaveforge"));
    }
}
