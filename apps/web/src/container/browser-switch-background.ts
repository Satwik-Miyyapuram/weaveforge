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
 * A switch marker written by this browser (`ownDeviceId`) means it already switched: open the files
 * wiring directly, with no export. A marker naming another install came through the git clone, so it
 * says nothing about this browser and reads as absent. It never rejects.
 */
export async function openFilesIfSwitched(
  sink: MarkerSink,
  ownDeviceId: string,
  openWiring: () => Promise<BrowserFileWiring>,
): Promise<MarkerProbe> {
  const marker = await readSwitchMarker(sink);
  if (marker === null || marker.deviceId !== ownDeviceId) return { state: "absent" };
  try {
    return { state: "opened", wiring: await openWiring() };
  } catch {
    return { state: "failed" };
  }
}

/**
 * Upper bound on the background export. The export is not a fixed-length operation: it reads every
 * file and uploads over the network, so a slow link can take minutes. The bound is 120 seconds. A run
 * past it settles to null and its signal is aborted, so the export stops at its next file: the page
 * stays read-only for this load and shows the retry banner.
 */
export const BROWSER_SWITCH_TIMEOUT_MS = 120_000;

/**
 * Runs the 0.9.8 switch decision without blocking startup. The run starts synchronously.
 * Resolves with the decision, or null when the run throws or outlives `timeoutMs`; it never rejects.
 * At the timeout the run's signal is aborted. A result that lands after the timeout is dropped, and a
 * late switch has its files wiring closed, so no OPFS handle stays open behind the read-only page.
 */
export function runBrowserSwitchInBackground(
  run: (signal: AbortSignal) => Promise<SwitchDecision>,
  timeoutMs: number = BROWSER_SWITCH_TIMEOUT_MS,
): Promise<SwitchDecision | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const controller = new AbortController();
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  const work = (async () => run(controller.signal))().catch((): null => null);
  void work.then((late) => {
    if (!timedOut || !late?.switch) return;
    // Wrapped so a close that throws synchronously is swallowed too.
    void Promise.resolve()
      .then(() => late.wiring.close())
      .catch(() => {});
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
