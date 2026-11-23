//! `SettingsConfig::from_env` and the startup `check` of `RELAY_APP_ORIGIN`.
#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use wf_relay_server::settings::SettingsConfig;

/// Settings read from an environment holding only `RELAY_APP_ORIGIN` (or nothing).
fn with_origin(origin: Option<&str>) -> SettingsConfig {
    SettingsConfig::from_env(|key| {
        (key == "RELAY_APP_ORIGIN")
            .then(|| origin.map(str::to_owned))
            .flatten()
    })
}

#[test]
fn the_default_origin_is_the_app_and_passes_the_check() {
    let settings = SettingsConfig::default();
    assert_eq!(settings.app_origin, "https://app.weaveforge.org");
    assert_eq!(settings.check(), Ok(()));
}

#[test]
fn an_unset_or_blank_origin_falls_back_to_the_default() {
    for origin in [None, Some(""), Some("   "), Some("/")] {
        let settings = with_origin(origin);
        assert_eq!(
            settings.app_origin, "https://app.weaveforge.org",
            "{origin:?}"
        );
        assert_eq!(settings.check(), Ok(()), "{origin:?}");
    }
}

#[test]
fn a_set_origin_is_trimmed_of_spaces_and_trailing_slashes() {
    for origin in [
        "http://localhost:3000",
        " http://localhost:3000/ ",
        "http://localhost:3000//",
    ] {
        let settings = with_origin(Some(origin));
        assert_eq!(settings.app_origin, "http://localhost:3000", "{origin:?}");
        assert_eq!(settings.check(), Ok(()), "{origin:?}");
    }
}

#[test]
fn anything_but_a_bare_http_origin_fails_the_check_and_names_the_variable() {
    for origin in [
        "https://app.weaveforge.org/app",
        "https://app.weaveforge.org?x=1",
        "https://app.weaveforge.org#top",
        "https://user:pw@app.weaveforge.org",
        "https://app.weaveforge.org:443",
        "https://App.WeaveForge.org",
        "ftp://app.weaveforge.org",
        "javascript:alert(1)",
        "app.weaveforge.org",
        "not a url",
    ] {
        let settings = with_origin(Some(origin));
        let error = settings.check().expect_err(origin);
        assert!(
            error.starts_with("RELAY_APP_ORIGIN "),
            "{origin:?}: {error}"
        );
    }
}
