/**
 * The 0.9.7 migration state of a workspace folder, as the page reads it.
 *
 * The kill switch lives here: the file backend is wired only when the shell
 * reports a verified migration. Every other answer — none, incomplete, a
 * shell that predates the member, a failed read — keeps the old database
 * backend exactly as it is today.
 */

export type Migrate097State = "none" | "verified" | "incomplete";

/** What the page can conclude; `unavailable` is any read that did not answer. */
export type Migrate097Resolved = Migrate097State | "unavailable";

/** The slice of the bridge this module reads. Optional: an old shell lacks it. */
export interface Migrate097Bridge {
  migrate097Status?(folder: string): Promise<{ state: unknown }>;
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
    const state = (await bridge.migrate097Status?.(folder))?.state;
    return state === "verified" || state === "incomplete" || state === "none" ? state : "unavailable";
  } catch {
    return "unavailable";
  }
}

/** The kill switch: only a verified migration wires the file backend. */
export function usesFileBackend(state: Migrate097Resolved): boolean {
  return state === "verified";
}
