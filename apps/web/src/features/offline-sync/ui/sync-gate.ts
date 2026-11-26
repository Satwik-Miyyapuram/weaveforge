import { desktop } from "@/lib/desktop/desktop-bridge";
import { migrate097Status, type Migrate097Resolved } from "@/lib/desktop/migrate-097";

/** Sync runs only in a folder whose 0.9.7 migration state is "none". */
export function syncMayRun(state: Migrate097Resolved): boolean {
  return state === "none";
}

/**
 * Whether sync may run in the folder this window has open. Outside the desktop
 * shell there is no folder migration to wait for, so the gate does not apply.
 * Assumption: only the desktop shell has a folder migration; the web build never
 * reaches the "unavailable" answer, so the fail-closed branch is shell-only.
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

/**
 * Runs one sync cycle only while `allowed()` says so, checked on every cycle
 * (the folder can migrate while the loop runs). Resolves true when the cycle ran.
 */
export async function runCycleIfAllowed(allowed: () => Promise<boolean>, cycle: () => Promise<void>): Promise<boolean> {
  if (!(await allowed())) return false;
  await cycle();
  return true;
}
