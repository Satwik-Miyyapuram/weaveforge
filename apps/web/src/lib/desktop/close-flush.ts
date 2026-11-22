/**
 * The page's side of the desktop close flush. Closing or quitting the app, the
 * shell runs `__wfFlushForClose()` in the main window and closes once it
 * resolves (or after its own cap). The flush fires `pagehide`, so each editor
 * starts its last write, then waits while any editor says a write is still on
 * its way, at most CLOSE_FLUSH_CAP_MS. A fixed grace either cut a slow write
 * short or kept every close waiting.
 */

/** Longest the page holds a close; the shell's own cap is a little longer. */
export const CLOSE_FLUSH_CAP_MS = 3000;

const STEP_MS = 25;

/** Each says whether its editor still has a write on the way. */
const probes = new Set<() => boolean>();

type FlushHost = EventTarget & { __wfFlushForClose?: () => Promise<void> };

function busy(): boolean {
  for (const probe of probes) {
    try {
      if (probe()) return true;
    } catch {
      // A probe that cannot answer does not hold the close.
    }
  }
  return false;
}

/** Fire `pagehide`, then wait while a write is on its way, up to the cap. */
export async function flushForClose(
  win: EventTarget,
  opts: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  win.dispatchEvent(new Event("pagehide"));
  const end = now() + CLOSE_FLUSH_CAP_MS;
  while (busy() && now() < end) await sleep(STEP_MS);
}

/**
 * Hold the app's close while `isBusy()` is true. Also makes sure the page
 * answers the shell's flush. Returns the stop.
 */
export function holdCloseWhile(
  isBusy: () => boolean,
  win: FlushHost | undefined = typeof window === "undefined" ? undefined : window,
): () => void {
  probes.add(isBusy);
  if (win && typeof win.__wfFlushForClose !== "function") {
    win.__wfFlushForClose = () => flushForClose(win);
  }
  return () => {
    probes.delete(isBusy);
  };
}
