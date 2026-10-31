//! The window's menu: the model the page's menu bar draws, and the actions its entries run.

use std::path::Path;
use std::sync::Mutex;

use tauri::{Emitter as _, Manager as _, Runtime};
use tauri_plugin_opener::OpenerExt as _;

use crate::app_log::{AppLog, LogLevel};
use crate::launch::without_verbatim_prefix;
use crate::vault::VaultState;

/// The DOM event the page listens for (`MENU_COMMAND_EVENT` in `desktop-title-bar.tsx`).
pub const PAGE_COMMAND_EVENT: &str = "weaveforge:menu-command";
/// The documentation site the Help menu's Documentation entry opens.
pub const DOCS_URL: &str = "https://www.weaveforge.org/docs/";
/// The Tauri event that asks the page to route (the page side is wired in 2.13).
pub const MENU_ROUTE_EVENT: &str = "menu-route";
/// The error for a menu entry that cannot run (unknown, a separator, or disabled).
pub const NOT_AVAILABLE: &str = "That menu entry is not available.";
/// The error for a title bar colour that is not `#rrggbb`.
pub const BAD_TITLE_BAR_COLOR: &str = "Title bar colours must be #rrggbb.";
/// The title bar's height in CSS pixels, as the TS sets it. Tauri takes no overlay height here, so nothing reads it yet.
pub const TITLE_BAR_HEIGHT: u32 = 36;

/// What the menu needs from the window and app. The Tauri impl lives in this file; tests use a fake.
pub trait MenuHost {
    /// Take the window to a route inside the app.
    fn go_to(&self, route: &str);
    /// Ask the page to do one of its own things (`search`).
    fn page_command(&self, command: &str);
    /// Run a native role against the window.
    fn role(&self, role: MenuRole);
    /// Whether the window is maximised now.
    fn is_maximized(&self) -> bool;
    /// Whether the window is full screen now.
    fn is_fullscreen(&self) -> bool;
    /// The workspace folder in use, or `None` when none is connected.
    fn workspace_root(&self) -> Option<String>;
    /// Open the folder picker to choose a new workspace folder (2.13 wires the native side).
    fn choose_workspace(&self);
    /// Reveal the workspace folder in the system file explorer.
    fn show_in_explorer(&self);
    /// Open the documentation site in the browser.
    fn open_docs(&self);
    /// Look for an app update (2.13 wires the native side).
    fn check_updates(&self);
    /// The app's version, as the Help menu's label shows it.
    fn app_version(&self) -> String;
}

/// A native action the menu runs against the window (Electron's roles, Windows and Linux).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MenuRole {
    /// Undo in the page.
    Undo,
    /// Redo in the page.
    Redo,
    /// Cut in the page.
    Cut,
    /// Copy in the page.
    Copy,
    /// Paste in the page.
    Paste,
    /// Select all in the page.
    SelectAll,
    /// Reload the page.
    Reload,
    /// Back to 100%.
    ResetZoom,
    /// One step bigger.
    ZoomIn,
    /// One step smaller.
    ZoomOut,
    /// Toggle full screen.
    FullScreen,
    /// Toggle developer tools (debug builds only).
    DevTools,
    /// Minimise the window.
    Minimize,
    /// Maximise, or restore when maximised.
    Maximize,
    /// Close the window.
    Close,
    /// Quit the app.
    Quit,
}

/// The page command that runs an edit role in the page's editor, or `None` for a native role.
#[must_use]
pub fn edit_command(role: MenuRole) -> Option<&'static str> {
    match role {
        MenuRole::Undo => Some("edit-undo"),
        MenuRole::Redo => Some("edit-redo"),
        MenuRole::Cut => Some("edit-cut"),
        MenuRole::Copy => Some("edit-copy"),
        MenuRole::Paste => Some("edit-paste"),
        MenuRole::SelectAll => Some("edit-select-all"),
        MenuRole::Reload
        | MenuRole::ResetZoom
        | MenuRole::ZoomIn
        | MenuRole::ZoomOut
        | MenuRole::FullScreen
        | MenuRole::DevTools
        | MenuRole::Minimize
        | MenuRole::Maximize
        | MenuRole::Close
        | MenuRole::Quit => None,
    }
}

/// What kind of entry a menu item is, as the page draws it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum MenuItemKind {
    /// A plain entry.
    Item,
    /// A checkable entry (none uses it yet).
    Check,
    /// A divider.
    Separator,
}

/// One entry of a menu group, as the page's menu bar reads it (`DesktopMenuItem`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MenuItem {
    /// The id the page sends back to `menu_invoke`.
    pub id: String,
    /// Entry, check or separator.
    pub kind: MenuItemKind,
    /// The text the page shows.
    pub label: String,
    /// The shortcut as the platform writes it (`Ctrl+Shift+I`), or none.
    pub accelerator: Option<String>,
    /// Whether the entry can be chosen.
    pub enabled: bool,
    /// Set when the entry only opens a route.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route: Option<String>,
    /// A page action the page runs itself.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
}

/// A top-level menu and its entries (`DesktopMenuGroup`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MenuGroup {
    /// The group's name, as the menu bar shows it.
    pub label: String,
    /// The group's entries, in order.
    pub items: Vec<MenuItem>,
}

/// What choosing an entry does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Action {
    None,
    Route(&'static str),
    Page(&'static str),
    Role(MenuRole),
    ChooseWorkspace,
    ShowInExplorer,
    OpenDocs,
    CheckUpdates,
}

/// An entry before its id is numbered: the payload plus what it runs.
#[derive(Debug, Clone)]
struct Entry {
    id: String,
    label: String,
    kind: MenuItemKind,
    accelerator: Option<&'static str>,
    enabled: bool,
    action: Action,
}

impl Entry {
    /// An enabled entry; its id is numbered later unless `with_id` sets one.
    fn new(label: &str, accelerator: Option<&'static str>, action: Action) -> Self {
        Self {
            id: String::new(),
            label: label.to_owned(),
            kind: MenuItemKind::Item,
            accelerator,
            enabled: true,
            action,
        }
    }

    fn with_id(mut self, id: String) -> Self {
        self.id = id;
        self
    }

    fn separator() -> Self {
        Self {
            id: String::new(),
            label: String::new(),
            kind: MenuItemKind::Separator,
            accelerator: None,
            enabled: false,
            action: Action::None,
        }
    }

    fn route(label: &str, route: &'static str, accelerator: Option<&'static str>) -> Self {
        Self::new(label, accelerator, Action::Route(route)).with_id(format!("route:{route}"))
    }

    fn page(label: &str, command: &'static str, accelerator: Option<&'static str>) -> Self {
        Self::new(label, accelerator, Action::Page(command)).with_id(format!("page:{command}"))
    }

    fn role(label: &str, role: MenuRole, accelerator: Option<&'static str>) -> Self {
        Self::new(label, accelerator, Action::Role(role))
    }
}

/// A top-level group while it is being built.
struct Group {
    label: &'static str,
    entries: Vec<Entry>,
}

/// Build the whole menu, with every entry's id set.
fn build(host: &impl MenuHost) -> Vec<Group> {
    let groups = vec![
        Group {
            label: "File",
            entries: file_entries(host),
        },
        Group {
            label: "Edit",
            entries: edit_entries(),
        },
        Group {
            label: "Go",
            entries: go_entries(),
        },
        Group {
            label: "View",
            entries: view_entries(),
        },
        Group {
            label: "Window",
            entries: window_entries(host),
        },
        Group {
            label: "Help",
            entries: help_entries(host),
        },
    ];
    groups
        .into_iter()
        .enumerate()
        .map(|(index, group)| Group {
            label: group.label,
            entries: number(&format!("m.{index}"), group.entries),
        })
        .collect()
}

/// Give each entry without an id the TS `withIds` id: its group's prefix and its position.
fn number(prefix: &str, entries: Vec<Entry>) -> Vec<Entry> {
    entries
        .into_iter()
        .enumerate()
        .map(|(index, mut entry)| {
            if entry.id.is_empty() {
                entry.id = format!("{prefix}.{index}");
            }
            entry
        })
        .collect()
}

fn file_entries(host: &impl MenuHost) -> Vec<Entry> {
    let mut entries = workspace_entries(host);
    entries.push(Entry::route("Settings", "/settings", Some("Ctrl+,")));
    entries.push(Entry::separator());
    entries.push(Entry::role("Quit", MenuRole::Quit, QUIT_ACCELERATOR));
    entries
}

/// The File menu's workspace block: the folder's name and its actions, or just the choose entry with no root.
fn workspace_entries(host: &impl MenuHost) -> Vec<Entry> {
    let Some(root) = host.workspace_root() else {
        return vec![
            Entry::new("Choose workspace folder…", None, Action::ChooseWorkspace),
            Entry::separator(),
        ];
    };
    let mut info = Entry::new(
        &format!("Workspace: {}", folder_name(&root)),
        None,
        Action::None,
    )
    .with_id("info:workspace".to_owned());
    info.enabled = false;
    vec![
        info,
        Entry::new("Show in file explorer", None, Action::ShowInExplorer),
        Entry::new("Change workspace folder…", None, Action::ChooseWorkspace),
        Entry::separator(),
    ]
}

/// The Help menu, as the TS has it: docs, a divider, updates, then the disabled version label.
fn help_entries(host: &impl MenuHost) -> Vec<Entry> {
    let mut version = Entry::new(
        &format!("Version {}", host.app_version()),
        None,
        Action::None,
    );
    version.enabled = false;
    vec![
        Entry::new("Documentation", None, Action::OpenDocs),
        Entry::separator(),
        Entry::new("Check for updates…", None, Action::CheckUpdates),
        version,
    ]
}

/// The last part of a path, as Node's `path.basename` gives it; the whole path when that is empty.
fn folder_name(root: &str) -> &str {
    let name = root
        .trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("");
    if name.is_empty() { root } else { name }
}

/// Electron's redo role shortcut: `Control+Y` on Windows, `Shift+Control+Z` elsewhere.
#[cfg(windows)]
const REDO_ACCELERATOR: &str = "Control+Y";
/// Electron's redo role shortcut: `Control+Y` on Windows, `Shift+Control+Z` elsewhere.
#[cfg(not(windows))]
const REDO_ACCELERATOR: &str = "Shift+Control+Z";
/// Electron's quit role has no shortcut on Windows; Linux uses `Control+Q`.
#[cfg(windows)]
const QUIT_ACCELERATOR: Option<&str> = None;
/// Electron's quit role has no shortcut on Windows; Linux uses `Control+Q`.
#[cfg(not(windows))]
const QUIT_ACCELERATOR: Option<&str> = Some("Control+Q");

fn edit_entries() -> Vec<Entry> {
    vec![
        Entry::role("Undo", MenuRole::Undo, Some("CommandOrControl+Z")),
        Entry::role("Redo", MenuRole::Redo, Some(REDO_ACCELERATOR)),
        Entry::separator(),
        Entry::role("Cut", MenuRole::Cut, Some("CommandOrControl+X")),
        Entry::role("Copy", MenuRole::Copy, Some("CommandOrControl+C")),
        Entry::role("Paste", MenuRole::Paste, Some("CommandOrControl+V")),
        Entry::role(
            "Select all",
            MenuRole::SelectAll,
            Some("CommandOrControl+A"),
        ),
    ]
}

/// The sidebar's pages, in its order and with its names (the TS `Go` menu).
fn go_entries() -> Vec<Entry> {
    vec![
        Entry::route("Home", "/dashboard", None),
        Entry::page("Search…", "search", Some("CommandOrControl+K")),
        Entry::route("Workspace", "/workspace", None),
        Entry::separator(),
        Entry::route("Papers", "/papers", None),
        Entry::route("Notes", "/notes", None),
        Entry::route("Graph", "/graph", None),
        Entry::route("Lists", "/lists", None),
        Entry::separator(),
        Entry::route("Experiments", "/experiments", None),
        Entry::route("Git", "/git", None),
        Entry::route("Plan", "/plan", None),
        Entry::route("Log", "/log", None),
        Entry::separator(),
        Entry::route("Report", "/report", None),
        Entry::route("Overleaf", "/report/overleaf", None),
        Entry::separator(),
        Entry::route("AI suggestions", "/ai-review", None),
        Entry::route("Shared with you", "/shared", None),
        Entry::route("Supervision", "/supervision", None),
        Entry::route("Settings", "/settings", None),
    ]
}

fn view_entries() -> Vec<Entry> {
    vec![
        Entry::role("Reload", MenuRole::Reload, Some("CommandOrControl+R")),
        Entry::role(
            "Actual size",
            MenuRole::ResetZoom,
            Some("CommandOrControl+0"),
        ),
        Entry::role("Zoom in", MenuRole::ZoomIn, Some("CommandOrControl+Plus")),
        Entry::role("Zoom out", MenuRole::ZoomOut, Some("CommandOrControl+-")),
        Entry::separator(),
        Entry::role("Full screen", MenuRole::FullScreen, Some("F11")),
        Entry::role(
            "Developer tools",
            MenuRole::DevTools,
            Some("CommandOrControl+Shift+I"),
        ),
    ]
}

/// No shortcuts on these: Ctrl+W would close the app from the editor, and the OS has its own keys for both.
fn window_entries(host: &impl MenuHost) -> Vec<Entry> {
    let maximize_label = if host.is_maximized() {
        "Restore"
    } else {
        "Maximize"
    };
    vec![
        Entry::role("Minimize", MenuRole::Minimize, None),
        Entry::role(maximize_label, MenuRole::Maximize, None).with_id("window:maximize".to_owned()),
        Entry::separator(),
        Entry::role("Close window", MenuRole::Close, None),
    ]
}

/// The shortcut as the platform writes it: `CommandOrControl+X` becomes `Ctrl+X`; `None` when empty.
#[must_use]
pub fn accelerator_label(accelerator: &str) -> Option<String> {
    if accelerator.is_empty() {
        return None;
    }
    let parts: Vec<&str> = accelerator
        .split('+')
        .map(|part| match part {
            "CommandOrControl" | "CmdOrCtrl" | "Control" => "Ctrl",
            "Plus" => "+",
            other => other,
        })
        .collect();
    Some(parts.join("+"))
}

fn to_item(entry: &Entry) -> MenuItem {
    MenuItem {
        id: entry.id.clone(),
        kind: entry.kind,
        label: entry.label.clone(),
        accelerator: entry.accelerator.and_then(accelerator_label),
        enabled: entry.enabled,
        route: match entry.action {
            Action::Route(route) => Some(route.to_owned()),
            _ => None,
        },
        command: match entry.action {
            Action::Page(command) => Some(command.to_owned()),
            _ => None,
        },
    }
}

/// The menu as the page's menu bar draws it: the groups and their entries.
#[must_use]
pub fn menu_model(host: &impl MenuHost) -> Vec<MenuGroup> {
    build(host)
        .iter()
        .map(|group| MenuGroup {
            label: group.label.to_owned(),
            items: group.entries.iter().map(to_item).collect(),
        })
        .collect()
}

/// Run one entry by id, as choosing it would. Unknown, separator and disabled ids are `NOT_AVAILABLE`.
///
/// # Errors
/// Returns `NOT_AVAILABLE` when no enabled entry has the id.
pub fn menu_invoke(host: &impl MenuHost, id: &str) -> Result<(), String> {
    let groups = build(host);
    let entry = groups
        .iter()
        .flat_map(|group| group.entries.iter())
        .find(|entry| entry.id == id && entry.enabled && entry.kind != MenuItemKind::Separator)
        .ok_or_else(|| NOT_AVAILABLE.to_owned())?;
    run(host, entry.action);
    Ok(())
}

fn run(host: &impl MenuHost, action: Action) {
    match action {
        Action::None => {}
        Action::Route(route) => host.go_to(route),
        Action::Page(command) => host.page_command(command),
        Action::Role(role) => host.role(role),
        Action::ChooseWorkspace => host.choose_workspace(),
        Action::ShowInExplorer => host.show_in_explorer(),
        Action::OpenDocs => host.open_docs(),
        Action::CheckUpdates => host.check_updates(),
    }
}

/// Check both title bar colours are `#rrggbb`. The TS ignored a bad pair; this reports it.
///
/// # Errors
/// Returns `BAD_TITLE_BAR_COLOR` when either colour is not `#rrggbb`.
pub fn check_title_bar_colors(background: &str, ink: &str) -> Result<(), String> {
    if is_hex_colour(background) && is_hex_colour(ink) {
        Ok(())
    } else {
        Err(BAD_TITLE_BAR_COLOR.to_owned())
    }
}

fn is_hex_colour(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value
            .get(1..)
            .is_some_and(|hex| hex.chars().all(|c| c.is_ascii_hexdigit()))
}

/// Paint the title bar background from `background`. `ink` is checked but not applied: Tauri has no overlay symbol colour.
///
/// # Errors
/// Returns `BAD_TITLE_BAR_COLOR` for a bad colour, or the Tauri error text if the window refuses.
pub fn apply_title_bar_colors<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    background: &str,
    ink: &str,
) -> Result<(), String> {
    check_title_bar_colors(background, ink)?;
    let color = tauri::window::Color(
        hex_byte(background, 1)?,
        hex_byte(background, 3)?,
        hex_byte(background, 5)?,
        255,
    );
    window
        .set_background_color(Some(color))
        .map_err(|error| error.to_string())
}

/// One `#rrggbb` channel, read from `start`.
fn hex_byte(hex: &str, start: usize) -> Result<u8, String> {
    hex.get(start..start + 2)
        .and_then(|pair| u8::from_str_radix(pair, 16).ok())
        .ok_or_else(|| BAD_TITLE_BAR_COLOR.to_owned())
}

/// Full screen follows the page's focus mode. The menu bar is not hidden: this app has no native menu bar to hide.
///
/// # Errors
/// Returns the Tauri error text if the window refuses.
pub fn set_window_focus<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    focus: bool,
) -> Result<(), String> {
    window
        .set_fullscreen(focus)
        .map_err(|error| error.to_string())
}

/// Zoom factors the window steps through, as Electron's are (an approximation of its log steps).
const ZOOM_STEPS: [f64; 10] = [0.5, 0.67, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];

/// The current zoom factor. Kept here, not in the host, because each command builds a new host.
static ZOOM: Mutex<f64> = Mutex::new(1.0);

fn zoom_in(current: f64) -> f64 {
    ZOOM_STEPS
        .iter()
        .copied()
        .find(|step| *step > current)
        .unwrap_or(current)
}

fn zoom_out(current: f64) -> f64 {
    ZOOM_STEPS
        .iter()
        .copied()
        .rev()
        .find(|step| *step < current)
        .unwrap_or(current)
}

/// The menu's host on a Tauri window.
pub struct TauriMenuHost<R: Runtime> {
    window: tauri::WebviewWindow<R>,
}

impl<R: Runtime> TauriMenuHost<R> {
    /// Wrap the window the menu acts on.
    #[must_use]
    pub fn new(window: tauri::WebviewWindow<R>) -> Self {
        Self { window }
    }

    /// Open the workspace folder in the file explorer; `Err` when there is none or the OS refuses.
    fn open_workspace_folder(&self) -> Result<(), String> {
        let root = self
            .workspace_root()
            .ok_or_else(|| "There is no workspace folder to open.".to_owned())?;
        let path = without_verbatim_prefix(Path::new(&root));
        let text = path
            .to_str()
            .ok_or_else(|| "path is not valid UTF-8".to_owned())?;
        self.window
            .app_handle()
            .opener()
            .open_path(text, None::<&str>)
            .map_err(|e| e.to_string())
    }

    fn log_failure(&self, message: &str, reason: &str) {
        if let Some(log) = self.window.app_handle().try_state::<AppLog>() {
            log.record(LogLevel::Warn, "menu", message, Some(reason));
        }
    }

    fn step_zoom(&self, next: impl Fn(f64) -> f64) {
        if let Ok(mut zoom) = ZOOM.lock() {
            *zoom = next(*zoom);
            let _ = self.window.set_zoom(*zoom);
        }
    }

    fn toggle_maximized(&self) {
        if self.is_maximized() {
            let _ = self.window.unmaximize();
        } else {
            let _ = self.window.maximize();
        }
    }

    #[cfg(debug_assertions)]
    fn dev_tools(&self) {
        self.window.open_devtools();
    }

    #[cfg(not(debug_assertions))]
    fn dev_tools(&self) {}
}

impl<R: Runtime> MenuHost for TauriMenuHost<R> {
    fn go_to(&self, route: &str) {
        let _ = self
            .window
            .emit(MENU_ROUTE_EVENT, serde_json::json!({ "route": route }));
    }

    fn page_command(&self, command: &str) {
        let _ = self.window.emit(
            PAGE_COMMAND_EVENT,
            serde_json::json!({ "command": command }),
        );
    }

    /// Edit roles go to the page as `edit-*` menu commands, since WebView2 blocks `execCommand('paste')`.
    /// The other roles run natively against the window.
    fn role(&self, role: MenuRole) {
        if let Some(command) = edit_command(role) {
            self.page_command(command);
            return;
        }
        match role {
            // Sent to the page above.
            MenuRole::Undo
            | MenuRole::Redo
            | MenuRole::Cut
            | MenuRole::Copy
            | MenuRole::Paste
            | MenuRole::SelectAll => {}
            MenuRole::Reload => {
                let _ = self.window.eval("location.reload()");
            }
            MenuRole::ResetZoom => self.step_zoom(|_| 1.0),
            MenuRole::ZoomIn => self.step_zoom(zoom_in),
            MenuRole::ZoomOut => self.step_zoom(zoom_out),
            MenuRole::FullScreen => {
                let _ = self.window.set_fullscreen(!self.is_fullscreen());
            }
            MenuRole::DevTools => self.dev_tools(),
            MenuRole::Minimize => {
                let _ = self.window.minimize();
            }
            MenuRole::Maximize => self.toggle_maximized(),
            MenuRole::Close => {
                let _ = self.window.close();
            }
            MenuRole::Quit => self.window.app_handle().exit(0),
        }
    }

    fn is_maximized(&self) -> bool {
        self.window.is_maximized().unwrap_or(false)
    }

    fn is_fullscreen(&self) -> bool {
        self.window.is_fullscreen().unwrap_or(false)
    }

    /// The vault's folder, or `None` when no workspace is connected.
    fn workspace_root(&self) -> Option<String> {
        self.window
            .app_handle()
            .try_state::<VaultState>()
            .and_then(|vault| vault.lock().root())
            .map(|root| root.path)
    }

    /// Sent to the page as a menu command; 2.13 wires the native side.
    fn choose_workspace(&self) {
        self.page_command("choose-workspace");
    }

    /// Opens the workspace folder natively; a failure goes to the app log,
    /// since the page cannot open a folder either.
    fn show_in_explorer(&self) {
        if let Err(reason) = self.open_workspace_folder() {
            self.log_failure("The workspace folder could not be opened", &reason);
        }
    }

    /// Opens the docs in the browser; a failure goes to the app log.
    fn open_docs(&self) {
        let opened = self
            .window
            .app_handle()
            .opener()
            .open_url(DOCS_URL, None::<&str>);
        if let Err(error) = opened {
            self.log_failure("The docs could not be opened", &error.to_string());
        }
    }

    /// Sent to the page as a menu command; 2.13 wires the native side.
    fn check_updates(&self) {
        self.page_command("check-updates");
    }

    fn app_version(&self) -> String {
        self.window.app_handle().package_info().version.to_string()
    }
}

/// The Tauri commands for the window's menu. Each one only forwards to the plain fns above.
pub mod commands {
    use super::{MenuGroup, TauriMenuHost};
    use crate::commands::ShellError;

    /// The window's menu, as the page's menu bar draws it.
    ///
    /// # Errors
    /// Never fails today; the `Result` keeps the command's shape.
    #[tauri::command]
    #[specta::specta]
    pub async fn menu_model(
        window: tauri::WebviewWindow<tauri::Wry>,
    ) -> Result<Vec<MenuGroup>, ShellError> {
        Ok(super::menu_model(&TauriMenuHost::new(window)))
    }

    /// Run one menu entry by its id.
    ///
    /// # Errors
    /// Returns an error when the entry is unknown, a separator, or disabled.
    #[tauri::command]
    #[specta::specta]
    pub async fn menu_invoke(
        window: tauri::WebviewWindow<tauri::Wry>,
        id: String,
    ) -> Result<(), ShellError> {
        super::menu_invoke(&TauriMenuHost::new(window), &id).map_err(ShellError::from)
    }

    /// Set the title bar's background and check its ink colour.
    ///
    /// # Errors
    /// Returns an error when either colour is not `#rrggbb`.
    #[tauri::command]
    #[specta::specta]
    pub async fn title_bar_colors(
        window: tauri::WebviewWindow<tauri::Wry>,
        background: String,
        ink: String,
    ) -> Result<(), ShellError> {
        super::apply_title_bar_colors(&window, &background, &ink).map_err(ShellError::from)
    }

    /// Follow the page's focus mode: full screen on or off.
    ///
    /// # Errors
    /// Returns an error when the window refuses the change.
    #[tauri::command]
    #[specta::specta]
    pub async fn window_focus(
        window: tauri::WebviewWindow<tauri::Wry>,
        focus: bool,
    ) -> Result<(), ShellError> {
        super::set_window_focus(&window, focus).map_err(ShellError::from)
    }
}
