//! WeaveForge's Windows installer window.
//!
//! The NSIS installer electron-builder makes is kept exactly as it is — the
//! in-app updater downloads and runs that file silently, and its uninstaller is
//! what Windows' "Installed apps" calls — but its wizard is Win32 dialogs that
//! only take colours and two bitmaps. This is the window a reader sees instead:
//! a small WebView2 page in the app's own look, with the NSIS installer carried
//! inside this exe and run silently behind it.
//!
//! The file is this program with the NSIS installer appended, then a JSON
//! description, then a fixed trailer (`scripts/pack-setup.mjs` writes it):
//!
//! ```text
//! [this exe][payload][meta json][payload len: u64 LE][meta len: u64 LE]["WFSETUP1"]
//! ```
#![windows_subsystem = "windows"]

use std::borrow::Cow;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::json;
use tao::dpi::{LogicalSize, PhysicalPosition};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::platform::windows::{IconExtWindows, WindowBuilderExtWindows};
use tao::window::{Icon, WindowBuilder};
use wry::http::{header::CONTENT_TYPE, Request, Response};
use wry::{WebViewBuilder, WebViewBuilderExtWindows};

const MAGIC: &[u8; 8] = b"WFSETUP1";
const TRAILER: u64 = 24;
const INDEX_HTML: &str = include_str!("../ui/index.html");
const RUBIK: &[u8] = include_bytes!("../ui/rubik.woff2");
const ICON: &[u8] = include_bytes!("../../../../web/public/icons/icon-512.png");
const APP_EXE: &str = "WeaveForge.exe";
/// Keeps the NSIS window out of sight on the rare path where it shows one.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const DETACHED_PROCESS: u32 = 0x0000_0008;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Meta {
    version: String,
    /// Bytes on disk once installed, for the progress bar.
    install_size: u64,
}

#[derive(Clone)]
struct Payload {
    offset: u64,
    len: u64,
    meta: Meta,
}

enum UserEvent {
    Ipc(String),
    Script(String),
    Finished { ok: bool },
}

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "camelCase")]
enum Ipc {
    Ready,
    Drag,
    Minimize,
    Close,
    Browse { dir: String },
    Install { dir: String },
    Launch { dir: String },
}

fn read_payload(exe: &Path) -> Option<Payload> {
    let mut file = File::open(exe).ok()?;
    let size = file.metadata().ok()?.len();
    if size < TRAILER {
        return None;
    }
    file.seek(SeekFrom::Start(size - TRAILER)).ok()?;
    let mut trailer = [0u8; TRAILER as usize];
    file.read_exact(&mut trailer).ok()?;
    if &trailer[16..24] != MAGIC {
        return None;
    }
    let len = u64::from_le_bytes(trailer[0..8].try_into().ok()?);
    let meta_len = u64::from_le_bytes(trailer[8..16].try_into().ok()?);
    let meta_at = size.checked_sub(TRAILER + meta_len)?;
    let offset = meta_at.checked_sub(len)?;
    file.seek(SeekFrom::Start(meta_at)).ok()?;
    let mut meta = vec![0u8; meta_len as usize];
    file.read_exact(&mut meta).ok()?;
    let meta: Meta = serde_json::from_slice(&meta).ok()?;
    Some(Payload { offset, len, meta })
}

fn default_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    base.join("Programs").join("WeaveForge")
}

/// Bytes under `dir`, walked without following links.
fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    entries
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(kind) if kind.is_dir() => dir_size(&entry.path()),
            Ok(_) => entry.metadata().map(|m| m.len()).unwrap_or(0),
            Err(_) => 0,
        })
        .sum()
}

fn script(kind: &str, body: serde_json::Value) -> String {
    let mut message = body;
    message["type"] = json!(kind);
    format!("window.wf && window.wf.receive({message})")
}

/// Copy the carried NSIS installer out and run it silently into `dir`,
/// reporting progress as a fraction.
fn install(exe: &Path, payload: &Payload, dir: &Path, proxy: &EventLoopProxy<UserEvent>) -> Result<(), String> {
    let progress = |value: f64, label: &str| {
        let _ = proxy.send_event(UserEvent::Script(script("progress", json!({ "value": value, "label": label }))));
    };

    progress(0.0, "Unpacking");
    let temp = std::env::temp_dir().join(format!("WeaveForge-install-{}.exe", std::process::id()));
    {
        let mut from = File::open(exe).map_err(|e| format!("Could not read the installer: {e}"))?;
        from.seek(SeekFrom::Start(payload.offset)).map_err(|e| e.to_string())?;
        let mut to = File::create(&temp).map_err(|e| format!("Could not write to the temp folder: {e}"))?;
        let mut left = payload.len;
        let mut buf = vec![0u8; 1 << 20];
        while left > 0 {
            let take = left.min(buf.len() as u64) as usize;
            from.read_exact(&mut buf[..take]).map_err(|e| e.to_string())?;
            to.write_all(&buf[..take]).map_err(|e| e.to_string())?;
            left -= take as u64;
            progress(0.08 * (1.0 - left as f64 / payload.len as f64), "Unpacking");
        }
    }

    // `/D=` has to be last and unquoted, which is what NSIS parses; `raw_arg`
    // keeps Rust from quoting a path with a space in it.
    let mut child = Command::new(&temp)
        .arg("/S")
        .arg("/currentuser")
        .raw_arg(format!("/D={}", dir.display()))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Could not start the installer: {e}"))?;

    // NSIS says nothing while it runs silently, so the bar reads the folder.
    // An update first removes the old copy, so the count is from the smallest
    // the folder has been; a slow creep keeps the bar honest-looking when the
    // files are replaced in place and the size never moves.
    let started = Instant::now();
    let total = payload.meta.install_size.max(1) as f64;
    let mut floor = dir_size(dir);
    let mut shown = 0.08_f64;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        let now = dir_size(dir);
        floor = floor.min(now);
        let written = (now - floor) as f64 / (total - floor as f64).max(1.0);
        let creep = 0.9 * (1.0 - (-started.elapsed().as_secs_f64() / 25.0).exp());
        let target = 0.08 + 0.9 * written.clamp(0.0, 1.0).max(creep);
        shown = shown.max(target.min(0.97));
        progress(shown, "Installing");
        std::thread::sleep(Duration::from_millis(200));
    };
    let _ = std::fs::remove_file(&temp);

    if !status.success() {
        return Err(match status.code() {
            Some(2) => "Setup was cancelled.".into(),
            Some(code) => format!("The installer stopped with code {code}. Close WeaveForge if it is open, then try again."),
            None => "The installer stopped unexpectedly.".into(),
        });
    }
    if !dir.join(APP_EXE).exists() {
        return Err("The installer finished, but WeaveForge is not in the folder. Try another folder.".into());
    }
    progress(1.0, "Done");
    Ok(())
}

fn protocol(request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let (body, kind): (Cow<'static, [u8]>, &str) = match request.uri().path() {
        "/rubik.woff2" => (Cow::Borrowed(RUBIK), "font/woff2"),
        "/icon.png" => (Cow::Borrowed(ICON), "image/png"),
        _ => (Cow::Borrowed(INDEX_HTML.as_bytes()), "text/html; charset=utf-8"),
    };
    Response::builder().header(CONTENT_TYPE, kind).body(body).unwrap()
}

fn main() -> wry::Result<()> {
    let exe = std::env::current_exe().expect("current exe");
    let payload = read_payload(&exe);

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let window = WindowBuilder::new()
        .with_title("WeaveForge setup")
        .with_inner_size(LogicalSize::new(760.0, 480.0))
        .with_resizable(false)
        .with_maximizable(false)
        .with_decorations(false)
        .with_undecorated_shadow(true)
        .with_visible(false)
        .with_window_icon(Icon::from_resource(1, None).ok())
        .build(&event_loop)
        .expect("window");

    if let Some(monitor) = window.current_monitor() {
        let area = monitor.size();
        let size = window.outer_size();
        let at = monitor.position();
        window.set_outer_position(PhysicalPosition::new(
            at.x + (area.width as i32 - size.width as i32) / 2,
            at.y + (area.height as i32 - size.height as i32) / 2,
        ));
    }

    let ipc_proxy = proxy.clone();
    let webview = WebViewBuilder::new()
        .with_custom_protocol("wf".into(), |_id, request| protocol(request))
        .with_url("wf://localhost/")
        .with_background_color((30, 30, 46, 255))
        .with_hotkeys_zoom(false)
        .with_browser_accelerator_keys(false)
        .with_ipc_handler(move |request: Request<String>| {
            let _ = ipc_proxy.send_event(UserEvent::Ipc(request.body().clone()));
        })
        .build(&window)?;

    let mut busy = false;
    let mut done = false;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } if !busy => *control_flow = ControlFlow::Exit,
            Event::UserEvent(UserEvent::Script(code)) => {
                let _ = webview.evaluate_script(&code);
            }
            Event::UserEvent(UserEvent::Finished { ok }) => {
                busy = false;
                done = ok;
            }
            Event::UserEvent(UserEvent::Ipc(body)) => match serde_json::from_str::<Ipc>(&body) {
                Ok(Ipc::Ready) => {
                    let dir = default_dir();
                    let state = json!({
                        "version": payload.as_ref().map(|p| p.meta.version.clone()),
                        "dir": dir.display().to_string(),
                        "existing": dir.join(APP_EXE).exists(),
                        "hasPayload": payload.is_some(),
                    });
                    let _ = webview.evaluate_script(&script("init", state));
                    window.set_visible(true);
                }
                Ok(Ipc::Drag) => {
                    let _ = window.drag_window();
                }
                Ok(Ipc::Minimize) => window.set_minimized(true),
                Ok(Ipc::Close) if !busy => *control_flow = ControlFlow::Exit,
                Ok(Ipc::Close) => {}
                Ok(Ipc::Browse { dir }) => {
                    let start = PathBuf::from(&dir);
                    let start = start.parent().filter(|p| p.exists()).unwrap_or(&start).to_path_buf();
                    let picked = rfd::FileDialog::new()
                        .set_title("Choose where to install WeaveForge")
                        .set_directory(start)
                        .set_parent(&window)
                        .pick_folder();
                    if let Some(folder) = picked {
                        // A folder picked for the app gets the app's own folder
                        // inside it, as every installer does, unless it already is one.
                        let folder = if folder.file_name().is_some_and(|n| n.eq_ignore_ascii_case("WeaveForge")) {
                            folder
                        } else {
                            folder.join("WeaveForge")
                        };
                        let state = json!({
                            "dir": folder.display().to_string(),
                            "existing": folder.join(APP_EXE).exists(),
                        });
                        let _ = webview.evaluate_script(&script("dir", state));
                    }
                }
                Ok(Ipc::Install { dir }) if !busy && !done => {
                    let Some(payload) = payload.clone() else {
                        let _ = webview.evaluate_script(&script("error", json!({ "message": "This setup file is incomplete. Download it again." })));
                        return;
                    };
                    busy = true;
                    let proxy = proxy.clone();
                    let exe = exe.clone();
                    std::thread::spawn(move || {
                        let result = install(&exe, &payload, Path::new(&dir), &proxy);
                        let message = match &result {
                            Ok(()) => script("done", json!({})),
                            Err(message) => script("error", json!({ "message": message })),
                        };
                        let _ = proxy.send_event(UserEvent::Script(message));
                        let _ = proxy.send_event(UserEvent::Finished { ok: result.is_ok() });
                    });
                }
                Ok(Ipc::Install { .. }) => {}
                Ok(Ipc::Launch { dir }) => {
                    let _ = Command::new(Path::new(&dir).join(APP_EXE))
                        .current_dir(&dir)
                        .creation_flags(DETACHED_PROCESS)
                        .spawn();
                    *control_flow = ControlFlow::Exit;
                }
                Err(_) => {}
            },
            _ => {}
        }
    });
}
