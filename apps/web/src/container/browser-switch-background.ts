import type { SwitchDecision } from "./browser-export-switch";

/** Upper bound on the background export. A run past this settles to null and startup keeps the server backend. */
export const BROWSER_SWITCH_TIMEOUT_MS = 120_000;

/**
 * Runs the 0.9.8 switch decision without blocking startup. The run starts synchronously.
 * Resolves with the decision, or null when the run throws or outlives `timeoutMs`; it never rejects.
 */
export function runBrowserSwitchInBackground(
  run: () => Promise<SwitchDecision>,
  timeoutMs: number = BROWSER_SWITCH_TIMEOUT_MS,
): Promise<SwitchDecision | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const work = (async () => run())().catch((): null => null);
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
