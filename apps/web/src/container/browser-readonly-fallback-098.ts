import type { BrowserFileWiring } from "./browser-file-backend";
import type { MarkerProbe } from "./browser-switch-background";

/**
 * How this browser starts. `files`: the switch marker says the switch ran and the files wiring opened.
 * `read-only`: the browser must not write to the server (the marker is present but the files did not
 * open, or a switch ran but its marker write failed). `server`: nothing has switched here yet, so the
 * server path runs the export as before.
 */
export type BrowserStart =
  | { mode: "files"; wiring: BrowserFileWiring }
  | { mode: "read-only" }
  | { mode: "server" };

/**
 * P1 pending flag: set once markExported097 succeeds, cleared once the switch marker is written. If the
 * process dies or the marker write fails in between, the flag survives and the next start stays read-only.
 */
export interface SwitchPending {
  set(): void;
  clear(): void;
  isPending(): boolean;
}

const PENDING_KEY = "weaveforge.switch-pending-098";

/**
 * Pending flag in localStorage. Assumption: when localStorage is unavailable (private window, blocked
 * site data), the flag cannot persist, so a failed marker write is only remembered for this load.
 */
export function localSwitchPending(): SwitchPending {
  return {
    set() {
      try {
        localStorage.setItem(PENDING_KEY, "1");
      } catch {
        /* unavailable storage: the flag is not persisted */
      }
    },
    clear() {
      try {
        localStorage.removeItem(PENDING_KEY);
      } catch {
        /* unavailable storage: nothing was persisted */
      }
    },
    isPending() {
      try {
        return localStorage.getItem(PENDING_KEY) !== null;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Chooses the start mode from the marker probe. A present marker whose files failed to open, and a
 * pending switch with no marker, both stay read-only: no user write reaches the server until the
 * files are proven.
 */
export function chooseBrowserStart(probe: MarkerProbe, pending: boolean): BrowserStart {
  if (probe.state === "opened") return { mode: "files", wiring: probe.wiring };
  if (probe.state === "failed") return { mode: "read-only" };
  return pending ? { mode: "read-only" } : { mode: "server" };
}
