/**
 * The 0.9.7 "use without an account, local only" route on the desktop shell.
 *
 * The person picks a folder. A verified folder opens straight away on the files
 * backend. Any other folder enters the migration run for that folder, and the
 * window reloads so the gate can show the upgrade screen if the run stops short.
 * The route never calls the local database: it only names the folder and reloads.
 */
import { migrate097Status, type Migrate097Bridge } from "./migrate-097";

export type LocalOnlyOutcome = "reload" | "cancelled" | "unavailable";

/** The shell calls this route needs. `migrate097Run` is absent on an old shell. */
export interface LocalOnlyBridge extends Migrate097Bridge {
  chooseVaultRoot(): Promise<{ path: string } | null>;
  migrate097Run?(folder: string): Promise<{ state: unknown }>;
}

export async function enterLocalOnly(bridge: LocalOnlyBridge): Promise<LocalOnlyOutcome> {
  const root = await bridge.chooseVaultRoot().catch(() => null);
  if (!root) return "cancelled";
  if ((await migrate097Status(bridge, root.path)) === "verified") return "reload";
  if (!bridge.migrate097Run) return "unavailable";
  try {
    await bridge.migrate097Run(root.path);
    return "reload";
  } catch {
    return "unavailable";
  }
}
