import type { SwitchDecision } from "./browser-export-switch";
import { runBrowserSwitchInBackground } from "./browser-switch-background";

/** Shown while this browser is read-only and its data is not yet in files. */
export const SWITCH_RETRY_TEXT = "Moving your data to files… read-only until done.";

/**
 * A switched run never shows the banner, desktop never runs the switch, and no-session has no
 * account to retry for. Every other outcome, including a run that timed out (null), shows it.
 */
export function needsSwitchRetry(outcome: SwitchDecision | null): boolean {
  if (outcome === null) return true;
  return !outcome.switch && outcome.reason !== "desktop" && outcome.reason !== "no-session";
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

/** Whether this page started read-only. Set once at startup, read by every retry. */
let startedReadOnly = false;

/** Startup records whether the page started read-only, and shows the banner for it. */
export function recordReadOnlyStart(readOnly: boolean): void {
  startedReadOnly = readOnly;
  setSwitchRetryNeeded(readOnly);
}

type SwitchRun = { run: () => Promise<SwitchDecision>; onSwitched: () => void };
/** The last switch asked for, so Retry and sign-in can run it again. */
let lastRun: SwitchRun | null = null;
/** The run in progress. A second request joins it: two exports never write OPFS at once. */
let inFlight: Promise<SwitchDecision | null> | null = null;
/** True while the export itself runs, including after its run timed out. */
let exportRunning = false;
/** Settles when the running export settles, even past its timeout. */
let exportSettled: Promise<void> | null = null;

async function runSwitchOnce(
  { run, onSwitched }: SwitchRun,
  timeoutMs?: number,
): Promise<SwitchDecision | null> {
  const outcome = await runBrowserSwitchInBackground(run, timeoutMs);
  if (outcome?.switch && takeReloadGuard()) {
    try {
      onSwitched();
      setSwitchRetryNeeded(false);
    } catch {
      // The reload did not start: the page stays read-only, so the banner stays, and a later
      // Retry may reload again.
      clearSwitchReloadGuard();
      setSwitchRetryNeeded(true);
    }
  } else if (outcome?.switch) {
    // No reload this session, so the page stays on the read-only backend: close the unused files.
    void Promise.resolve()
      .then(() => outcome.wiring.close())
      .catch(() => {});
    setSwitchRetryNeeded(true);
  } else {
    setSwitchRetryNeeded(startedReadOnly || needsSwitchRetry(outcome));
  }
  return outcome;
}

/**
 * Runs the switch for startup or for Retry. It runs only on a page that started read-only: the
 * export snapshots the server, and a read-only page cannot write after the snapshot, so nothing
 * is lost before the reload. A writable page resolves null without running.
 * A switched run reloads into files mode once per session; a repeat switch keeps the banner
 * instead of reloading. Any other outcome updates the banner, except that a read-only start keeps
 * it until a switch succeeds: the browser is still read-only whatever the retry found.
 * A call while a run is in flight joins that run, and a call while a timed-out export still runs
 * resolves null without starting another. Resolves with the outcome and never rejects.
 */
export function retrySwitch(
  run: () => Promise<SwitchDecision>,
  onSwitched: () => void,
  timeoutMs?: number,
): Promise<SwitchDecision | null> {
  if (!startedReadOnly) return Promise.resolve(null);
  lastRun = { run, onSwitched };
  if (inFlight) return inFlight;
  // A run past its timeout still writes OPFS. No second export starts until it settles.
  if (exportRunning) return Promise.resolve(null);
  const tracked = () => {
    exportRunning = true;
    const running = (async () => run())();
    const settled = running.then(
      () => {},
      () => {},
    );
    exportSettled = settled;
    void settled.then(() => {
      exportRunning = false;
      if (exportSettled === settled) exportSettled = null;
    });
    return running;
  };
  const current = runSwitchOnce({ run: tracked, onSwitched }, timeoutMs).finally(() => {
    if (inFlight === current) inFlight = null;
  });
  inFlight = current;
  return current;
}

/** Runs the last requested switch again; resolves null when none was requested. Never rejects. */
export function retrySwitchNow(): Promise<SwitchDecision | null> {
  return lastRun ? retrySwitch(lastRun.run, lastRun.onSwitched) : Promise.resolve(null);
}

/** The slice of the auth client the sign-in watch needs. */
export type AuthEvents = {
  onAuthStateChange(cb: (event: string) => void): { data: { subscription: { unsubscribe(): void } } };
};

let stopWatch: (() => void) | null = null;

/**
 * Re-runs the switch when the user signs in while the banner shows. Idempotent: a second call
 * keeps the first subscription. Returns a stop function.
 */
export function startSwitchRetryOnSignIn(auth: AuthEvents): () => void {
  if (!stopWatch) {
    const { data } = auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" || !isSwitchRetryNeeded()) return;
      // A run in flight may have started signed out: run once more after its export settles,
      // past any timeout, so the re-run is never refused as a second export.
      const running = inFlight ?? exportSettled;
      if (!running) {
        void retrySwitchNow();
        return;
      }
      void running
        .then(() => exportSettled)
        .then(() => (isSwitchRetryNeeded() ? retrySwitchNow() : null));
    });
    stopWatch = () => {
      data.subscription.unsubscribe();
      stopWatch = null;
    };
  }
  const stop = stopWatch;
  return () => {
    if (stopWatch === stop) stop();
  };
}
