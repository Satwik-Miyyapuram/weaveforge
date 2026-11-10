/**
 * Folder merge core, mirror manifest and folder-path helpers (Rust `sync::folder_merge`,
 * `sync::folder_mirror`, `sync::folder_layout`), re-exported from index.ts. Keeps the signatures
 * of apps/web workspace/application/{folder-merge,mirror-manifest,folder-import-apply,remove-project-folder}.ts.
 */
import {
  countActionList as rawCountActionList,
  countActions as rawCountActions,
  folderTitleFromPath as rawFolderTitleFromPath,
  jsonEditSince as rawJsonEditSince,
  mergeBothChanged as rawMergeBothChanged,
  nextManifest as rawNextManifest,
  pickProjectFolder as rawPickProjectFolder,
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

/** Whether a JSON file's text is an edit to record: no digest recorded yet, or the digest differs. */
export function jsonEditSince(
  base: Readonly<Record<string, string>>,
  path: string,
  text: string,
): boolean {
  return rawJsonEditSince(base, path, text);
}

/** The title a note's file path gives: last segment minus `.md`, `.note`/`.ink` and `--id`; `Untitled` if empty. */
export function folderTitleFromPath(path: string): string {
  return rawFolderTitleFromPath(path);
}

/** The folder a deleted project lives in: `exact` when listed, else the single folder ending in `tail`. */
export function pickProjectFolder(
  dirs: readonly string[],
  exact: string,
  tail: string,
): string | undefined {
  return rawPickProjectFolder([...dirs], exact, tail);
}
