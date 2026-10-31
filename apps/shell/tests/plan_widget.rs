//! Tests for the plan widget's pure half (ported from apps/desktop/test/plan-widget.test.ts).

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::cell::Cell;
use std::cell::RefCell;
use std::collections::BTreeMap;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Value, json};
use weaveforge_shell::plan_widget::{
    PLAN_WIDGET_HEIGHT, PLAN_WIDGET_WIDTH, WIDGET_PALETTE_KEYS, WidgetBounds, WorkArea,
    clean_widget_palette, hwnd_from_handle, parse_bounds, parse_taskbar_created, pin_script,
    place_widget, powershell_args, switch_plan_widget,
};

/// The palette object with every colour key set to `colour`.
fn full_palette(colour: &str) -> serde_json::Map<String, Value> {
    WIDGET_PALETTE_KEYS
        .iter()
        .map(|key| ((*key).to_owned(), Value::from(colour)))
        .collect()
}

/// The expected cleaned palette for `full_palette("#a0b1c2")`.
fn lower_palette() -> BTreeMap<String, String> {
    WIDGET_PALETTE_KEYS
        .iter()
        .map(|key| ((*key).to_owned(), "#a0b1c2".to_owned()))
        .collect()
}

/// The theme's shape values from the TS test's `poster`.
fn poster() -> Vec<(&'static str, &'static str)> {
    vec![
        ("radius", "6px"),
        ("radius-sm", "4px"),
        ("bw", "2px"),
        ("sh", "rgb(18, 17, 15) 5px 5px 0px 0px"),
        (
            "sh-sm",
            "rgba(0, 0, 0, 0.5) 0px 1px 3px 0px, rgb(1, 2, 3) 2px 2px 0px 0px",
        ),
        (
            "font",
            "__Rubik_a1b2c3, \"__Rubik_Fallback_a1b2c3\", ui-sans-serif, system-ui",
        ),
        ("fs", "14px"),
        ("fs-sm", "12.5px"),
    ]
}

/// A full colour palette plus the poster's shape keys.
fn with_poster() -> serde_json::Map<String, Value> {
    let mut map = full_palette("#a0b1c2");
    for (key, value) in poster() {
        let _ = map.insert(key.to_owned(), Value::from(value));
    }
    map
}

/// The exact TS text of `pinScript(12345n)`.
const PIN_SCRIPT_12345: &str = r##"$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WeaveForgePin {
  [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr FindWindow(string cls, IntPtr name);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)] public static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern uint RegisterWindowMessage(string name);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEvent proc, uint pid, uint tid, uint flags);
  [DllImport("user32.dll")] static extern UIntPtr SetTimer(IntPtr hwnd, UIntPtr id, uint ms, IntPtr proc);
  [DllImport("user32.dll")] static extern int GetMessage(out Msg msg, IntPtr hwnd, uint min, uint max);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref Msg msg);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Msg msg);
  [StructLayout(LayoutKind.Sequential)] public struct Msg { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }
  public delegate void WinEvent(IntPtr hook, uint ev, IntPtr hwnd, int obj, int child, uint thread, uint time);
  static IntPtr held;
  static WinEvent onEvent;
  static void Bottom() { SetWindowPos(held, (IntPtr)1, 0, 0, 0, 0, 0x13); }
  public static void Hold(IntPtr window) {
    held = window;
    onEvent = (hook, ev, hwnd, obj, child, thread, time) => Bottom();
    // EVENT_SYSTEM_FOREGROUND and EVENT_SYSTEM_MINIMIZEEND, out of context.
    SetWinEventHook(0x3, 0x3, IntPtr.Zero, onEvent, 0, 0, 0);
    SetWinEventHook(0x17, 0x17, IntPtr.Zero, onEvent, 0, 0, 0);
    SetTimer(IntPtr.Zero, UIntPtr.Zero, 5000, IntPtr.Zero);
    Msg msg;
    while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
      if (msg.message == 0x113 && !IsWindow(held)) return;
      TranslateMessage(ref msg);
      DispatchMessage(ref msg);
    }
  }
}
'@
$ProgressPreference = 'SilentlyContinue'
$window = [IntPtr][Int64]12345
[WeaveForgePin]::RegisterWindowMessage('TaskbarCreated')
$desktop = [WeaveForgePin]::FindWindow('Progman', [IntPtr]::Zero)
if ($desktop -eq [IntPtr]::Zero) { exit 2 }
[void][WeaveForgePin]::SetWindowLongPtr($window, -8, $desktop)
[void][WeaveForgePin]::SetWindowPos($window, [IntPtr]1, 0, 0, 0, 0, 0x13)
[WeaveForgePin]::Hold($window)
"##;

// parseBounds

#[test]
fn parse_bounds_reads_a_saved_position() {
    assert_eq!(
        parse_bounds(Some(r#"{"x":10.4,"y":-20}"#)),
        Some(WidgetBounds { x: 10, y: -20 })
    );
}

#[test]
fn parse_bounds_rounds_halves_up() {
    assert_eq!(
        parse_bounds(Some(r#"{"x":1.5,"y":-1.5}"#)),
        Some(WidgetBounds { x: 2, y: -1 })
    );
}

#[test]
fn parse_bounds_refuses_anything_else() {
    for bad in [
        Some("null"),
        Some("true"),
        Some("not json"),
        Some(r#"{"x":"1","y":2}"#),
        Some("[1,2]"),
        Some("[]"),
        Some(r#"{"x":1}"#),
        Some(r#"{"x":1e400,"y":0}"#),
        None,
    ] {
        assert_eq!(parse_bounds(bad), None, "{bad:?}");
    }
}

// placeWidget

#[test]
fn place_widget_keeps_a_position_on_a_screen_and_rescues_one_that_is_not() {
    let areas = [WorkArea {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    }];
    let kept = WidgetBounds { x: 100, y: 100 };
    assert_eq!(place_widget(Some(kept), &areas), kept);
    let rescued = place_widget(Some(WidgetBounds { x: 3000, y: 100 }), &areas);
    assert_eq!(rescued.x, 1920 - PLAN_WIDGET_WIDTH - 32);
    assert_eq!(rescued.y, 32);
    assert_eq!(place_widget(None, &areas), rescued);
}

#[test]
fn place_widget_keeps_a_spot_inside_a_second_monitor_at_negative_coordinates() {
    let areas = [
        WorkArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        },
        WorkArea {
            x: -1280,
            y: 0,
            width: 1280,
            height: 1000,
        },
    ];
    let spot = WidgetBounds { x: -1200, y: 50 };
    assert_eq!(place_widget(Some(spot), &areas), spot);
}

#[test]
fn place_widget_moves_a_spot_straddling_two_areas_to_the_first_corner() {
    let areas = [
        WorkArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        },
        WorkArea {
            x: 1920,
            y: 0,
            width: 1280,
            height: 1000,
        },
    ];
    let placed = place_widget(Some(WidgetBounds { x: 1800, y: 100 }), &areas);
    assert_eq!(
        placed,
        WidgetBounds {
            x: 1920 - 320 - 32,
            y: 32
        }
    );
}

#[test]
fn place_widget_with_no_areas_uses_the_default_screen() {
    assert_eq!(
        place_widget(None, &[]),
        WidgetBounds {
            x: 1280 - 320 - 32,
            y: 32
        }
    );
    assert_eq!(PLAN_WIDGET_HEIGHT, 432);
}

// hwndFromHandle

#[test]
fn hwnd_from_handle_reads_a_64_bit_handle_little_endian() {
    let wide = 0x1234_5678_9abc_u64.to_le_bytes();
    assert_eq!(hwnd_from_handle(&wide), 0x1234_5678_9abc);
}

#[test]
fn hwnd_from_handle_reads_a_32_bit_handle_little_endian() {
    let narrow = 0x00aa_bbcc_u32.to_le_bytes();
    assert_eq!(hwnd_from_handle(&narrow), 0x00aa_bbcc);
}

#[test]
fn hwnd_from_handle_gives_zero_for_three_bytes() {
    assert_eq!(hwnd_from_handle(&[1, 2, 3]), 0);
}

// pinScript

#[test]
fn pin_script_owns_the_window_by_the_desktop_and_sends_it_to_the_bottom() {
    let script = pin_script(4_457_128);
    assert!(script.contains("[IntPtr][Int64]4457128\n"));
    assert!(script.contains("FindWindow('Progman', [IntPtr]::Zero)"));
    assert!(!script.contains("$null"));
    assert!(script.contains("SetWindowLongPtr($window, -8, $desktop)"));
    assert!(script.contains("SetWindowPos($window, [IntPtr]1, 0, 0, 0, 0, 0x13)"));
    assert!(script.ends_with("[WeaveForgePin]::Hold($window)\n"));
    assert!(script.contains("SetWinEventHook(0x3, 0x3,"));
}

#[test]
fn pin_script_puts_the_hwnd_in_decimal() {
    assert!(pin_script(12345).contains("[IntPtr][Int64]12345"));
}

#[test]
fn pin_script_equals_the_ts_text_for_one_hwnd() {
    assert_eq!(pin_script(12345), PIN_SCRIPT_12345);
}

#[test]
fn powershell_args_passes_the_whole_script_encoded_not_on_stdin() {
    let script = pin_script(1);
    let args = powershell_args(&script);
    assert_eq!(
        args[..3],
        ["-NoProfile", "-NonInteractive", "-EncodedCommand"]
    );
    assert!(!args.iter().any(|arg| arg == "-Command"));
    let bytes = STANDARD.decode(&args[3]).unwrap();
    let (pairs, rest) = bytes.as_chunks::<2>();
    assert!(rest.is_empty());
    let units: Vec<u16> = pairs.iter().map(|pair| u16::from_le_bytes(*pair)).collect();
    assert_eq!(String::from_utf16(&units).unwrap(), script);
}

#[test]
fn powershell_args_encodes_ab_as_utf16le_base64() {
    assert_eq!(
        powershell_args("ab"),
        [
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            "YQBiAA=="
        ]
    );
}

// TaskbarCreated

#[test]
fn pin_script_reports_the_taskbar_created_message() {
    assert!(pin_script(1).contains("RegisterWindowMessage('TaskbarCreated')"));
}

#[test]
fn parse_taskbar_created_takes_only_a_registered_id() {
    assert_eq!(parse_taskbar_created("49345\r\n"), Some(49345));
    assert_eq!(parse_taskbar_created("49322 extra"), Some(49322));
    assert_eq!(parse_taskbar_created("49151"), None);
    assert_eq!(parse_taskbar_created("65536"), None);
    assert_eq!(parse_taskbar_created("16"), None);
    assert_eq!(parse_taskbar_created(""), None);
    assert_eq!(parse_taskbar_created("abc"), None);
}

// cleanWidgetPalette

#[test]
fn clean_widget_palette_lowercases_a_full_palette() {
    let full = Value::Object(full_palette("#A0b1C2"));
    assert_eq!(clean_widget_palette(&full), Some(lower_palette()));
}

#[test]
fn clean_widget_palette_refuses_anything_else() {
    let mut bad_red = full_palette("#A0b1C2");
    let _ = bad_red.insert("bg".to_owned(), json!("red"));
    assert_eq!(clean_widget_palette(&Value::Object(bad_red)), None);

    let mut bad_injection = full_palette("#A0b1C2");
    let _ = bad_injection.insert("bg".to_owned(), json!("#fff;x"));
    assert_eq!(clean_widget_palette(&Value::Object(bad_injection)), None);

    let mut missing = full_palette("#A0b1C2");
    let _ = missing.remove("line");
    assert_eq!(clean_widget_palette(&Value::Object(missing)), None);

    assert_eq!(clean_widget_palette(&Value::Null), None);
    assert_eq!(clean_widget_palette(&json!("#000000")), None);
}

#[test]
fn clean_widget_palette_keeps_the_theme_shape() {
    let mut expected = lower_palette();
    for (key, value) in poster() {
        let _ = expected.insert(key.to_owned(), value.to_owned());
    }
    assert_eq!(
        clean_widget_palette(&Value::Object(with_poster())),
        Some(expected)
    );

    let mut none = with_poster();
    let _ = none.insert("sh".to_owned(), json!("none"));
    let _ = none.insert("sh-sm".to_owned(), json!("none"));
    let cleaned = clean_widget_palette(&Value::Object(none)).unwrap();
    assert_eq!(cleaned.get("sh").map(String::as_str), Some("none"));
}

#[test]
fn clean_widget_palette_paints_colours_saved_before_the_shape() {
    assert_eq!(
        clean_widget_palette(&Value::Object(full_palette("#a0b1c2"))),
        Some(lower_palette())
    );
}

#[test]
fn clean_widget_palette_refuses_a_shape_value_that_is_not_plain_css_of_its_kind() {
    let bad_shapes = [
        ("radius", json!("6px; background: url(x)")),
        ("radius", json!("calc(1px)")),
        ("bw", json!("99px")),
        ("fs", json!("2px")),
        ("sh", json!("url(https://x) 1px")),
        ("sh", json!("1px 1px red; color: x")),
        ("font", json!("Rubik; background: red")),
        ("font", json!("x".repeat(400))),
        ("radius", json!(6)),
    ];
    for (key, bad) in bad_shapes {
        let mut map = with_poster();
        let _ = map.insert(key.to_owned(), bad.clone());
        assert_eq!(
            clean_widget_palette(&Value::Object(map)),
            None,
            "{key}={bad}"
        );
    }
}

#[test]
fn clean_widget_palette_drops_an_unknown_extra_key() {
    let mut map = full_palette("#a0b1c2");
    let _ = map.insert("extra".to_owned(), json!("x"));
    let cleaned = clean_widget_palette(&Value::Object(map)).unwrap();
    assert!(!cleaned.contains_key("extra"));
    assert_eq!(cleaned, lower_palette());
}

// switch_plan_widget

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn switch_plan_widget_a_failed_save_stops_before_apply() {
    let applied = Cell::new(false);
    let apply_flag = &applied;
    let result = switch_plan_widget(
        true,
        |_| async { Err::<(), String>("disk full".to_owned()) },
        |_| async move {
            apply_flag.set(true);
            Ok::<(), String>(())
        },
    )
    .await;
    assert_eq!(result, Err("disk full".to_owned()));
    assert!(
        !applied.get(),
        "the widget opened although its setting was not saved"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn switch_plan_widget_an_apply_failure_names_the_on_or_off_switch() {
    let on = switch_plan_widget(
        true,
        |_| async { Ok::<(), String>(()) },
        |_| async { Err::<(), String>("window gone".to_owned()) },
    )
    .await;
    assert_eq!(
        on,
        Err("Could not turn the desktop widget on: window gone".to_owned())
    );

    let off = switch_plan_widget(
        false,
        |_| async { Ok::<(), String>(()) },
        |_| async { Err::<(), String>("window gone".to_owned()) },
    )
    .await;
    assert_eq!(
        off,
        Err("Could not turn the desktop widget off: window gone".to_owned())
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn switch_plan_widget_saves_then_applies_in_that_order() {
    let steps = RefCell::new(Vec::<String>::new());
    let steps_ref = &steps;
    let result = switch_plan_widget(
        false,
        |on| async move {
            steps_ref.borrow_mut().push(format!("save {on}"));
            Ok::<(), String>(())
        },
        |on| async move {
            steps_ref.borrow_mut().push(format!("apply {on}"));
            Ok::<(), String>(())
        },
    )
    .await;
    assert_eq!(result, Ok(()));
    assert_eq!(*steps.borrow(), ["save false", "apply false"]);
}
