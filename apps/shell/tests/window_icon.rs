#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]
//! Tests for the running-app window icon: the taskbar mode and the icon decode.

use base64::{Engine, engine::general_purpose::STANDARD};
use weaveforge_shell_lib::window_icon::{ICON_BAD, decode_icon, uses_light_theme_from};

#[test]
fn a_missing_theme_value_means_light() {
    assert!(uses_light_theme_from(None));
}

#[test]
fn zero_means_dark_and_one_means_light() {
    assert!(!uses_light_theme_from(Some(0)));
    assert!(uses_light_theme_from(Some(1)));
}

#[test]
fn any_other_value_means_light() {
    assert!(uses_light_theme_from(Some(7)));
}

#[test]
fn bytes_that_are_not_base64_are_refused_with_a_message() {
    assert_eq!(decode_icon("!!not base64").err(), Some(ICON_BAD.to_owned()));
}

#[test]
fn the_shipped_png_decodes_as_a_window_icon() {
    let encoded = STANDARD.encode(include_bytes!("../icons/icon.png"));
    let image = decode_icon(&encoded).unwrap();
    assert_eq!(image.width(), 512);
}
