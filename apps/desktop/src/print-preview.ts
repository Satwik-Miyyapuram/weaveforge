/**
 * The print preview: a window of the app's own around one rendered page.
 *
 * Electron has no print preview — `window.print()` in the page goes straight
 * to the system dialog, and with the preview switch off (see `main.ts`) there
 * is nothing to see before the paper. So the page hands its picture here and
 * a small window shows it at page size, with the print button on it; that
 * button calls `print()` from inside the window, where the system dialog
 * offers the printers and "print to PDF" like any other document.
 *
 * The window loads a page of its own — no preload, no Node, no access to the
 * app — and the picture is handed to it after load rather than baked into the
 * URL, which Chromium caps at two megabytes.
 */

import { BrowserWindow } from "electron";
import { CHANNELS, type IpcResult } from "./channels";
import type { IpcSurface } from "./ipc-guard";

/** A PNG data URL and nothing else: what the page may hand over. */
const PNG_DATA_URL = "data:image/png;base64,";

/** Larger than any page export; a refusal rather than a window that stalls. */
export const PRINT_PREVIEW_MAX_BYTES = 64 * 1024 * 1024;

/** What the preview's door needs from the shell. */
export interface PrintPreviewDeps {
  ipc: IpcSurface;
  /** The window a preview belongs to; null when none is up. */
  parent(): BrowserWindow | null;
}

/**
 * Whether a string is a picture this window will show: the PNG prefix, base64
 * after it, and a size that fits.
 */
export function acceptablePrintPicture(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!value.startsWith(PNG_DATA_URL)) return false;
  if (value.length > PRINT_PREVIEW_MAX_BYTES) return false;
  return /^[A-Za-z0-9+/]*={0,2}$/.test(value.slice(PNG_DATA_URL.length));
}

/** A title fit for a window: text only, one line, bounded. */
export function printPreviewTitle(value: unknown): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text ? text.slice(0, 200) : "Print";
}

/**
 * The preview page. Printed, only the picture remains, one page tall; on
 * screen, a toolbar above it and the page scaled to fit the window.
 */
export function printPreviewHtml(title: string): string {
  const safe = title.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${safe}</title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; height: 100%; }
  body { display: flex; flex-direction: column; font: 14px system-ui, sans-serif; background: #3a3a40; color: #eee; }
  .bar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: #1e1e22; border-bottom: 1px solid #000; }
  .bar h1 { font-size: 14px; font-weight: 500; margin: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar button { font: inherit; padding: 6px 18px; border-radius: 6px; border: 1px solid #777; background: #2c2c32; color: #fff; cursor: pointer; }
  .bar button.print { background: #3b6fd6; border-color: #3b6fd6; }
  .bar button:hover { filter: brightness(1.15); }
  .sheet { flex: 1; overflow: auto; display: flex; align-items: flex-start; justify-content: center; padding: 24px; }
  img { display: block; max-width: 100%; height: auto; background: #fff; box-shadow: 0 8px 32px rgba(0,0,0,.5); }
  @page { margin: 0; }
  @media print {
    body { background: #fff; display: block; }
    .bar { display: none; }
    .sheet { padding: 0; display: block; overflow: visible; }
    img { width: 100%; height: 100vh; object-fit: contain; box-shadow: none; page-break-after: avoid; }
  }
</style>
</head>
<body>
  <div class="bar">
    <h1>${safe}</h1>
    <button type="button" class="close" onclick="window.close()">Close</button>
    <button type="button" class="print" onclick="window.print()">Print…</button>
  </div>
  <div class="sheet"><img id="page" alt=""></div>
</body>
</html>`;
}

/**
 * Register the door, and open one window per call. A second print while a
 * preview is up gets its own window: two pages side by side is a fair thing
 * to want.
 */
export function registerPrintPreview(deps: PrintPreviewDeps): void {
  deps.ipc.handle(
    CHANNELS.printPreview,
    async (_event, picture: unknown, title: unknown): Promise<IpcResult<null>> => {
      if (!acceptablePrintPicture(picture)) {
        return { ok: false, message: "Print preview needs a PNG picture of the page." };
      }
      try {
        await openPrintPreview(deps.parent(), picture, printPreviewTitle(title));
        return { ok: true, value: null };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    },
  );
}

async function openPrintPreview(
  parent: BrowserWindow | null,
  picture: string,
  title: string,
): Promise<void> {
  const window = new BrowserWindow({
    width: 900,
    height: 1000,
    minWidth: 480,
    minHeight: 400,
    title,
    backgroundColor: "#3a3a40",
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });
  window.setMenuBarVisibility(false);
  // A page of ours with a picture in it; nothing it could open is wanted.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(printPreviewHtml(title))}`,
  );
  // Handed over after load: the picture can be megabytes, more than a URL holds.
  await window.webContents.executeJavaScript(
    `document.getElementById("page").src = ${JSON.stringify(picture)}; void 0;`,
  );
}
