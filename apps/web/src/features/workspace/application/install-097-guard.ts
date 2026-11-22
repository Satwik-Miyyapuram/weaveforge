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
  | { kind: "unverified" }
  /** The check itself failed or is unavailable. `code` is a stable error code for the screen. */
  | { kind: "unknown"; code: string };

type Install097Bridge = Partial<Pick<DesktopBridge, "legacyDbPresent" | "migrationReportVerified">>;

/**
 * Reads the bridge and decides whether to block. Only read calls are made; nothing is written.
 * No desktop bridge means a browser or Android runtime with no old database: open. In a desktop
 * shell every unknown answer fails closed: a missing, throwing or non-boolean answer from either
 * check is `unknown`, and the report is only asked about when the old database is present.
 * `folder` is the folder whose 0.9.7 report is checked, or null when none is known yet.
 * `migrationReportVerified` answers the install gate: the report is verified AND this device's
 * 0.9.7 secrets move is marked done (`install_gate_passes` in the shell). A false answer blocks open.
 */
export async function install097Check(bridge: Install097Bridge | null, folder: string | null): Promise<Install097Verdict> {
  if (!bridge) return { kind: "open" };
  if (typeof bridge.legacyDbPresent !== "function") return { kind: "unknown", code: "LEGACY_CHECK_UNAVAILABLE" };
  let legacy: unknown;
  try {
    legacy = await bridge.legacyDbPresent();
  } catch {
    return { kind: "unknown", code: "LEGACY_CHECK_FAILED" };
  }
  if (typeof legacy !== "boolean") return { kind: "unknown", code: "LEGACY_CHECK_FAILED" };
  if (!legacy) return { kind: "open" };
  if (folder === null) return { kind: "unverified" };
  if (typeof bridge.migrationReportVerified !== "function") return { kind: "unknown", code: "REPORT_CHECK_UNAVAILABLE" };
  let verified: unknown;
  try {
    verified = await bridge.migrationReportVerified(folder);
  } catch {
    return { kind: "unknown", code: "REPORT_CHECK_FAILED" };
  }
  if (typeof verified !== "boolean") return { kind: "unknown", code: "REPORT_CHECK_FAILED" };
  return verified ? { kind: "open" } : { kind: "unverified" };
}

/** The gate text. Showing it does not touch the data. */
export const INSTALL_097_NOTICE = {
  title: "Open 0.9.7 once more.",
  body: "Install or open WeaveForge 0.9.7 so its move finishes, then come back.",
} as const;
