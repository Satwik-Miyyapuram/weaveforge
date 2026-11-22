import type { SwitchDecision } from "./browser-export-switch";
import type { BrowserFileWiring } from "./browser-file-backend";
import { readSwitchMarker, type MarkerSink } from "@/features/migration-097/domain/switch-marker";

/**
 * What the switch marker says about this browser. `absent`: no readable marker, so the export has not
 * run here. `opened`: the marker is present and the files wiring opened. `failed`: the marker is present
 * but the files would not open, so the browser must not fall back to the writable server path.
 */
export type MarkerProbe =
  | { state: "absent" }
  | { state: "opened"; wiring: BrowserFileWiring }
  | { state: "failed" };

/**
 * A present switch marker means this browser already switched: open the files wiring directly, with
 * no export. It never rejects.
 */
export async function openFilesIfSwitched(
  sink: MarkerSink,
  openWiring: () => Promise<BrowserFileWiring>,
): Promise<MarkerProbe> {
  if ((await readSwitchMarker(sink)) === null) return { state: "absent" };
  try {
    return { state: "opened", wiring: await openWiring() };
  } catch {
    return { state: "failed" };
  }
}

/**
 * Upper bound on the background export. The export is not a fixed-length operation: it reads every
 * file and uploads over the network, so a slow link can take minutes. The bound is 120 seconds. A run
 * past it settles to null and startup stays on the server backend for this load, with the switch
 * retried on the next one.
 */
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
