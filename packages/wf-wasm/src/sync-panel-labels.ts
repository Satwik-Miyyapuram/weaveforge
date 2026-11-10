/**
 * Sync issues panel labels and hunk grouping (Rust `sync::panel_labels`), re-exported from index.ts.
 */
import {
  deviceLabel as rawDeviceLabel,
  isSettled as rawIsSettled,
  plural as rawPlural,
} from "../pkg/wf_wasm.js";

export {
  groupHunks,
  uniqueDeviceName,
} from "../pkg/wf_wasm.js";

export {
  deviceMarkers,
  humanize,
  kindOf,
  nameOf,
} from "../pkg/wf_wasm.js";

/** A field's choice. `picks` maps a hunk index to the side picked for it. */
export type PanelChoice =
  | { kind: "local" }
  | { kind: "remote" }
  | { kind: "hunks"; picks: Readonly<Record<number, string>> }
  | { kind: "edit"; text: string };

/** Whether a field's choice is complete (an edit with no markers, a pick for every hunk, or a side). */
export function isSettled(choice: PanelChoice | undefined, ours: string, theirs: string): boolean {
  return rawIsSettled(choice, ours, theirs);
}

/** "n word" with the right plural; `many` overrides the plural word. */
export function plural(n: number, word: string, many?: string): string {
  return rawPlural(n, word, many);
}

/** The adoption suffix name for a `navigator.platform` string: "Mac", "Windows", "Linux" or "this device". */
export function deviceLabel(platform: string): string {
  return rawDeviceLabel(platform);
}

