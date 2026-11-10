/**
 * Folder merge core, mirror manifest and folder-path helpers (Rust `sync::folder_merge`,
 * `sync::folder_mirror`, `sync::folder_layout`), re-exported from index.ts. Keeps the signatures
 * of apps/web workspace/application/{folder-merge,mirror-manifest,folder-import-apply,remove-project-folder}.ts.
 */
import {
  claimDigest as rawClaimDigest,
  countActionList as rawCountActionList,
  countActions as rawCountActions,
  folderTitleFromPath as rawFolderTitleFromPath,
  jsonEditSince as rawJsonEditSince,
  keepBothTitle as rawKeepBothTitle,
  mergeBothChanged as rawMergeBothChanged,
  movedPath as rawMovedPath,
  nextManifest as rawNextManifest,
  pickProjectFolder as rawPickProjectFolder,
  readMirrorBase as rawReadMirrorBase,
  readMirrorBases as rawReadMirrorBases,
  rekeyManifestText as rawRekeyManifestText,
  settleConflict as rawSettleConflict,
  unstampForCompare as rawUnstampForCompare,
} from "../pkg/wf_wasm.js";
import type {
  ActionCounts,
  ConflictResolution,
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

/** A both-changed file settled by its resolution; `undefined` when it settles to nothing (markers, or kept as it is). */
export function settleConflict(
  entry: ImportDiffEntry,
  resolutions: Readonly<Record<string, ConflictResolution>>,
): ImportDiffEntry | undefined {
  return rawSettleConflict(entry, resolutions) as ImportDiffEntry | undefined;
}

/** The title of the copy kept beside a conflict. */
export function keepBothTitle(title: string): string {
  return rawKeepBothTitle(title);
}

/** The digest each manifest path recorded (`""` when none); empty for an absent or unreadable manifest. */
export function readMirrorBase(text: string | undefined): Record<string, string> {
  return rawReadMirrorBase(text) as Record<string, string>;
}

/** The note bases the manifest recorded, by path; empty for an absent, older or unreadable manifest. */
export function readMirrorBases(text: string | undefined): Record<string, VaultPageBase> {
  return rawReadMirrorBases(text) as Record<string, VaultPageBase>;
}

/** The digest map with `path` recorded for `stamped` text. */
export function claimDigest(
  base: Readonly<Record<string, string>>,
  path: string,
  stamped: string,
): Record<string, string> {
  return rawClaimDigest(base, path, stamped) as Record<string, string>;
}

/** `path` after the project folder `old` moved to `root`. */
export function movedPath(old: string, root: string, path: string): string {
  return rawMovedPath(old, root, path);
}

/** The manifest text re-keyed from `old` to `root`; `undefined` when `text` is not a JSON object. */
export function rekeyManifestText(text: string, old: string, root: string): string | undefined {
  return rawRekeyManifestText(text, old, root);
}

/** `text` with a README or manifest's export time blanked, so two copies that differ only in it compare equal. */
export function unstampForCompare(path: string, text: string): string {
  return rawUnstampForCompare(path, text);
}
