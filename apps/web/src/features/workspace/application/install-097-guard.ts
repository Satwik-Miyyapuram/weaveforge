import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";

/** Where the 0.9.7 release is downloaded from. */
export const INSTALL_097_URL = "https://github.com/Satwik-Miyyapuram/weaveforge/releases/tag/v0.9.7";

export interface Install097State {
  /** An old (pre-0.9.7) local database is on this computer. */
  legacyDbPresent: boolean;
  /** The folder has a verified 0.9.7 migration report. `null` means unknown: the check is missing or failed. */
  reportPresent: boolean | null;
}

/**
 * True when the user must install 0.9.7 before this build can open the workspace: an old
 * database is present and there is no verified 0.9.7 report. An unknown report counts as
 * missing (fail closed).
 */
export function install097Required(state: Install097State | null | undefined): boolean {
  return state?.legacyDbPresent === true && state.reportPresent !== true;
}

/**
 * Reads the bridge and decides whether to block. Only read calls are made; nothing is written.
 * No desktop bridge means a browser or Android runtime with no old database: open. In a desktop
 * shell every unknown answer blocks: a missing or throwing `legacyDbPresent`, and a missing or
 * throwing report check while the old database is present.
 */
export async function install097RequiredFrom(
  bridge: Partial<Pick<DesktopBridge, "legacyDbPresent" | "migrationReportPresent">> | null,
): Promise<boolean> {
  if (!bridge) return false;
  let legacyDbPresent: boolean | null;
  try {
    legacyDbPresent = typeof bridge.legacyDbPresent === "function" ? (await bridge.legacyDbPresent()) === true : null;
  } catch {
    legacyDbPresent = null;
  }
  if (legacyDbPresent === false) return false;
  if (legacyDbPresent === null) return true;
  let reportPresent: boolean | null;
  try {
    reportPresent = typeof bridge.migrationReportPresent === "function" ? await bridge.migrationReportPresent() : null;
  } catch {
    reportPresent = null;
  }
  return install097Required({ legacyDbPresent, reportPresent });
}

/** The gate text. Showing it does not touch the data. */
export const INSTALL_097_NOTICE = {
  title: "Install 0.9.7 first.",
  body: "Your data is safe. This version cannot open the older local database yet, so install WeaveForge 0.9.7 first to move your data across.",
} as const;
