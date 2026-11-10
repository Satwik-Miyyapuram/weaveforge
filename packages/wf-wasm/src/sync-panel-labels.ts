/**
 * Sync issues panel labels and hunk grouping (Rust `sync::panel_labels`), re-exported from index.ts.
 */
import {
  deviceMarkers as rawDeviceMarkers,
  groupHunks as rawGroupHunks,
  humanize as rawHumanize,
  isSettled as rawIsSettled,
  kindOf as rawKindOf,
  nameOf as rawNameOf,
  plural as rawPlural,
  uniqueDeviceName as rawUniqueDeviceName,
} from "../pkg/wf_wasm.js";
import type { DiffLine, HunkGroup } from "./bindings.js";

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

/** Conflict markers named for this device and the cloud. */
export function deviceMarkers(ours: string, theirs: string): string {
  return rawDeviceMarkers(ours, theirs);
}

/** The label for a synced table, such as "Note" or "Experiment". */
export function kindOf(table: string): string {
  return rawKindOf(table);
}

/** A conflict's title, name or label, cut to 70 characters; "Untitled" when there is none. */
export function nameOf(local: Record<string, unknown>, remote: Record<string, unknown> | null): string {
  return rawNameOf(local, remote);
}

/** A field name as a label: `_id` dropped, underscores spaced, first letter capitalised. */
export function humanize(field: string): string {
  return rawHumanize(field);
}

/** "n word" with the right plural; `many` overrides the plural word. */
export function plural(n: number, word: string, many?: string): string {
  return rawPlural(n, word, many);
}

/** An adoption label, `name (deviceLabel)`, counted up past any name already in `taken`. */
export function uniqueDeviceName(name: string, deviceLabel: string, taken: readonly string[]): string {
  return rawUniqueDeviceName(name, deviceLabel, taken);
}
