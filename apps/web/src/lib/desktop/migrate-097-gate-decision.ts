import type { Migrate097Resolved } from "./migrate-097";

/**
 * Whether the window shows the upgrade screen. Only an incomplete migration in an
 * open folder does: a started move that did not verify. `none` is a folder with
 * nothing to move, `unavailable` is a read that did not answer, and neither may
 * block the workspace.
 */
export function shouldShowUpgrade(state: Migrate097Resolved, folder: string | null): boolean {
  return folder !== null && state === "incomplete";
}
