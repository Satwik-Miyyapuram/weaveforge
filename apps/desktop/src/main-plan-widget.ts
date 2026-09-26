/**
 * The plan widget: the next deadlines, on the desktop, under every window.
 *
 * A small frameless window that the shell owns and keeps up to date from the
 * local database, placed the way Rainmeter places a skin set to "On desktop"
 * (see `pinScript`). It is not a Windows widget-board card: those live in a
 * side panel, and the point of this one is that it is on the wallpaper.
 *
 * The data never leaves the machine. The widget reads the same local database
 * the app does, in this process, so it works offline and needs no link or
 * token; the calendar feed is the way to get deadlines onto other devices.
 *
 * While it is on, closing the app's window leaves the process running for the
 * widget's sake, and it starts with Windows — without the app's window — so the
 * wallpaper has its deadlines after a restart.
 */
import { app, BrowserWindow, ipcMain, screen, type IpcMainEvent } from "electron";
import { spawn } from "node:child_process";
import path from "node:path";
import { CHANNELS, type PlanWidgetStatePayload } from "./channels";
import type { IpcSurface } from "./ipc-guard";
import type { LocalDbHost } from "./local-db-host";
import type { PreferenceStore } from "./preference-store";
import {
  hwndFromHandle,
  parseBounds,
  pinScript,
  placeWidget,
  PLAN_WIDGET_SIZE,
  PLAN_WIDGET_SQL,
  widgetDataFromRows,
  type PlanWidgetRow,
} from "./plan-widget";

/** The argument the login item starts the app with: widget only, no window. */
export const WIDGET_ONLY_ARG = "--plan-widget";

/** How often the widget re-reads the plan. The query is one small select. */
const REFRESH_MS = 60_000;

const SUPPORTED = process.platform === "win32";

export interface MainPlanWidgetDeps {
  ipc: IpcSurface;
  localDb: LocalDbHost;
  preferenceStore: () => PreferenceStore;
  /** Bring the app's window up, making it if it was closed. */
  showMainWindow: (route?: string) => void;
}

export interface MainPlanWidget {
  /** Put the widget back if it was on when the app last ran. */
  resume(): Promise<boolean>;
  /** Whether the widget window is up. */
  isOpen(): boolean;
  /** Re-read the plan now, if the widget is up. */
  refresh(): void;
}

export function registerMainPlanWidget(deps: MainPlanWidgetDeps): MainPlanWidget {
  let win: BrowserWindow | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Widget windows the shell closed itself, and whether the app is quitting:
   * a close that is neither was done to the widget, not by it.
   */
  const dismissed = new WeakSet<BrowserWindow>();
  let quitting = false;
  app.on("before-quit", () => {
    quitting = true;
  });

  async function refresh(): Promise<void> {
    const target = win;
    if (!target || target.isDestroyed()) return;
    const result = await deps.localDb.query(PLAN_WIDGET_SQL, []);
    if (!result.ok || target.isDestroyed()) return;
    target.webContents.send(CHANNELS.planWidgetData, widgetDataFromRows(result.value as PlanWidgetRow[], new Date()));
  }

  /**
   * Put the window on the desktop. A helper process, because the call is two
   * lines of Win32 and a native module would be a build toolchain for them.
   * A failure leaves an ordinary bottom-most window, which is still usable.
   */
  function pin(target: BrowserWindow): void {
    if (!SUPPORTED || target.isDestroyed()) return;
    const hwnd = hwndFromHandle(target.getNativeWindowHandle());
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "-"], {
      windowsHide: true,
      stdio: ["pipe", "ignore", "pipe"],
    });
    let errors = "";
    child.stderr.on("data", (chunk: Buffer) => (errors += chunk.toString()));
    child.on("error", (cause) => console.warn("[plan-widget] could not start the desktop helper:", cause.message));
    child.on("exit", (code) => {
      if (code !== 0) console.warn(`[plan-widget] desktop placement failed (${code}): ${errors.trim().slice(0, 300)}`);
    });
    child.stdin.end(pinScript(hwnd));
  }

  function saveBounds(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      const [x = 0, y = 0] = win.getPosition();
      void deps.preferenceStore().write("plan-widget-bounds", JSON.stringify({ x, y }));
    }, 500);
  }

  async function open(): Promise<void> {
    if (win && !win.isDestroyed()) return;
    const saved = await deps.preferenceStore().read("plan-widget-bounds");
    const at = placeWidget(
      parseBounds(saved.ok ? saved.value : null),
      screen.getAllDisplays().map((d) => d.workArea),
    );
    const target = new BrowserWindow({
      ...at,
      ...PLAN_WIDGET_SIZE,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      hasShadow: false,
      skipTaskbar: true,
      // Never takes focus: clicking it does not pull it over the window being
      // worked in, and it is not in Alt+Tab.
      focusable: false,
      show: false,
      title: "WeaveForge deadlines",
      backgroundColor: "#00000000",
      webPreferences: {
        preload: path.join(__dirname, "plan-widget-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        // A picture on the wallpaper: it should not keep a core awake when
        // nothing is looking at it, and a timer in main drives it anyway.
        backgroundThrottling: true,
      },
    });
    win = target;
    target.on("closed", () => {
      if (win === target) win = null;
      if (timer) clearInterval(timer);
      timer = null;
      // An owned window goes when its owner does, so an Explorer restart takes
      // the widget with the old desktop. Come back once the new one is up.
      if (!dismissed.has(target) && !quitting) setTimeout(() => void resume(), 4_000);
    });
    target.on("moved", saveBounds);
    // The page is a local file with nothing to link to; nothing leaves it.
    target.webContents.on("will-navigate", (event) => event.preventDefault());
    target.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    target.webContents.once("did-finish-load", () => {
      void refresh();
      target.showInactive();
      pin(target);
    });
    await target.loadFile(path.join(__dirname, "plan-widget.html"));
    timer = setInterval(() => void refresh(), REFRESH_MS);
  }

  function close(): void {
    if (win && !win.isDestroyed()) {
      dismissed.add(win);
      win.close();
    }
    win = null;
  }

  /** Start with Windows, widget only, while the widget is on. Packaged builds only. */
  function startWithWindows(on: boolean): void {
    if (!SUPPORTED || !app.isPackaged) return;
    app.setLoginItemSettings({ openAtLogin: on, args: [WIDGET_ONLY_ARG] });
  }

  async function setEnabled(on: boolean): Promise<void> {
    await deps.preferenceStore().write("plan-widget", on);
    startWithWindows(on);
    if (on) await open();
    else close();
  }

  async function state(): Promise<PlanWidgetStatePayload> {
    const enabled = await deps.preferenceStore().read("plan-widget");
    return { supported: SUPPORTED, enabled: SUPPORTED && enabled.ok && enabled.value === true };
  }

  deps.ipc.handle(CHANNELS.planWidgetState, async () => ({ ok: true, value: await state() }));
  deps.ipc.handle(CHANNELS.planWidgetSet, async (_event, on: unknown) => {
    if (!SUPPORTED) return { ok: false, message: "The desktop widget is only on Windows for now." };
    await setEnabled(on === true);
    return { ok: true, value: await state() };
  });

  /**
   * The widget's own buttons. Not on the guarded surface — that one answers
   * the app's origin, and the widget is a local file — so each is checked
   * against the one window allowed to send it instead.
   */
  const fromWidget = (event: IpcMainEvent) => !!win && !win.isDestroyed() && event.sender === win.webContents;
  ipcMain.on(CHANNELS.planWidgetOpen, (event) => {
    if (fromWidget(event)) deps.showMainWindow("/plan");
  });
  ipcMain.on(CHANNELS.planWidgetHide, (event) => {
    if (fromWidget(event)) void setEnabled(false);
  });

  // A monitor unplugged or a scale changed can leave the widget off-screen;
  // put it back somewhere visible.
  const replace = () => {
    if (!win || win.isDestroyed()) return;
    const [x = 0, y = 0] = win.getPosition();
    const at = placeWidget({ x, y }, screen.getAllDisplays().map((d) => d.workArea));
    if (at.x !== x || at.y !== y) win.setPosition(at.x, at.y);
  };
  app.whenReady().then(() => {
    screen.on("display-removed", replace);
    screen.on("display-metrics-changed", replace);
  }, () => undefined);

  async function resume(): Promise<boolean> {
    const current = await state();
    if (!current.enabled) return false;
    // Re-stated on every launch, so an install moved to another folder keeps
    // a login item that points at the right executable.
    startWithWindows(true);
    await open();
    return true;
  }

  return {
    resume,
    isOpen: () => !!win && !win.isDestroyed(),
    refresh: () => void refresh(),
  };
}
