import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";

/** Where the 0.9.7 release is downloaded from. */
export const INSTALL_097_URL = "https://github.com/Satwik-Miyyapuram/weaveforge/releases/tag/v0.9.7";

/** The verdict of the install check. Only `open` lets the app mount. */
export type Install097Verdict =
  /** Nothing to move: no bridge, or no old database. */
  | { kind: "open" }
  /**
   * An old database is here but the install gate does not pass: no verified 0.9.7 report in the
   * folder, or the 0.9.7 secrets move has not finished. Ask for the export folder, or open 0.9.7 once more.
   */
  | { kind: "unverified"; action?: "web-export" }
  /** The check itself failed or is unavailable. `code` is a stable error code for the screen. */
  | { kind: "unknown"; code: string };

type Install097Bridge = Partial<Pick<DesktopBridge, "legacyDbPresent" | "migrationReportVerified">>;

/**
 * The web reader's two answers. `hasLegacyRows`: the account still has rows in the old personal
 * server tables. `ownRunVerified`: a verified 0.9.7 export run exists for this account (the
 * `profiles.exported_097_at` mark). The reader is infrastructure/install-097-web-port.
 */
export interface Install097OldUserPort {
  hasLegacyRows(): Promise<boolean>;
  ownRunVerified(): Promise<boolean>;
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
  if (typeof bridge.legacyDbPresent !== "function") return oldUser ? webCheck(oldUser) : { kind: "open" };
  let legacy: unknown;
  try {
    legacy = await bridge.legacyDbPresent();
  } catch {
    return oldUser ? webCheck(oldUser) : { kind: "open" };
  }
  if (typeof legacy !== "boolean") return oldUser ? webCheck(oldUser) : { kind: "open" };
  // No local DB: a signed-in account can still be an old user with server rows (desktop has no local DB).
  if (!legacy) return oldUser ? webCheck(oldUser) : { kind: "open" };
  if (folder === null) return { kind: "unverified" };
  if (typeof bridge.migrationReportVerified !== "function") return { kind: "open" };
  let verified: unknown;
  try {
    verified = await bridge.migrationReportVerified(folder);
  } catch {
    return { kind: "open" };
  }
  if (typeof verified !== "boolean") return { kind: "open" };
  return verified ? { kind: "open" } : { kind: "unverified" };
}

/**
 * Web: old user = legacy rows present AND no verified export run. A new account (no rows) sees
 * nothing. A port that throws or answers a non-boolean opens too (fail open): only confirmed old data gates.
 */
async function webCheck(port: Install097OldUserPort): Promise<Install097Verdict> {
  let rows: unknown;
  try {
    rows = await port.hasLegacyRows();
  } catch {
    return { kind: "open" };
  }
  if (typeof rows !== "boolean") return { kind: "open" };
  if (!rows) return { kind: "open" };
  let exported: unknown;
  try {
    exported = await port.ownRunVerified();
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

/** The web gate text for an account with legacy rows and no verified export. Your data is safe. */
export const INSTALL_097_WEB_NOTICE = {
  title: "Export from 0.9.7 first.",
  body: "Open this account once in WeaveForge desktop 0.9.7, export, then come back. Your data is safe.",
} as const;
