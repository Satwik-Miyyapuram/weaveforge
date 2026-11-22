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

/**
 * Whether the window shows a Retry banner: any answer other than none, verified,
 * removed or this device's own removal. The window stays read-only until a retry
 * reads a settled state, so the banner must always offer a click.
 */
export function shouldShowRetry(state: Migrate097Resolved, folder: string | null): boolean {
  return folder !== null && (state === "unavailable" || state === "removing-other" || state === "incomplete");
}

/** Whether the window offers "Finish removing": a removal this device started and did not finish. */
export function shouldShowFinishRemoving(state: Migrate097Resolved, folder: string | null): boolean {
  return folder !== null && state === "removing";
}
