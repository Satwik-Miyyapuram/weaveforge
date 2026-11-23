/**
 * The 0.9.7 "use without an account, local only" route on the desktop shell.
 *
 * The person picks a folder. A folder already on the files backend opens straight
 * away. Any other folder runs this device's export for that folder, and the
 * window reloads so the gate can show the upgrade screen if the run stops short.
 * The route never calls the local database: it only names the folder and reloads.
 */
import { LOCAL_MODE_IN_BUILD } from "@/backend/providers/local/local-identity";
import { migrate097Status, usesFileBackend, type Migrate097Bridge } from "./migrate-097";
import type { ExportRunner } from "./migrate-097-upgrade";

/**
 * Web keeps the local-only entry hidden until the OPFS browser wiring lands.
 * Flip this to true then.
 */
export const WEB_LOCAL_ONLY_ENTRY = false;

/**
 * Hidden everywhere while the build has no local mode: sign-in is the only way
 * past the login screen then, so the entry would reload straight back onto it.
 */
export function localOnlyEntryVisible(onDesktop: boolean): boolean {
  return LOCAL_MODE_IN_BUILD && (onDesktop || WEB_LOCAL_ONLY_ENTRY);
}

export type LocalOnlyOutcome = "reload" | "cancelled" | "unavailable";

/** The shell calls this route needs. */
export interface LocalOnlyBridge extends Migrate097Bridge {
  chooseVaultRoot(): Promise<{ path: string } | null>;
}

/**
 * `runExport` is the upgrade screen's exporter (`desktopRunExport`); null outside the shell.
 * A folder already on the files (verified, or a device with no old database) reloads without it.
 */
export async function enterLocalOnly(bridge: LocalOnlyBridge, runExport: ExportRunner | null): Promise<LocalOnlyOutcome> {
  const root = await bridge.chooseVaultRoot().catch(() => null);
  if (!root) return "cancelled";
  const state = await migrate097Status(bridge, root.path);
  if (usesFileBackend(state)) return "reload";
  // Only a folder this device has not exported (none, incomplete, unexported) may run the export.
  if (state === "unavailable" || state === "removing-other") return "unavailable";
  if (!runExport) return "unavailable";
  try {
    await runExport(root.path, () => {});
    return "reload";
  } catch {
    return "unavailable";
  }
}
