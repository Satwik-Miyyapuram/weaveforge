/**
 * Folder merge core and mirror manifest (Rust `sync::folder_merge`, `sync::folder_mirror`),
 * re-exported from index.ts. Keeps the signatures of apps/web workspace/application/{folder-merge,mirror-manifest}.ts.
 */
import {
  countActionList as rawCountActionList,
  countActions as rawCountActions,
  mergeBothChanged as rawMergeBothChanged,
  nextManifest as rawNextManifest,
} from "../pkg/wf_wasm.js";
import type {
  ActionCounts,
  ImportAction,
  ImportDiffEntry,
  VaultPageBase,
} from "./bindings.js";

/** A both-changed conflict merged field by field; any other entry, or a missing base or workspace copy, comes back as it was. */
export function mergeBothChanged(
  entry: ImportDiffEntry,
  base: VaultPageBase | undefined,
  workspaceContent: string | undefined,
): ImportDiffEntry {
  return rawMergeBothChanged(entry, base ?? null, workspaceContent) as ImportDiffEntry;
}

/** Tally of entries by action (created, updated, unchanged, conflict, removed). */
export function countActions(entries: readonly ImportDiffEntry[]): ActionCounts {
  return rawCountActions([...entries]) as ActionCounts;
}

/** Tally of bare actions (created, updated, unchanged, conflict, removed). */
export function countActionList(actions: readonly ImportAction[]): ActionCounts {
  return rawCountActionList([...actions]) as ActionCounts;
}

/** Previous manifest minus removed paths, plus written paths, deduped in first-seen order. */
export function nextManifest(
  previous: readonly string[],
  run: { written: readonly string[]; removed: readonly string[] },
): string[] {
  return rawNextManifest([...previous], [...run.written], [...run.removed]);
}
