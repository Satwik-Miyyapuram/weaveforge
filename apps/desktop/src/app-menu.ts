import path from "node:path";
import { app, Menu, shell, type BrowserWindow, type MenuItem, type MenuItemConstructorOptions } from "electron";
import type { MenuGroupPayload, MenuItemPayload } from "./channels";

/**
 * The window's own menu.
 *
 * Electron installs a default menu when an app does not, and that default is
 * written for Electron rather than for this app: its Help entries point at
 * electronjs.org, and there is nothing in it for the parts of the shell a
 * reader actually has — the workspace folder, the update check, the docs. This
 * replaces it with a menu whose every entry does something here.
 *
 * The roles are Electron's own (`reload`, `copy`, `togglefullscreen`, …) rather
 * than hand-written accelerators, so the shortcuts are the ones the platform
 * already taught the reader, and the Edit entries keep working inside the page.
 */
export interface MenuActions {
  /** Ask the reader for a workspace folder. */
  chooseFolder: () => void | Promise<void>;
  /** The folder in use, or null when none has been chosen. */
  workspace: () => string | null;
  /** Show that folder in the OS file manager. */
  openFolder: () => void | Promise<void>;
  /** Look for a newer version now, and say what was found either way. */
  checkForUpdates: () => void | Promise<void>;
  /** Where the documentation lives. */
  docsUrl: string;
  /** Take the window to a route inside the app. */
  goTo: (route: string) => void;
  /** Open the page's search palette. */
  search: () => void;
}

/**
 * An entry that opens a route. Its id carries the route, so the in-page menu
 * bar can navigate with the app's own router instead of asking this process to
 * reload the page there.
 */
function go(label: string, route: string, actions: MenuActions, accelerator?: string): MenuItemConstructorOptions {
  return { id: `route:${route}`, label, accelerator, click: () => actions.goTo(route) };
}

function buildMenu(actions: MenuActions): MenuItemConstructorOptions[] {
  const mac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [];
  /*
   * The workspace, as the File menu says it.
   *
   * "Choose workspace folder…" is the right entry *before* one is chosen and a
   * misleading one afterwards: it reads as though nothing is connected, which is
   * what left a reader clicking it to find out where their files were going. So
   * once there is a folder, the menu names it, offers to open it, and asks to
   * *change* it — the same three things the Settings panel says in words.
   */
  const root = actions.workspace();
  const workspaceEntries: MenuItemConstructorOptions[] = root
    ? [
        // The folder's name, not its path: the path is what "Open" shows, and a
        // full Windows path does not fit a menu.
        { id: "info:workspace", label: `Workspace: ${path.basename(root) || root}`, enabled: false },
        { label: "Show in file explorer", click: () => void actions.openFolder() },
        { label: "Change workspace folder…", click: () => void actions.chooseFolder() },
        { type: "separator" },
      ]
    : [{ label: "Choose workspace folder…", click: () => void actions.chooseFolder() }, { type: "separator" }];

  if (mac) {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        go("Settings", "/settings", actions, "Cmd+,"),
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  template.push({
    label: "File",
    submenu: [
      ...workspaceEntries,
      ...(mac
        ? [{ role: "close" } as MenuItemConstructorOptions]
        : [
            go("Settings", "/settings", actions, "Ctrl+,"),
            { type: "separator" } as MenuItemConstructorOptions,
            { role: "quit", label: "Quit" } as MenuItemConstructorOptions,
          ]),
    ],
  });

  template.push({
    label: "Edit",
    submenu: [
      { role: "undo", label: "Undo" },
      { role: "redo", label: "Redo" },
      { type: "separator" },
      { role: "cut", label: "Cut", accelerator: "CommandOrControl+X" },
      { role: "copy", label: "Copy", accelerator: "CommandOrControl+C" },
      { role: "paste", label: "Paste", accelerator: "CommandOrControl+V" },
      { role: "selectAll", label: "Select all" },
    ],
  });

  template.push({
    // The sidebar's pages, in its order and with its names.
    label: "Go",
    submenu: [
      go("Home", "/dashboard", actions),
      {
        id: "page:search",
        label: "Search…",
        // The page owns Ctrl+K (it works in a browser too); this only shows it.
        accelerator: "CommandOrControl+K",
        registerAccelerator: false,
        click: () => actions.search(),
      },
      { type: "separator" },
      go("Papers", "/papers", actions),
      go("Notes", "/notes", actions),
      go("Editor", "/workspace", actions),
      go("Graph", "/graph", actions),
      go("Lists", "/lists", actions),
      go("Experiments", "/experiments", actions),
      { type: "separator" },
      go("Plan", "/plan", actions),
      go("Report", "/report", actions),
      go("Log", "/log", actions),
      go("Git", "/git", actions),
    ],
  });

  template.push({
    label: "View",
    submenu: [
      { role: "reload", label: "Reload" },
      { role: "resetZoom", label: "Actual size" },
      { role: "zoomIn", label: "Zoom in" },
      { role: "zoomOut", label: "Zoom out" },
      { type: "separator" },
      { role: "togglefullscreen", label: "Full screen" },
      { role: "toggleDevTools", label: "Developer tools" },
    ],
  });

  template.push({
    label: "Window",
    submenu: mac
      ? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
      : [
          // No shortcuts of their own here. Electron's defaults are Ctrl+M and
          // Ctrl+W, and Ctrl+W is the workspace's "close tab": pressed in the
          // editor it closed the whole app instead. Windows and Linux already
          // have their own keys for these (Win+Down, Alt+F4).
          { role: "minimize", label: "Minimize", accelerator: "", registerAccelerator: false },
          {
            id: "window:maximize",
            label: "Maximize",
            click: (_item, window) => {
              const target = window as BrowserWindow | undefined;
              if (!target) return;
              if (target.isMaximized()) target.unmaximize();
              else target.maximize();
            },
          },
          { type: "separator" },
          { role: "close", label: "Close window", accelerator: "", registerAccelerator: false },
        ],
  });

  template.push({
    role: "help",
    submenu: [
      { label: "Documentation", click: () => void shell.openExternal(actions.docsUrl) },
      { type: "separator" },
      { label: "Check for updates…", click: () => void actions.checkForUpdates() },
      { label: `Version ${app.getVersion()}`, enabled: false },
    ],
  });

  return template;
}

/**
 * Give every entry an id, so the in-page menu bar can name the one it wants.
 * Ids are positional (`m.2.4`) unless the entry has its own; they only have to
 * hold until the next `installMenu`, which tells the page to fetch again.
 */
function withIds(items: MenuItemConstructorOptions[], prefix: string): MenuItemConstructorOptions[] {
  return items.map((item, index) => {
    const id = item.id ?? `${prefix}.${index}`;
    const submenu = Array.isArray(item.submenu) ? withIds(item.submenu, id) : item.submenu;
    return { ...item, id, submenu };
  });
}

let current: Menu | null = null;

/** Build the menu and make it the application's. */
export function installMenu(actions: MenuActions): void {
  current = Menu.buildFromTemplate(withIds(buildMenu(actions), "m"));
  Menu.setApplicationMenu(current);
}

/** `CommandOrControl+Shift+I` as the platform writes it: `Ctrl+Shift+I`. */
function shortcutLabel(accelerator: string): string {
  const mac = process.platform === "darwin";
  return accelerator
    .replace(/CommandOrControl|CmdOrCtrl/g, mac ? "Cmd" : "Ctrl")
    .replace(/\bControl\b/g, "Ctrl")
    .replace(/\bPlus\b/g, "+");
}

function describe(item: MenuItem, window: BrowserWindow | null): MenuItemPayload {
  if (item.type === "separator") return { id: item.id, kind: "separator", label: "", accelerator: null, enabled: false };
  // A role's shortcut is not on the item until it is asked for; Electron keeps
  // that lookup on the prototype, undeclared in its typings.
  const roleDefault = (item as MenuItem & { getDefaultRoleAccelerator?: () => unknown }).getDefaultRoleAccelerator;
  const raw = item.accelerator || (item.registerAccelerator === false ? undefined : roleDefault?.call(item));
  const route = item.id.startsWith("route:") ? item.id.slice("route:".length) : undefined;
  const command = item.id.startsWith("page:") ? item.id.slice("page:".length) : undefined;
  const label = item.id === "window:maximize" && window?.isMaximized() ? "Restore" : item.label;
  const check = item.type === "checkbox" || item.type === "radio";
  return {
    id: item.id,
    kind: check ? "check" : "item",
    label,
    accelerator: raw ? shortcutLabel(String(raw)) : null,
    enabled: item.enabled,
    ...(check ? { checked: item.checked } : {}),
    ...(route ? { route } : {}),
    ...(command ? { command } : {}),
  };
}

/**
 * The menu as the page's own menu bar draws it: the top-level groups and their
 * entries, as plain data. Nothing here nests deeper than one level.
 */
export function menuModel(window: BrowserWindow | null): MenuGroupPayload[] {
  if (!current) return [];
  return current.items
    .filter((group) => group.visible && group.submenu)
    .map((group) => ({
      label: group.label,
      items: (group.submenu?.items ?? []).filter((item) => item.visible).map((item) => describe(item, window)),
    }));
}

/**
 * Run one entry, the way choosing it in the native menu would. Roles included:
 * a role item's `click` performs the role against the window it is handed.
 */
export function invokeMenuItem(id: unknown, window: BrowserWindow | null): boolean {
  if (typeof id !== "string" || !current || !window || window.isDestroyed()) return false;
  const item = current.getMenuItemById(id);
  if (!item || !item.enabled || item.type === "separator" || item.submenu) return false;
  item.click(undefined, window, window.webContents);
  return true;
}

/** Send the window to a route, whatever it is showing now. */
export function routeTo(window: BrowserWindow | null, base: string, route: string): void {
  if (!window || window.isDestroyed()) return;
  // The bundle is a static export: every route is a directory with an
  // `index.html` in it, and the trailing slash is what finds it.
  const path = route.startsWith("/") ? route : `/${route}`;
  // `base` is the app's URL, not its origin: a custom scheme has no origin
  // Chromium will name, so `new URL(...).origin` is the string "null".
  const url = new URL(`.${path.endsWith("/") ? path : `${path}/`}`, base).href;
  // Navigated from inside the page rather than with `loadURL`. A load driven
  // from this process starts a fresh document whose storage the app cannot see
  // — which logs an account-less copy back out on the way to a menu entry.
  //
  // The page's own router first, when it is listening (the title bar is): that
  // keeps the page, its state and its scroll instead of starting a new one.
  void window.webContents.executeJavaScript(
    `(()=>{const e=new CustomEvent(${JSON.stringify(PAGE_COMMAND_EVENT)},{cancelable:true,detail:{route:${JSON.stringify(path)}}});window.dispatchEvent(e);if(!e.defaultPrevented)window.location.assign(${JSON.stringify(url)})})()`,
  );
}

/** Kept in step with `desktop-title-bar.tsx`, which listens for it. */
const PAGE_COMMAND_EVENT = "weaveforge:menu-command";

/** Ask the page to do one of its own things (`search`). */
export function pageCommand(window: BrowserWindow | null, command: string): void {
  if (!window || window.isDestroyed()) return;
  void window.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent(${JSON.stringify(PAGE_COMMAND_EVENT)},{detail:{command:${JSON.stringify(command)}}}))`,
  );
}
