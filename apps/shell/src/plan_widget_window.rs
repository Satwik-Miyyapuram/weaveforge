//! The plan widget's window and the commands the page and the widget call.
//! The window exists on desktops; it is offered (and pinned to the desktop) on Windows only.

use std::collections::BTreeMap;

use crate::commands::{Json, LocalDb, ShellError};
use crate::plan_widget::{
    PLAN_WIDGET_LIMIT, PLAN_WIDGET_SQL, clean_widget_palette, rows_to_milestones,
    switch_plan_widget,
};
use crate::prefs::{PrefValue, Prefs};

/// The widget window's label.
pub const WIDGET_WINDOW: &str = "plan-widget";
/// Whether the widget is on.
const ENABLED_PREF: &str = "plan-widget";
/// Where the widget was left, as `{ x, y }` in logical pixels.
const BOUNDS_PREF: &str = "plan-widget-bounds";
/// The app's palette for the widget, as JSON text.
const THEME_PREF: &str = "plan-widget-theme";

/// The plan widget, as `DesktopPlanWidget` in apps/web/src/lib/desktop/desktop-bridge.ts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
pub struct PlanWidgetStatePayload {
    /// False where the shell cannot put a window on the desktop (not Windows).
    pub supported: bool,
    /// Whether the widget is on.
    pub enabled: bool,
}

/// True when the saved switch is on.
#[must_use]
pub fn widget_enabled(prefs: &Prefs) -> bool {
    matches!(prefs.read(ENABLED_PREF), Ok(Some(PrefValue::Flag(true))))
}

fn state_of(prefs: &Prefs) -> PlanWidgetStatePayload {
    PlanWidgetStatePayload {
        supported: cfg!(windows),
        enabled: widget_enabled(prefs),
    }
}

/// Whether the widget can be shown here, and whether it is on.
///
/// # Errors
/// Never fails; the `Result` keeps the command's shape.
#[tauri::command]
#[specta::specta]
pub async fn plan_widget_state(
    prefs: tauri::State<'_, Prefs>,
) -> Result<PlanWidgetStatePayload, ShellError> {
    Ok(state_of(&prefs))
}

/// Turns the widget on or off: saves the choice, then opens or closes its window.
///
/// # Errors
/// Returns an error when the choice cannot be saved or the window cannot be opened or closed.
#[tauri::command]
#[specta::specta]
pub async fn plan_widget_set(
    app: tauri::AppHandle,
    prefs: tauri::State<'_, Prefs>,
    on: bool,
) -> Result<PlanWidgetStatePayload, ShellError> {
    let saver = prefs.inner().clone();
    let save = move |on: bool| async move {
        saver
            .queued(move |p| p.write(ENABLED_PREF, Some(PrefValue::Flag(on))))
            .await
            .map_err(|e| e.to_string())
    };
    let apply = |on: bool| {
        let app = app.clone();
        async move {
            if on {
                window::open(&app).map_err(|e| e.to_string())
            } else {
                window::close(&app).map_err(|e| e.to_string())
            }
        }
    };
    switch_plan_widget(on, save, apply).await?;
    Ok(state_of(&prefs))
}

/// Takes the app's palette for the widget: saves it, and hands it to an open widget.
/// A palette that is not plain colours and shapes is dropped.
///
/// # Errors
/// Returns an error when the palette cannot be saved.
#[tauri::command]
#[specta::specta]
pub async fn plan_widget_theme(
    app: tauri::AppHandle,
    prefs: tauri::State<'_, Prefs>,
    palette: Json,
) -> Result<(), ShellError> {
    let value = serde_json::to_value(palette).unwrap_or_default();
    let Some(clean) = clean_widget_palette(&value) else {
        return Ok(());
    };
    let text = serde_json::to_string(&clean).unwrap_or_else(|_| "{}".to_owned());
    prefs
        .queued(move |p| p.write(THEME_PREF, Some(PrefValue::Text(text))))
        .await?;
    window::push_theme(&app, &clean);
    Ok(())
}

/// The saved palette, if it is still a clean one.
///
/// # Errors
/// Never fails; the `Result` keeps the command's shape.
#[tauri::command]
#[specta::specta]
pub async fn plan_widget_palette(
    prefs: tauri::State<'_, Prefs>,
) -> Result<Option<BTreeMap<String, String>>, ShellError> {
    Ok(saved_palette(&prefs))
}

fn saved_palette(prefs: &Prefs) -> Option<BTreeMap<String, String>> {
    let Ok(Some(PrefValue::Text(text))) = prefs.read(THEME_PREF) else {
        return None;
    };
    clean_widget_palette(&serde_json::from_str(&text).ok()?)
}

/// The widget's deadlines from the local database, as the web feed's widget JSON.
///
/// # Errors
/// Returns an error when the local database cannot be read.
#[tauri::command]
#[specta::specta]
pub async fn plan_widget_data(db: tauri::State<'_, LocalDb>) -> Result<Json, ShellError> {
    let rows = db.query(PLAN_WIDGET_SQL.to_owned(), Vec::new()).await?;
    let items = rows_to_milestones(&rows);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX));
    let data =
        wf_core::plan::feed::plan_widget_data(&items, false, Some(PLAN_WIDGET_LIMIT), now_ms);
    serde_json::from_value(data).map_err(|_| ShellError::from("plan widget: bad data".to_owned()))
}

/// Brings the app forward on its plan page, opening the main window if it is closed.
///
/// # Errors
/// Returns an error when the main window cannot be opened.
#[tauri::command]
#[specta::specta]
pub async fn plan_widget_open(app: tauri::AppHandle) -> Result<(), ShellError> {
    window::show_plan(&app).map_err(|e| ShellError::from(format!("Could not open the plan: {e}")))
}

/// Opens the widget at start when it is on and the build is Windows.
pub fn open_at_start(app: &tauri::AppHandle) {
    use tauri::Manager as _;
    if cfg!(windows)
        && let Some(prefs) = app.try_state::<Prefs>()
        && widget_enabled(&prefs)
    {
        let _ = window::open(app);
    }
}

#[cfg(desktop)]
mod window {
    use std::collections::BTreeMap;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::Duration;

    use tauri::{LogicalPosition, LogicalSize, Manager as _, WebviewUrl, WebviewWindowBuilder};

    use super::{BOUNDS_PREF, WIDGET_WINDOW};
    use crate::plan_widget::{
        PLAN_WIDGET_HEIGHT, PLAN_WIDGET_WIDTH, WIDGET_SCRIPT, WidgetBounds, WorkArea, parse_bounds,
        place_widget, theme_push_script,
    };
    use crate::prefs::{PrefValue, Prefs};

    /// How long the widget must sit still before its spot is saved.
    const SAVE_DELAY: Duration = Duration::from_millis(500);

    /// Opens the widget, or shows it if it is already open.
    pub fn open(app: &tauri::AppHandle) -> tauri::Result<()> {
        if let Some(existing) = app.get_webview_window(WIDGET_WINDOW) {
            return existing.show();
        }
        let url = "app://localhost/plan-widget/"
            .parse()
            .map_err(|_| tauri::Error::WindowNotFound)?;
        let window = WebviewWindowBuilder::new(app, WIDGET_WINDOW, WebviewUrl::CustomProtocol(url))
            .title("WeaveForge plan")
            .use_https_scheme(true)
            .decorations(false)
            .transparent(true)
            .skip_taskbar(true)
            .focused(false)
            .resizable(false)
            .always_on_bottom(true)
            .shadow(false)
            .inner_size(f64::from(PLAN_WIDGET_WIDTH), f64::from(PLAN_WIDGET_HEIGHT))
            .visible(false)
            .initialization_script(WIDGET_SCRIPT)
            .build()?;
        let spot = place_widget(saved_bounds(app), &work_areas(&window), primary(&window));
        window.set_size(LogicalSize::new(
            f64::from(PLAN_WIDGET_WIDTH),
            f64::from(PLAN_WIDGET_HEIGHT),
        ))?;
        window.set_position(LogicalPosition::new(f64::from(spot.x), f64::from(spot.y)))?;
        window.show()?;
        save_on_move(app, &window);
        pin(&window);
        Ok(())
    }

    /// Closes the widget if it is open.
    pub fn close(app: &tauri::AppHandle) -> tauri::Result<()> {
        match app.get_webview_window(WIDGET_WINDOW) {
            Some(window) => window.destroy(),
            None => Ok(()),
        }
    }

    /// Hands a palette to the open widget, if any.
    pub fn push_theme(app: &tauri::AppHandle, palette: &BTreeMap<String, String>) {
        if let Some(window) = app.get_webview_window(WIDGET_WINDOW) {
            let _ = window.eval(theme_push_script(palette));
        }
    }

    /// Shows the main window on the plan page, or opens it.
    pub fn show_plan(app: &tauri::AppHandle) -> tauri::Result<()> {
        let Some(main) = app.get_webview_window(crate::MAIN_WINDOW) else {
            return crate::open_main_window(app);
        };
        main.show()?;
        main.unminimize()?;
        main.set_focus()?;
        main.eval(crate::menu::page_route_script("/plan/"))
    }

    fn saved_bounds(app: &tauri::AppHandle) -> Option<WidgetBounds> {
        let prefs = app.try_state::<Prefs>()?;
        match prefs.read(BOUNDS_PREF) {
            Ok(Some(PrefValue::Text(text))) => parse_bounds(Some(&text)),
            _ => None,
        }
    }

    fn logical_area(monitor: &tauri::Monitor) -> WorkArea {
        let scale = monitor.scale_factor();
        let rect = monitor.work_area();
        let to = |v: f64| clamp_f64(v / scale);
        WorkArea {
            x: to(f64::from(rect.position.x)),
            y: to(f64::from(rect.position.y)),
            width: to(f64::from(rect.size.width)),
            height: to(f64::from(rect.size.height)),
        }
    }

    fn work_areas(window: &tauri::WebviewWindow) -> Vec<WorkArea> {
        window
            .available_monitors()
            .unwrap_or_default()
            .iter()
            .map(logical_area)
            .collect()
    }

    fn primary(window: &tauri::WebviewWindow) -> Option<WorkArea> {
        window
            .primary_monitor()
            .ok()
            .flatten()
            .as_ref()
            .map(logical_area)
    }

    #[allow(clippy::cast_possible_truncation)]
    fn clamp_f64(v: f64) -> i32 {
        // `as` saturates on overflow and maps NaN to 0.
        v.round() as i32
    }

    /// Saves the widget's spot once it has stopped moving for `SAVE_DELAY`.
    fn save_on_move(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
        let generation = Arc::new(AtomicU64::new(0));
        let app = app.clone();
        let watched = window.clone();
        window.on_window_event(move |event| {
            if !matches!(event, tauri::WindowEvent::Moved(_)) {
                return;
            }
            let mine = generation.fetch_add(1, Ordering::SeqCst) + 1;
            let (generation, app, window) = (Arc::clone(&generation), app.clone(), watched.clone());
            let _task = tauri::async_runtime::spawn(async move {
                tokio::time::sleep(SAVE_DELAY).await;
                if generation.load(Ordering::SeqCst) != mine {
                    return;
                }
                let (Ok(spot), Ok(scale)) = (window.outer_position(), window.scale_factor()) else {
                    return;
                };
                let spot = spot.to_logical::<f64>(scale);
                let text =
                    serde_json::json!({ "x": spot.x.round(), "y": spot.y.round() }).to_string();
                if let Some(prefs) = app.try_state::<Prefs>() {
                    let _ = prefs
                        .queued(move |p| p.write(BOUNDS_PREF, Some(PrefValue::Text(text))))
                        .await;
                }
            });
        });
    }

    /// Windows: parents the widget to the desktop so it sits under every window. Not waited on.
    #[cfg(windows)]
    fn pin(window: &tauri::WebviewWindow) {
        use std::os::windows::process::CommandExt as _;
        let Ok(hwnd) = window.hwnd() else {
            return;
        };
        #[allow(clippy::as_conversions)]
        let handle = hwnd.0 as usize as u64;
        let args = crate::plan_widget::powershell_args(&crate::plan_widget::pin_script(handle));
        let _ = std::process::Command::new("powershell")
            .args(args)
            .creation_flags(windows::Win32::System::Threading::CREATE_NO_WINDOW.0)
            .spawn();
    }

    #[cfg(not(windows))]
    fn pin(_window: &tauri::WebviewWindow) {}
}

#[cfg(mobile)]
mod window {
    use std::collections::BTreeMap;

    const NOT_HERE: &str = "There is no desktop widget on this device";

    pub fn open(_app: &tauri::AppHandle) -> Result<(), String> {
        Err(NOT_HERE.to_owned())
    }

    pub fn close(_app: &tauri::AppHandle) -> Result<(), String> {
        Ok(())
    }

    pub fn push_theme(_app: &tauri::AppHandle, _palette: &BTreeMap<String, String>) {}

    pub fn show_plan(_app: &tauri::AppHandle) -> Result<(), String> {
        Err(NOT_HERE.to_owned())
    }
}
