/**
 * The 0.9.7 migration state of a workspace folder, as the page reads it.
 *
 * The kill switch lives here: the file backend is wired only when the shell
 * reports a verified migration. Every other answer — none, incomplete, a
 * shell that predates the member, a failed read — keeps the old database
 * backend exactly as it is today.
 */

export type Migrate097State = "none" | "verified" | "incomplete" | "removing" | "removed";

/**
 * What the page can conclude. `unavailable` is any read that did not answer;
 * `removing-other` is a removal another device started, so this device stays fail-closed;
 * `unexported` is a folder another device removed while this device never exported its own data.
 */
export type Migrate097Resolved = Migrate097State | "unavailable" | "removing-other" | "unexported";

/** The slice of the bridge this module reads. Optional: an old shell lacks it. */
export interface Migrate097Bridge {
  migrate097Status?(folder: string): Promise<{
    state: unknown;
    /** The device that started a removal, when one is running. */
    removingDeviceId?: unknown;
    /** This device's id, so a removal can be told apart from another device's. */
    deviceId?: unknown;
    /** True when this device's own export verified (EXPORT-2 adds it; missing means false). */
    ownRunVerified?: unknown;
  }>;
}

/**
 * Asks the shell for the folder's migration state.
 *
 * Anything other than the three known states is `unavailable`, and a status that
 * takes longer than 3 s is `unavailable` too, so a garbled or slow report can never
 * read as verified or as a genuine none. A missing bridge,
 * a missing folder, or a throwing call is `unavailable`.
 */
export const MIGRATE_097_STATUS_TIMEOUT_MS = 3_000;

export async function migrate097Status(
  bridge: Migrate097Bridge | null | undefined,
  folder: string | null,
): Promise<Migrate097Resolved> {
  if (!bridge || typeof bridge.migrate097Status !== "function" || !folder) return "unavailable";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<Migrate097Resolved>((resolve) => {
    timer = setTimeout(() => resolve("unavailable"), MIGRATE_097_STATUS_TIMEOUT_MS);
  });
  try {
    return await Promise.race([read(bridge, folder), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

async function read(bridge: Migrate097Bridge, folder: string): Promise<Migrate097Resolved> {
  try {
    const report = await bridge.migrate097Status?.(folder);
    const state = report?.state;
    if (state === "removing") {
      // A removal runs on one device only; any other device (or an unknown one) stays fail-closed.
      const own = typeof report?.deviceId === "string" && report.removingDeviceId === report.deviceId;
      return own ? "removing" : "removing-other";
    }
    if (state === "removed") {
      // A removal is folder-wide. Only this device's own verified export, or its own removal, may wire files.
      const ownRun = report?.ownRunVerified === true;
      const remover = typeof report?.deviceId === "string" && report.removingDeviceId === report.deviceId;
      return ownRun || remover ? "removed" : "unexported";
    }
    if (state === "verified") {
      // Files wire only on a device that verified its own export; another device's verified report is "unexported" here.
      return report?.ownRunVerified === true ? "verified" : "unexported";
    }
    return state === "incomplete" || state === "none" ? state : "unavailable";
  } catch {
    return "unavailable";
  }
}

/**
 * The kill switch: a verified migration wires the file backend, and so does a
 * finished removal (the old database is gone, so it would read empty) and a
 * removal this device is running.
 */
export function usesFileBackend(state: Migrate097Resolved): boolean {
  return state === "verified" || state === "removed" || state === "removing";
}
