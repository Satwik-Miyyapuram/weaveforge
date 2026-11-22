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

const RELOAD_GUARD_KEY = "weaveforge.switch-reload-098";
let reloadGuardTakenInMemory = false;

function sessionStore(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * One reload per session from a switch, so a switch that keeps reporting success cannot loop the
 * page. Falls back to memory when sessionStorage is unavailable.
 */
function takeReloadGuard(): boolean {
  const store = sessionStore();
  try {
    if (store) {
      if (store.getItem(RELOAD_GUARD_KEY)) return false;
      store.setItem(RELOAD_GUARD_KEY, "1");
      return true;
    }
  } catch {
    // Storage blocked: use the in-memory guard below.
  }
  if (reloadGuardTakenInMemory) return false;
  reloadGuardTakenInMemory = true;
  return true;
}

/** Forgets the reload guard. Startup calls this once files mode is running. */
export function clearSwitchReloadGuard(): void {
  reloadGuardTakenInMemory = false;
  try {
    sessionStore()?.removeItem(RELOAD_GUARD_KEY);
  } catch {
    // Nothing stored to clear.
  }
}

/**
 * Runs the switch for startup or for Retry. A switched run reloads into files mode once per
 * session; a repeat switch keeps the banner instead of reloading. Any other outcome updates the
 * banner. Resolves with the outcome and never rejects.
 */
export async function retrySwitch(
  run: () => Promise<SwitchDecision>,
  onSwitched: () => void,
): Promise<SwitchDecision | null> {
  const outcome = await runBrowserSwitchInBackground(run);
  if (outcome?.switch && takeReloadGuard()) {
    setSwitchRetryNeeded(false);
    onSwitched();
  } else if (outcome?.switch) {
    setSwitchRetryNeeded(true);
  } else {
    setSwitchRetryNeeded(needsSwitchRetry(outcome));
  }
  return outcome;
}
