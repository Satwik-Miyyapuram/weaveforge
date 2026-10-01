import { nativeTheme, type BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import path from "node:path";

const PERSONALIZE = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";

/** Taskbar follows the Windows *system* theme, which Electron 33 cannot see apart from the app theme. */
function systemUsesLightTheme(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("reg", ["query", PERSONALIZE, "/v", "SystemUsesLightTheme"], { windowsHide: true }, (err, out) => {
      // Missing key means pre-1903 Windows, whose taskbar is dark.
      resolve(!err && /SystemUsesLightTheme\s+REG_DWORD\s+0x1\b/.test(out));
    });
  });
}

/** Windows only: cream mark on a dark taskbar; the outlined default reads on either. */
export function followTaskbarTheme(window: BrowserWindow): void {
  if (process.platform !== "win32") return;
  const apply = async () => {
    const light = await systemUsesLightTheme();
    if (window.isDestroyed()) return;
    window.setIcon(path.join(__dirname, light ? "icon.png" : "icon-dark.png"));
  };
  void apply();
  // `updated` tracks the app theme; focus catches a taskbar-only switch.
  nativeTheme.on("updated", apply);
  window.on("focus", apply);
  window.on("closed", () => nativeTheme.off("updated", apply));
}
