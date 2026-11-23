import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";

/** Where the 0.9.7 release is downloaded from. */
export const INSTALL_097_URL = "https://github.com/Satwik-Miyyapuram/weaveforge/releases/tag/v0.9.7";

/** The verdict of the install check. Only `open` lets the app mount. */
export type Install097Verdict =
  /**
   * Nothing blocks. `verified` is true only when the shell confirmed this folder's 0.9.7 report
   * (and secrets move); a fail-open answer (no bridge, no old database, a check that threw or
   * answered oddly) leaves it unset, so the folder is never kept on its say-so.
   */
  | { kind: "open"; verified?: true }
  /**
   * An old database is here but the install gate does not pass: no verified 0.9.7 report in the
   * folder, or the 0.9.7 secrets move has not finished. Ask for the export folder, or open 0.9.7 once more.
   */
  | { kind: "unverified"; action?: "web-export" }
  /** The check itself failed or is unavailable. `code` is a stable error code for the screen. */
  | { kind: "unknown"; code: string };

type Install097Bridge = Partial<Pick<DesktopBridge, "legacyDbPresent" | "migrationReportVerified">>;

/**
 * The per-device answers for a browser or Android WebView, read from this device's storage only
 * (no account, no server). `oldDataHere`: 0.9.7 started moving data in this browser.
 * `exportedHere`: that move finished here (this device's own verified report or the 0.9.7 flag).
 * The reader is infrastructure/install-097-browser-port.
 */
export interface Install097OldUserPort {
  oldDataHere(): Promise<boolean>;
  exportedHere(): Promise<boolean>;
}

/**
 * Reads the bridge and decides whether to block. Only read calls are made; nothing is written.
 * No desktop bridge means a browser or Android runtime with no old database: open. In a desktop
 * shell every unavailable, throwing or non-boolean answer fails open: only confirmed old data
 * gates, and the report is only asked about when the old database is present.
 * `folder` is the folder whose 0.9.7 report is checked, or null when none is known yet.
 * `migrationReportVerified` answers the install gate: the report is verified AND this device's
 * 0.9.7 secrets move is marked done (`install_gate_passes` in the shell). A false answer blocks open.
 */
export async function install097Check(
  bridge: Install097Bridge | null,
  folder: string | null,
  oldUser?: Install097OldUserPort,
): Promise<Install097Verdict> {
  if (!bridge) return oldUser ? webCheck(oldUser) : { kind: "open" };
  // Fail open: a check that is unavailable, throws or answers oddly cannot confirm old data, so it never gates.
  if (typeof bridge.legacyDbPresent !== "function") return { kind: "open" };
  let legacy: unknown;
  try {
    legacy = await bridge.legacyDbPresent();
  } catch {
    return { kind: "open" };
  }
  if (typeof legacy !== "boolean") return { kind: "open" };
  // No old database on this computer: nothing here to move (the check is per device).
  if (!legacy) return { kind: "open" };
  if (folder === null) return { kind: "unverified" };
  if (typeof bridge.migrationReportVerified !== "function") return { kind: "open" };
  let verified: unknown;
  try {
    verified = await bridge.migrationReportVerified(folder);
  } catch {
    return { kind: "open" };
  }
  if (typeof verified !== "boolean") return { kind: "open" };
  return verified ? { kind: "open", verified: true } : { kind: "unverified" };
}

/**
 * Browser: gate = old data in this browser AND no export finished here. A browser with no old
 * data sees nothing. A port that throws or answers a non-boolean opens (fail open): only
 * confirmed old data gates.
 */
async function webCheck(port: Install097OldUserPort): Promise<Install097Verdict> {
  let here: unknown;
  try {
    here = await port.oldDataHere();
  } catch {
    return { kind: "open" };
  }
  if (typeof here !== "boolean") return { kind: "open" };
  if (!here) return { kind: "open" };
  let exported: unknown;
  try {
    exported = await port.exportedHere();
  } catch {
    return { kind: "open" };
  }
  if (typeof exported !== "boolean") return { kind: "open" };
  return exported ? { kind: "open" } : { kind: "unverified", action: "web-export" };
}

/** The gate text. Showing it does not touch the data. */
export const INSTALL_097_NOTICE = {
  title: "Open 0.9.7 once more.",
  body: "Install or open WeaveForge 0.9.7 so its move finishes, then come back.",
} as const;

/** The browser gate text: 0.9.7 started moving data in this browser and the move did not finish here. */
export const INSTALL_097_WEB_NOTICE = {
  title: "Install 0.9.7 first.",
  body: "This browser started moving your data in WeaveForge 0.9.7 and the move did not finish. Install WeaveForge desktop 0.9.7, sign in and export there. Your data is safe.",
} as const;
