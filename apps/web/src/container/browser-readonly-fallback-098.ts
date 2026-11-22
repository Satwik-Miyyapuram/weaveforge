import type { BrowserFileWiring } from "./browser-file-backend";
import type { MarkerProbe } from "./browser-switch-background";

/**
 * How this browser starts. `files`: the switch marker says the switch ran and the files wiring opened.
 * `read-only`: anything else; the export runs in the background and a verified run reloads into files.
 */
export type BrowserStart = { mode: "files"; wiring: BrowserFileWiring } | { mode: "read-only" };

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
 * Chooses the start mode from the marker probe. 0.9.8: only an opened marker starts on files; every
 * other start (no marker, a pending switch, a marker whose files failed to open) is read-only until
 * the export verifies, so no personal read or write reaches the server. `pending` no longer changes
 * the answer; it stays in the signature for the caller.
 */
export function chooseBrowserStart(probe: MarkerProbe, _pending: boolean): BrowserStart {
  if (probe.state === "opened") return { mode: "files", wiring: probe.wiring };
  return { mode: "read-only" };
}
