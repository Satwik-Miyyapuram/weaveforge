//! The plan widget's pure half: its query, placement, palette and the Win32 pin script.

use std::collections::BTreeMap;
use std::future::Future;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;

/// The owner's open milestones and their project names, from the local database.
pub const PLAN_WIDGET_SQL: &str = r#"
select m.id, m.title, m.description, m.status, m.target_date, m.dependencies, m.compute, m.created_at,
       p.name as project_name
from milestones m
left join projects p on p.id = m.project_id and p.deleted_at is null
where m.deleted_at is null
  and m.user_id = auth.uid()
  and (m.project_id is null or p.id is not null)
"#;

/// How many deadlines the widget has room for.
pub const PLAN_WIDGET_LIMIT: usize = 6;

/// The widget's width in logical pixels.
pub const PLAN_WIDGET_WIDTH: i32 = 320;
/// The widget's height in logical pixels.
pub const PLAN_WIDGET_HEIGHT: i32 = 432;

/// The colours the widget takes from the app, by the CSS variable each one sets.
pub const WIDGET_PALETTE_KEYS: [&str; 11] = [
    "bg",
    "well",
    "line",
    "text",
    "muted",
    "accent",
    "accent-ink",
    "late",
    "late-ink",
    "soon",
    "soon-ink",
];

/// Message the page sees when the widget cannot be turned on.
pub const WIDGET_ON_FAILED: &str = "Could not turn the desktop widget on";
/// Message the page sees when the widget cannot be turned off.
pub const WIDGET_OFF_FAILED: &str = "Could not turn the desktop widget off";

/// Where the widget was left, read back from the preference file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct WidgetBounds {
    /// Left edge in screen pixels.
    pub x: i32,
    /// Top edge in screen pixels.
    pub y: i32,
}

/// One monitor's usable area in screen pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorkArea {
    /// Left edge.
    pub x: i32,
    /// Top edge.
    pub y: i32,
    /// Width.
    pub width: i32,
    /// Height.
    pub height: i32,
}

/// A theme key and the rule its CSS value must pass.
type ShapeRule = (&'static str, fn(&str) -> bool);

/// The theme's shape keys the widget reads, each with the rule its CSS value must pass.
const WIDGET_SHAPE: [ShapeRule; 8] = [
    ("radius", radius_rule),
    ("radius-sm", radius_sm_rule),
    ("bw", bw_rule),
    ("sh", sh_rule),
    ("sh-sm", sh_sm_rule),
    ("font", font_rule),
    ("fs", fs_rule),
    ("fs-sm", fs_sm_rule),
];

/// A palette from the app with every colour key a `#rrggbb` colour and every
/// shape key present plain CSS of its kind, or None.
#[must_use]
pub fn clean_widget_palette(value: &serde_json::Value) -> Option<BTreeMap<String, String>> {
    let input = value.as_object()?;
    let mut out = BTreeMap::new();
    for key in WIDGET_PALETTE_KEYS {
        let colour = input.get(key)?.as_str().filter(|c| is_hex_colour(c))?;
        let _ = out.insert(key.to_owned(), colour.to_ascii_lowercase());
    }
    for (key, ok) in WIDGET_SHAPE {
        let Some(found) = input.get(key) else {
            continue;
        };
        let shape = found.as_str().filter(|s| ok(s))?;
        let _ = out.insert(key.to_owned(), shape.to_owned());
    }
    Some(out)
}

/// Reads a saved position; None unless it is two finite numbers.
#[must_use]
pub fn parse_bounds(value: Option<&str>) -> Option<WidgetBounds> {
    let parsed: serde_json::Value = serde_json::from_str(value?).ok()?;
    let x = finite(parsed.get("x")?.as_f64()?)?;
    let y = finite(parsed.get("y")?.as_f64()?)?;
    Some(WidgetBounds {
        x: round_to_i32(x)?,
        y: round_to_i32(y)?,
    })
}

/// Keeps the saved spot if it is inside an area; otherwise the top-right corner of the first.
#[must_use]
pub fn place_widget(saved: Option<WidgetBounds>, areas: &[WorkArea]) -> WidgetBounds {
    if let Some(spot) = saved.filter(|spot| areas.iter().any(|area| fits_in(area, *spot))) {
        return spot;
    }
    let first = areas.first().copied().unwrap_or(WorkArea {
        x: 0,
        y: 0,
        width: 1280,
        height: 800,
    });
    WidgetBounds {
        x: clamp_i32(
            i64::from(first.x) + i64::from(first.width) - i64::from(PLAN_WIDGET_WIDTH) - 32,
        ),
        y: clamp_i32(i64::from(first.y) + 32),
    }
}

/// The HWND from an Electron window handle: 8 bytes as u64 LE, else 4 bytes as u32 LE.
/// Returns 0 under 4 bytes (the TS version throws there).
#[must_use]
pub fn hwnd_from_handle(handle: &[u8]) -> u64 {
    if let Some(Ok(bytes)) = handle.get(..8).map(<[u8; 8]>::try_from) {
        return u64::from_le_bytes(bytes);
    }
    if let Some(Ok(bytes)) = handle.get(..4).map(<[u8; 4]>::try_from) {
        return u64::from(u32::from_le_bytes(bytes));
    }
    0
}

/// The PowerShell that pins the window to the desktop, with the HWND in decimal.
#[must_use]
pub fn pin_script(hwnd: u64) -> String {
    let hwnd_text = hwnd.to_string();
    [PIN_SCRIPT_HEAD, hwnd_text.as_str(), PIN_SCRIPT_TAIL].concat()
}

/// The `TaskbarCreated` message id the pin script printed, if it is a registered id (0xC000 to 0xFFFF).
#[must_use]
pub fn parse_taskbar_created(stdout: &str) -> Option<u32> {
    let id = stdout.split_whitespace().next()?.parse::<u32>().ok()?;
    (0xC000..=0xFFFF).contains(&id).then_some(id)
}

/// The arguments that run `script` in Windows PowerShell as `-EncodedCommand` (UTF-16LE, base64).
#[must_use]
pub fn powershell_args(script: &str) -> Vec<String> {
    let utf16: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    vec![
        "-NoProfile".to_owned(),
        "-NonInteractive".to_owned(),
        "-EncodedCommand".to_owned(),
        STANDARD.encode(utf16),
    ]
}

/// Saves the choice, then applies it. A save error is returned unchanged; an apply error is named.
///
/// # Errors
/// Returns the save error as is, or the apply error with the on/off message.
pub async fn switch_plan_widget<S, SF, A, AF>(on: bool, save: S, apply: A) -> Result<(), String>
where
    S: FnOnce(bool) -> SF,
    SF: Future<Output = Result<(), String>>,
    A: FnOnce(bool) -> AF,
    AF: Future<Output = Result<(), String>>,
{
    save(on).await?;
    apply(on).await.map_err(|err| {
        let what = if on {
            WIDGET_ON_FAILED
        } else {
            WIDGET_OFF_FAILED
        };
        format!("{what}: {err}")
    })
}

/// The pin script before the HWND, through `$window = [IntPtr][Int64]`.
const PIN_SCRIPT_HEAD: &str = r##"$ErrorActionPreference = 'Stop'
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
$window = [IntPtr][Int64]"##;

/// The pin script after the HWND.
const PIN_SCRIPT_TAIL: &str = r##"
[WeaveForgePin]::RegisterWindowMessage('TaskbarCreated')
$desktop = [WeaveForgePin]::FindWindow('Progman', [IntPtr]::Zero)
if ($desktop -eq [IntPtr]::Zero) { exit 2 }
[void][WeaveForgePin]::SetWindowLongPtr($window, -8, $desktop)
[void][WeaveForgePin]::SetWindowPos($window, [IntPtr]1, 0, 0, 0, 0, 0x13)
[WeaveForgePin]::Hold($window)
"##;

fn radius_rule(v: &str) -> bool {
    px_between(v, 0.0, 999.0)
}

fn radius_sm_rule(v: &str) -> bool {
    px_between(v, 0.0, 999.0)
}

fn bw_rule(v: &str) -> bool {
    px_between(v, 0.0, 8.0)
}

fn sh_rule(v: &str) -> bool {
    shadow_ok(v)
}

fn sh_sm_rule(v: &str) -> bool {
    shadow_ok(v)
}

fn font_rule(v: &str) -> bool {
    v.len() <= 300
        && !v.is_empty()
        && v.chars().all(|c| {
            c.is_ascii_alphanumeric()
                || matches!(c, '_' | ',' | '"' | '\'' | '-')
                || c.is_whitespace()
        })
}

fn fs_rule(v: &str) -> bool {
    px_between(v, 8.0, 32.0)
}

fn fs_sm_rule(v: &str) -> bool {
    px_between(v, 8.0, 32.0)
}

/// A `#rrggbb` colour, either case.
fn is_hex_colour(v: &str) -> bool {
    v.len() == 7
        && v.strip_prefix('#')
            .is_some_and(|hex| hex.bytes().all(|b| b.is_ascii_hexdigit()))
}

fn finite(v: f64) -> Option<f64> {
    v.is_finite().then_some(v)
}

/// JavaScript's `Math.round` for an i32-range value, else None.
fn round_to_i32(v: f64) -> Option<i32> {
    (v + 0.5).floor().to_string().parse::<i32>().ok()
}

fn clamp_i32(value: i64) -> i32 {
    i32::try_from(value).unwrap_or(if value < 0 { i32::MIN } else { i32::MAX })
}

fn fits_in(area: &WorkArea, spot: WidgetBounds) -> bool {
    let (x, y) = (i64::from(spot.x), i64::from(spot.y));
    let (left, top) = (i64::from(area.x), i64::from(area.y));
    x >= left
        && y >= top
        && x + i64::from(PLAN_WIDGET_WIDTH) <= left + i64::from(area.width)
        && y + i64::from(PLAN_WIDGET_HEIGHT) <= top + i64::from(area.height)
}

/// A CSS length `N px` (1 to 3 integer digits, optional fraction) within `min..=max`.
fn px_between(v: &str, min: f64, max: f64) -> bool {
    let Some(number) = v.strip_suffix("px") else {
        return false;
    };
    let (whole, fraction) = number
        .split_once('.')
        .map_or((number, None), |(w, f)| (w, Some(f)));
    let whole_ok = (1..=3).contains(&whole.len()) && whole.bytes().all(|b| b.is_ascii_digit());
    let fraction_ok =
        fraction.is_none_or(|f| !f.is_empty() && f.bytes().all(|b| b.is_ascii_digit()));
    whole_ok && fraction_ok && number.parse::<f64>().is_ok_and(|n| n >= min && n <= max)
}

/// A computed box-shadow: `none`, or a list of rgb()/rgba(), px offsets, `inset`, commas and spaces.
fn shadow_ok(v: &str) -> bool {
    if v.len() > 300 || v.is_empty() {
        return false;
    }
    if v == "none" {
        return true;
    }
    let mut rest = v;
    while !rest.is_empty() {
        match shadow_token(rest) {
            Some(next) => rest = next,
            None => return false,
        }
    }
    true
}

/// Consumes one shadow token from the front of `rest`, returning what is left.
fn shadow_token(rest: &str) -> Option<&str> {
    if let Some(after) = rest
        .strip_prefix("rgba(")
        .or_else(|| rest.strip_prefix("rgb("))
    {
        return colour_tail(after);
    }
    if let Some(after) = rest.strip_prefix("inset") {
        return Some(after);
    }
    if let Some(after) = rest.strip_prefix(',') {
        return Some(after);
    }
    let first = rest.chars().next()?;
    if first.is_whitespace() {
        return rest.get(first.len_utf8()..);
    }
    px_token(rest)
}

/// The body of an rgb()/rgba() after its opening paren: digits, dots, commas, spaces, then `)`.
fn colour_tail(after: &str) -> Option<&str> {
    let end = after
        .find(|c: char| !(c.is_ascii_digit() || matches!(c, '.' | ',') || c.is_whitespace()))
        .unwrap_or(after.len());
    if end == 0 {
        return None;
    }
    after.get(end..)?.strip_prefix(')')
}

/// An optionally negative `N px` or `N.N px` at the front of `rest`.
fn px_token(rest: &str) -> Option<&str> {
    let unsigned = rest.strip_prefix('-').unwrap_or(rest);
    let whole = unsigned.bytes().take_while(u8::is_ascii_digit).count();
    if whole == 0 {
        return None;
    }
    let mut tail = unsigned.get(whole..)?;
    if let Some(after_dot) = tail.strip_prefix('.') {
        let fraction = after_dot.bytes().take_while(u8::is_ascii_digit).count();
        if fraction == 0 {
            return None;
        }
        tail = after_dot.get(fraction..)?;
    }
    tail.strip_prefix("px")
}
