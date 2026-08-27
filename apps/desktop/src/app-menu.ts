import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from "electron";

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
  /** Look for a newer version now, and say what was found either way. */
  checkForUpdates: () => void | Promise<void>;
  /** Where the documentation lives. */
  docsUrl: string;
  /** Take the window to a route inside the app. */
  goTo: (route: string) => void;
}

export function buildMenu(actions: MenuActions): MenuItemConstructorOptions[] {
  const mac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [];

  if (mac) {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Settings", accelerator: "Cmd+,", click: () => actions.goTo("/settings") },
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
      { label: "Choose workspace folder…", click: () => void actions.chooseFolder() },
      { type: "separator" },
      ...(mac
        ? [{ role: "close" } as MenuItemConstructorOptions]
        : [
            { label: "Settings", accelerator: "Ctrl+,", click: () => actions.goTo("/settings") } as MenuItemConstructorOptions,
            { type: "separator" } as MenuItemConstructorOptions,
            { role: "quit" } as MenuItemConstructorOptions,
          ]),
    ],
  });

  template.push({
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  });

  template.push({
    label: "View",
    submenu: [
      { label: "Home", click: () => actions.goTo("/dashboard") },
      { label: "Library", click: () => actions.goTo("/papers") },
      { label: "Notes", click: () => actions.goTo("/notes") },
      { type: "separator" },
      { role: "reload" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
      { role: "toggleDevTools" },
    ],
  });

  template.push({
    label: "Window",
    submenu: mac
      ? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
      : [{ role: "minimize" }, { role: "close" }],
  });

  template.push({
    role: "help",
    submenu: [
      { label: "Documentation", click: () => void shell.openExternal(actions.docsUrl) },
      { label: "Settings", click: () => actions.goTo("/settings") },
      { type: "separator" },
      { label: "Check for updates…", click: () => void actions.checkForUpdates() },
      { label: `Version ${app.getVersion()}`, enabled: false },
    ],
  });

  return template;
}

/** Build the menu and make it the application's. */
export function installMenu(actions: MenuActions): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenu(actions)));
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
  void window.webContents.executeJavaScript(`window.location.assign(${JSON.stringify(url)})`);
}
