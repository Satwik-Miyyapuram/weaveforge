/**
 * Sync issues panel labels and hunk grouping (Rust `sync::panel_labels`), re-exported from index.ts.
 */
import {
  deviceLabel as rawDeviceLabel,
  groupHunks as rawGroupHunks,
  isSettled as rawIsSettled,
  plural as rawPlural,
  uniqueDeviceName as rawUniqueDeviceName,
} from "../pkg/wf_wasm.js";
import type {
  DiffLine,
  HunkGroup,
} from "./bindings.js";

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

/** Runs of unchanged lines, and each changed run tagged with its hunk index. */
export function groupHunks(lines: readonly DiffLine[]): HunkGroup[] {
  return rawGroupHunks(lines) as HunkGroup[];
}

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

/** An adoption label, `name (deviceLabel)`, counted up past any name already in `taken`. */
export function uniqueDeviceName(name: string, deviceLabel: string, taken: readonly string[]): string {
  return rawUniqueDeviceName(name, deviceLabel, taken);
}
