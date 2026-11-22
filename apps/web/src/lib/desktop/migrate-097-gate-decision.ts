import type { Migrate097Resolved } from "./migrate-097";

/**
 * Whether the window shows the upgrade screen. An incomplete migration (a started
 * move that did not verify) and a folder another device removed before this device
 * exported its own data do, in an open folder. `none` is a folder with nothing to
 * move, `unavailable` is a read that did not answer, and neither may block the workspace.
 */
export function shouldShowUpgrade(state: Migrate097Resolved, folder: string | null): boolean {
  return folder !== null && (state === "incomplete" || state === "unexported");
}

/**
 * Whether the window shows a Retry banner: an unanswered read or another device's
 * removal. The window stays read-only until a retry reads a settled state, so the
 * banner must always offer a click. An incomplete migration shows the upgrade screen alone.
 */
export function shouldShowRetry(state: Migrate097Resolved, folder: string | null): boolean {
  return folder !== null && (state === "unavailable" || state === "removing-other");
}

/** Whether the window offers "Finish removing": a removal this device started and did not finish. */
export function shouldShowFinishRemoving(state: Migrate097Resolved, folder: string | null): boolean {
  return folder !== null && state === "removing";
}
