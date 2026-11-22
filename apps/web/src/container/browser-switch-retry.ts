import type { SwitchDecision } from "./browser-export-switch";
import { runBrowserSwitchInBackground } from "./browser-switch-background";

/** Shown while this browser's files are not ready and the server backend is in use. */
export const SWITCH_RETRY_TEXT = "Your files aren't ready yet.";

/**
 * A switched run never shows the banner, and desktop never runs the switch. Every other outcome,
 * including a run that timed out (null), shows it.
 */
export function needsSwitchRetry(outcome: SwitchDecision | null): boolean {
  if (outcome === null) return true;
  return !outcome.switch && outcome.reason !== "desktop";
}

type Listener = () => void;
const listeners = new Set<Listener>();
let retryNeeded = false;

export function isSwitchRetryNeeded(): boolean {
  return retryNeeded;
}

export function setSwitchRetryNeeded(value: boolean): void {
  if (retryNeeded === value) return;
  retryNeeded = value;
  for (const listener of listeners) listener();
}

export function subscribeSwitchRetry(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Runs the switch for startup or for Retry. A switched run reloads into files mode; any other
 * outcome updates the banner. Resolves with the outcome and never rejects.
 */
export async function retrySwitch(
  run: () => Promise<SwitchDecision>,
  onSwitched: () => void,
): Promise<SwitchDecision | null> {
  const outcome = await runBrowserSwitchInBackground(run);
  if (outcome?.switch) {
    setSwitchRetryNeeded(false);
    onSwitched();
  } else {
    setSwitchRetryNeeded(needsSwitchRetry(outcome));
  }
  return outcome;
}
