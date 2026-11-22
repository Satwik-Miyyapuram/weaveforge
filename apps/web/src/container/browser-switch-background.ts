import type { SwitchDecision } from "./browser-export-switch";
import type { BrowserFileWiring } from "./browser-file-backend";
import { readSwitchMarker, type MarkerSink } from "@/features/migration-097/domain/switch-marker";

/**
 * A present switch marker means this browser already switched: open the files wiring directly, with
 * no export. Resolves null when the marker is absent or unreadable, or when the files cannot open,
 * so the caller stays on the server path. It never rejects.
 */
export async function openFilesIfSwitched(
  sink: MarkerSink,
  openWiring: () => Promise<BrowserFileWiring>,
): Promise<BrowserFileWiring | null> {
  if ((await readSwitchMarker(sink)) === null) return null;
  try {
    return await openWiring();
  } catch {
    return null;
  }
}

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
