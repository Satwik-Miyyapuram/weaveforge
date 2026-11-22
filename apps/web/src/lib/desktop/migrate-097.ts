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
 * Anything other than the three known states becomes `none` when the shell
 * answered, so a garbled report can never read as verified. A missing bridge,
 * a missing folder, or a throwing call is `unavailable`.
 */
export async function migrate097Status(
  bridge: Migrate097Bridge | null | undefined,
  folder: string | null,
): Promise<Migrate097Resolved> {
  if (!bridge || typeof bridge.migrate097Status !== "function" || !folder) return "unavailable";
  try {
    const reply = await bridge.migrate097Status(folder);
    const state = reply?.state;
    return state === "verified" || state === "incomplete" ? state : "none";
  } catch {
    return "unavailable";
  }
}

/** The kill switch: only a verified migration wires the file backend. */
export function usesFileBackend(state: Migrate097Resolved): boolean {
  return state === "verified";
}
