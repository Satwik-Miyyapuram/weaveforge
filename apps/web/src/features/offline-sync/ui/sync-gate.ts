import { desktop } from "@/lib/desktop/desktop-bridge";
import { migrate097Status, type Migrate097Resolved } from "@/lib/desktop/migrate-097";

/** Sync runs only in a folder whose 0.9.7 migration state is "none". */
export function syncMayRun(state: Migrate097Resolved): boolean {
  return state === "none";
}

/**
 * Whether sync may run in the folder this window has open. Outside the desktop
 * shell there is no folder migration to wait for, so the gate does not apply.
 */
export async function syncAllowedHere(): Promise<boolean> {
  const shell = desktop();
  if (!shell) return true;
  // A shell that cannot name its folder leaves the state unavailable, which keeps sync off.
  let folder: string | null = null;
  try {
    folder = (await shell.vaultRoot())?.path ?? null;
  } catch {
    folder = null;
  }
  return syncMayRun(await migrate097Status(shell, folder));
}
