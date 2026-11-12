//! Per-user appearance preferences read back from the settings row. Port of
//! `packages/core/src/features/settings/domain/parts.ts`. Pure.

use serde::Serialize;
use serde_json::Value;

use super::theme_config::{SurfaceStyle, ThemeConfig, ThemeMode, normalize_theme_config};
use crate::reader_analysis::lines::js_trim;

/// Icon and toggle button scale across the app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum ControlSize {
    /// Smaller controls.
    Compact,
    /// The standard size.
    Default,
    /// Larger controls.
    Comfortable,
}

/// How the brutal and CRT themes colour a paper card by its reading status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum CardTint {
    /// The whole card tinted.
    Full,
    /// A bar down the card's edge.
    Bar,
    /// A coloured border.
    Border,
    /// No status colour.
    None,
}

/// The appearance preferences that survived checking; absent fields are unset.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct UserAppearance {
    /// Light or dark mode.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub mode: Option<ThemeMode>,
    /// Theme variant used in light mode.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub light_theme: Option<String>,
    /// Theme variant used in dark mode.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub dark_theme: Option<String>,
    /// Icon and toggle button scale.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub control_size: Option<ControlSize>,
    /// Surface separation.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub surfaces: Option<SurfaceStyle>,
    /// Pointer-reactive animation layer.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub reactive_motion: Option<bool>,
    /// Every animation's speed, one of [`ANIMATION_SPEEDS`]; absent means 1x.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub animation_speed: Option<f64>,
    /// Paper card status colour on the brutal and CRT themes.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub card_tint: Option<CardTint>,
    /// CRT's leaning cards.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub card_tilt: Option<bool>,
    /// CRT's scanline overlay.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub scanlines: Option<bool>,
    /// Uploaded theme: absent means unchanged, `null` means remove it.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional, type = Option<Option<ThemeConfig>>))]
    pub custom_theme: Option<Option<ThemeConfig>>,
}

/// Animation speed multipliers, slowest first; 1 is the designed speed.
pub const ANIMATION_SPEEDS: [f64; 5] = [0.25, 0.5, 1.0, 2.0, 4.0];

fn animation_speed(value: Option<&Value>) -> Option<f64> {
    let speed = value?.as_f64()?;
    ANIMATION_SPEEDS
        .iter()
        .any(|s| s.to_bits() == speed.to_bits())
        .then_some(speed)
}

fn trimmed(value: Option<&Value>) -> Option<String> {
    let text = js_trim(value?.as_str()?);
    (!text.is_empty()).then(|| text.to_owned())
}

fn boolean(value: Option<&Value>) -> Option<bool> {
    value?.as_bool()
}

/// The appearance preferences of a stored value, or `None` when it is not an
/// object or nothing in it is valid. A stored theme is re-checked, not copied.
#[must_use]
pub fn normalize_appearance(raw: &Value) -> Option<UserAppearance> {
    let o = raw.as_object()?;
    let text = |key: &str| o.get(key).and_then(Value::as_str);
    let out = UserAppearance {
        mode: match text("mode") {
            Some("light") => Some(ThemeMode::Light),
            Some("dark") => Some(ThemeMode::Dark),
            _ => None,
        },
        light_theme: trimmed(o.get("lightTheme")),
        dark_theme: trimmed(o.get("darkTheme")),
        control_size: match text("controlSize") {
            Some("compact") => Some(ControlSize::Compact),
            Some("default") => Some(ControlSize::Default),
            Some("comfortable") => Some(ControlSize::Comfortable),
            _ => None,
        },
        surfaces: match text("surfaces") {
            Some("borderless") => Some(SurfaceStyle::Borderless),
            Some("bordered") => Some(SurfaceStyle::Bordered),
            _ => None,
        },
        reactive_motion: boolean(o.get("reactiveMotion")),
        animation_speed: animation_speed(o.get("animationSpeed")),
        card_tint: match text("cardTint") {
            Some("full") => Some(CardTint::Full),
            Some("bar") => Some(CardTint::Bar),
            Some("border") => Some(CardTint::Border),
            Some("none") => Some(CardTint::None),
            _ => None,
        },
        card_tilt: boolean(o.get("cardTilt")),
        scanlines: boolean(o.get("scanlines")),
        custom_theme: match o.get("customTheme") {
            Some(Value::Null) => Some(None),
            Some(theme) => normalize_theme_config(theme).map(Some),
            None => None,
        },
    };
    (out != UserAppearance::default()).then_some(out)
}

/// The server's appearance over `local`, as the TS merge did: each key the server sends replaces
/// the local one, except that a `null` field keeps the local value. `customTheme` is the one
/// field where `null` means "no custom theme", so it does clear. Keys absent from `server` keep
/// their local value.
#[must_use]
pub fn merge_server_appearance(local: &Value, server: &Value) -> Value {
    let mut merged = local.as_object().cloned().unwrap_or_default();
    if let Some(server) = server.as_object() {
        for (key, value) in server {
            if value.is_null() && key != "customTheme" {
                continue;
            }
            let _ = merged.insert(key.clone(), value.clone());
        }
    }
    Value::Object(merged)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keeps_only_valid_fields_in_ts_order() {
        let out = normalize_appearance(&json!({
            "scanlines": false, "mode": "dark", "lightTheme": "  brutal ", "darkTheme": "   ",
            "controlSize": "huge", "cardTint": "bar", "reactiveMotion": "yes", "extra": 1
        }));
        assert_eq!(
            serde_json::to_string(&out).unwrap_or_default(),
            r#"{"mode":"dark","lightTheme":"brutal","cardTint":"bar","scanlines":false}"#
        );
    }

    #[test]
    fn null_custom_theme_means_remove_and_bad_theme_is_dropped() {
        let removed = normalize_appearance(&json!({ "customTheme": null }));
        assert_eq!(
            serde_json::to_string(&removed).unwrap_or_default(),
            r#"{"customTheme":null}"#
        );
        assert_eq!(
            normalize_appearance(&json!({ "customTheme": { "mode": "neon" } })),
            None
        );
    }

    #[test]
    fn animation_speed_must_be_a_listed_multiplier() {
        let cases = [
            (json!(2), true),
            (json!(0.25), true),
            (json!(3), false),
            (json!("1"), false),
        ];
        for (raw, kept) in cases {
            let out = normalize_appearance(&json!({ "animationSpeed": raw }));
            assert_eq!(out.is_some(), kept, "{raw}");
        }
    }

    #[test]
    fn non_objects_and_empty_objects_give_none() {
        for raw in [json!(null), json!([]), json!("dark"), json!(1), json!({})] {
            assert_eq!(normalize_appearance(&raw), None);
        }
    }

    #[test]
    fn server_replaces_local_and_nulls_keep_local_except_custom_theme() {
        let local = json!({ "mode": "light", "cardTilt": true, "customTheme": { "a": 1 } });
        let server = json!({ "mode": "dark", "cardTilt": null, "customTheme": null });
        assert_eq!(
            merge_server_appearance(&local, &server),
            json!({ "mode": "dark", "cardTilt": true, "customTheme": null })
        );
    }

    #[test]
    fn keys_absent_from_server_keep_local() {
        let local = json!({ "mode": "light" });
        assert_eq!(merge_server_appearance(&local, &json!({})), local);
    }
}
